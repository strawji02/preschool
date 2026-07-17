import * as XLSX from 'xlsx'
import type { ComparisonItem } from '@/types/audit'
import { estimateSsgTotal } from './unit-conversion'

/**
 * 보고서 엑셀 다운로드 (2026-05-16 — 사용자 템플릿 양식으로 재구현)
 *
 * 사용자 업로드 템플릿 (선경_26년 4월 양식)과 완전 동일하게 출력:
 *
 *   |  No  | 기존 업체 품목 (merged B~F)         | 신세계 제안 품목 (merged G~K)         | 공급율 | 절감액 |
 *   |      | 품명 | 규격 | 수량 | 단가 | 금액      | 품명 | 규격 | 수량 | 단가 | 금액      | 1.25  |       |
 *   |  1   | ...                                | ...                                | =INT(L2*K3) | =F3-L3 |
 *   | 합계 |              [SUM(F3:F_n)]          |              [SUM(K3:K_n)]          | =SUM(L) | =SUM(M) |
 *
 * 핵심 특징 (사용자 양식):
 *  - L2 셀에 공급율 값 (사용자가 엑셀 직접 수정 가능, red font)
 *  - L열 = INT($L$2 * K_row) — 공급율 적용 금액 (수식)
 *  - M열 = F_row - L_row — 절감액 (수식)
 *  - 합계 행 모든 sum은 SUM 수식 — 데이터 수정 시 자동 재계산
 *  - 시트명: '가격비교'
 *
 * 정확성 원칙:
 *  - 거래명세표 합계 = 매칭 화면 KPI 합계와 일치
 *  - 동행 금액 = extracted_total_price ?? unit_price × quantity
 *  - 미매칭 품목도 모두 포함 (신세계 컬럼만 빈 칸)
 *  - 신세계 금액 = estimateSsgTotal (ppk × 단위중량 환산, KPI/리포트와 통일)
 */

function existingTotal(item: ComparisonItem): number {
  // (2026-05-17) per-row Math.round — 화면 categoryStats와 합계 정합성 (per-item round)
  return Math.round(item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity)
}

function shinsegaeSpec(item: ComparisonItem): string {
  const m = item.ssg_match
  if (!m) return ''
  if (m.spec_quantity != null && m.spec_unit) {
    return `${m.spec_quantity}${m.spec_unit}`
  }
  return ''
}

// 매칭이 있을 때 신세계 단가/금액 계산
function shinsegaePriceAmount(item: ComparisonItem): { qty: number; price: number; amount: number } | null {
  const m = item.ssg_match
  if (!m) return null
  const amount = estimateSsgTotal(item)
  const qty = item.adjusted_quantity ?? item.extracted_quantity
  const price = qty > 0 ? Math.round(amount / qty) : 0
  return { qty, price, amount }
}

/** 엑셀 한 데이터 행 (비교가능/비교불가 공용) */
export interface ExcelDataRow {
  name: string
  spec: string
  qty: number
  unitPrice: number
  existing: number
  /** 신세계 매칭 정보 — 비교불가/미매칭이면 null */
  ssg: { name: string; spec: string; qty: number; price: number; amount: number } | null
}

export interface ExcelModel {
  /** 비교 가능 = 확정 && 비제외 (화면 computeCategoryStats 대상과 동일) */
  comparable: ExcelDataRow[]
  /** 비교 불가 = 미확정 || 비교불가 (절감 계산에서 제외) */
  excluded: ExcelDataRow[]
  comparableSums: { existing: number; ssgAmount: number; applied: number; savings: number }
  excludedExisting: number
  /** 거래명세표 원장 총액 = 비교가능 기존 + 비교불가 기존 (전체 품목 합) */
  grandExisting: number
}

/** 비교 가능 판정 — 화면 computeCategoryStats(`is_excluded || !is_confirmed` 제외)와 정합 */
function isComparable(it: ComparisonItem): boolean {
  return it.is_confirmed === true && it.is_excluded !== true
}

function toRow(it: ComparisonItem): ExcelDataRow {
  const ssg = shinsegaePriceAmount(it)
  return {
    name: it.extracted_name,
    spec: it.extracted_spec ?? '',
    qty: it.extracted_quantity,
    unitPrice: it.extracted_unit_price,
    existing: existingTotal(it),
    ssg: ssg ? { name: it.ssg_match!.product_name ?? '', spec: shinsegaeSpec(it), ...ssg } : null,
  }
}

/**
 * 엑셀 3단 모델 계산 (순수함수 — TDD).
 * 비교가능/비교불가 분류 + 소계·총액. 절감은 비교가능만, 총액은 전체 품목 기존금액 합.
 */
export function buildExcelModel(items: ComparisonItem[], supplyRate: number = 1): ExcelModel {
  const comparableItems = items.filter(isComparable)
  const excludedItems = items.filter((it) => !isComparable(it))
  const comparable = comparableItems.map(toRow)
  const excluded = excludedItems.map(toRow)

  const cExisting = comparable.reduce((s, r) => s + r.existing, 0)
  const cSsg = comparable.reduce((s, r) => s + (r.ssg ? r.ssg.amount : 0), 0)
  const cApplied = comparable.reduce((s, r) => s + (r.ssg ? Math.round(r.ssg.amount * supplyRate) : 0), 0)
  const excludedExisting = excluded.reduce((s, r) => s + r.existing, 0)

  return {
    comparable,
    excluded,
    comparableSums: {
      existing: cExisting,
      ssgAmount: cSsg,
      applied: cApplied,
      savings: cExisting - cApplied,
    },
    excludedExisting,
    grandExisting: cExisting + excludedExisting,
  }
}

export function downloadReportAsExcel(
  items: ComparisonItem[],
  fileName: string = '가격비교_보고서',
  supplyRate: number = 1.0,
) {
  if (items.length === 0) {
    alert('다운로드할 데이터가 없습니다.')
    return
  }

  // (2026-07-05) 3단 구조 — 비교가능 → 비교불가 → 거래명세표 총액.
  //   절감은 비교가능 소계로만(화면 computeCategoryStats와 정합), 총액은 전량 합(원장 대조).
  const model = buildExcelModel(items, supplyRate)
  const EXCLUDED_MARK = '⛔ 비교불가'

  const groupHeader: (string | number)[] = [
    'No', '기존 업체 품목', '', '', '', '', '신세계 제안 품목', '', '', '', '', '공급율', '절감액',
  ]
  const colHeader: (string | number)[] = [
    '', '품명', '규격', '수량', '단가', '금액',
    '품명', '규격', '수량', '단가(신세계)', '금액(신세계)',
    supplyRate, '',
  ]

  const aoa: (string | number)[][] = [groupHeader, colHeader]
  let no = 1

  // ① 비교가능 데이터
  const compStartRow = aoa.length + 1 // 1-based
  for (const row of model.comparable) {
    aoa.push([
      no++, row.name, row.spec, row.qty, row.unitPrice, row.existing,
      row.ssg ? row.ssg.name : '', row.ssg ? row.ssg.spec : '',
      row.ssg ? row.ssg.qty : '', row.ssg ? row.ssg.price : '',
      row.ssg ? row.ssg.amount : '',
      '', '',
    ])
  }
  const compEndRow = aoa.length // 1-based (== compStartRow-1 if empty)
  const hasComp = model.comparable.length > 0

  // 비교가능 소계
  const compSubRow = aoa.length + 1
  aoa.push([
    `비교가능 소계 (${model.comparable.length}건)`, '', '', '', '',
    model.comparableSums.existing, '', '', '', '', model.comparableSums.ssgAmount,
    model.comparableSums.applied, model.comparableSums.savings,
  ])

  // ② 비교불가 데이터 + 소계 (있을 때만)
  let exStartRow = 0, exEndRow = 0, exSubRow = 0
  const hasEx = model.excluded.length > 0
  if (hasEx) {
    exStartRow = aoa.length + 1
    for (const row of model.excluded) {
      aoa.push([
        no++, row.name, row.spec, row.qty, row.unitPrice, row.existing,
        EXCLUDED_MARK, '', '', '', '', '', '',
      ])
    }
    exEndRow = aoa.length
    exSubRow = aoa.length + 1
    aoa.push([
      `비교불가 소계 (${model.excluded.length}건)`, '', '', '', '',
      model.excludedExisting, '', '', '', '', '', '', '',
    ])
  }

  // ③ 거래명세표 총액 (= 비교가능 + 비교불가 = 원장)
  const totalRow = aoa.length + 1
  aoa.push([
    '거래명세표 총액', '', '', '', '', model.grandExisting,
    '', '', '', '', '', '', '',
  ])

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // ── 비교가능 데이터행 L/M 수식 (공급율 L2 연동) ──
  model.comparable.forEach((row, i) => {
    const rr = compStartRow + i
    if (row.ssg) {
      const applied = Math.round(row.ssg.amount * supplyRate)
      ws[`L${rr}`] = { t: 'n', f: `ROUND($L$2*K${rr},0)`, v: applied, z: '#,##0' }
      ws[`M${rr}`] = { t: 'n', f: `F${rr}-L${rr}`, v: row.existing - applied, z: '#,##0' }
    } else {
      ws[`L${rr}`] = { t: 's', v: '' }
      ws[`M${rr}`] = { t: 's', v: '' }
    }
  })

  // ── 비교가능 소계 SUM 수식 ──
  if (hasComp) {
    ws[`F${compSubRow}`] = { t: 'n', f: `SUM(F${compStartRow}:F${compEndRow})`, v: model.comparableSums.existing, z: '#,##0' }
    ws[`K${compSubRow}`] = { t: 'n', f: `SUM(K${compStartRow}:K${compEndRow})`, v: model.comparableSums.ssgAmount, z: '#,##0' }
    ws[`L${compSubRow}`] = { t: 'n', f: `SUM(L${compStartRow}:L${compEndRow})`, v: model.comparableSums.applied, z: '#,##0' }
    ws[`M${compSubRow}`] = { t: 'n', f: `SUM(M${compStartRow}:M${compEndRow})`, v: model.comparableSums.savings, z: '#,##0' }
  }

  // ── 비교불가 소계 SUM ──
  if (hasEx) {
    ws[`F${exSubRow}`] = { t: 'n', f: `SUM(F${exStartRow}:F${exEndRow})`, v: model.excludedExisting, z: '#,##0' }
  }

  // ── 거래명세표 총액 = 비교가능 소계 + 비교불가 소계 ──
  ws[`F${totalRow}`] = {
    t: 'n',
    f: hasEx ? `F${compSubRow}+F${exSubRow}` : `F${compSubRow}`,
    v: model.grandExisting,
    z: '#,##0',
  }

  // ──────────────────────────────────────────────────────────────
  // Merge (헤더만) + 컬럼 너비
  // ──────────────────────────────────────────────────────────────
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 0, c: 5 } },
    { s: { r: 0, c: 6 }, e: { r: 0, c: 10 } },
    { s: { r: 0, c: 12 }, e: { r: 1, c: 12 } },
  ]
  ws['!cols'] = [
    { wch: 5.8 }, { wch: 26.8 }, { wch: 36.8 }, { wch: 7.8 }, { wch: 11.8 }, { wch: 13.8 },
    { wch: 26.8 }, { wch: 16.8 }, { wch: 6.2 }, { wch: 11.8 }, { wch: 11.6 }, { wch: 11.1 }, { wch: 12.6 },
  ]

  // ──────────────────────────────────────────────────────────────
  // 스타일
  // ──────────────────────────────────────────────────────────────
  // 헤더 (row 0~1)
  for (let c = 0; c < 13; c++) {
    for (let r = 0; r < 2; r++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref]) {
        ws[ref].s = {
          font: { bold: true, color: { rgb: '1F2937' } },
          fill: { fgColor: { rgb: 'E5E7EB' } },
          alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
          border: {
            top: { style: 'thin', color: { rgb: '9CA3AF' } },
            bottom: { style: 'thin', color: { rgb: '9CA3AF' } },
            left: { style: 'thin', color: { rgb: '9CA3AF' } },
            right: { style: 'thin', color: { rgb: '9CA3AF' } },
          },
        }
      }
    }
  }
  // L2 공급율 (red)
  if (ws['L2']) {
    ws['L2'].s = {
      font: { bold: true, color: { rgb: 'DC2626' }, sz: 12 },
      fill: { fgColor: { rgb: 'FEF2F2' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'medium', color: { rgb: 'DC2626' } },
        bottom: { style: 'medium', color: { rgb: 'DC2626' } },
        left: { style: 'medium', color: { rgb: 'DC2626' } },
        right: { style: 'medium', color: { rgb: 'DC2626' } },
      },
    }
  }
  // 소계/총액 강조 행 (0-based)
  const emphRows = [compSubRow - 1, ...(hasEx ? [exSubRow - 1] : []), totalRow - 1]
  for (const r of emphRows) {
    const isTotal = r === totalRow - 1
    for (let c = 0; c < 13; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref]) {
        ws[ref].s = {
          font: { bold: true, color: { rgb: isTotal ? '1E3A8A' : '111827' } },
          fill: { fgColor: { rgb: isTotal ? 'DBEAFE' : 'F3F4F6' } },
          alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' },
          border: { top: { style: 'medium', color: { rgb: isTotal ? '1E3A8A' : '6B7280' } } },
        }
      }
    }
  }
  // 비교불가 데이터행 G열 마크 강조 (회색 이탤릭)
  if (hasEx) {
    for (let r = exStartRow - 1; r <= exEndRow - 1; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: 6 })
      if (ws[ref]) {
        ws[ref].s = {
          font: { italic: true, color: { rgb: '6B7280' } },
          alignment: { horizontal: 'center', vertical: 'center' },
        }
      }
    }
  }
  // 절감액 색상 (M열 = c12) — 데이터/소계에서 숫자면
  for (let r = compStartRow - 1; r <= totalRow - 1; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 12 })
    if (ws[ref] && typeof ws[ref].v === 'number') {
      const v = ws[ref].v as number
      const isEmph = emphRows.includes(r)
      if (v > 0) {
        ws[ref].s = {
          ...(ws[ref].s ?? {}),
          font: { color: { rgb: '047857' }, bold: isEmph },
          fill: { fgColor: { rgb: isEmph ? 'D1FAE5' : 'ECFDF5' } },
          alignment: { horizontal: 'right' },
        }
      } else if (v < 0) {
        ws[ref].s = {
          ...(ws[ref].s ?? {}),
          font: { color: { rgb: 'B91C1C' }, bold: isEmph },
          fill: { fgColor: { rgb: isEmph ? 'FEE2E2' : 'FEF2F2' } },
          alignment: { horizontal: 'right' },
        }
      }
    }
  }
  // 숫자 컬럼 number format
  for (let r = compStartRow - 1; r <= totalRow - 1; r++) {
    for (const c of [3, 4, 5, 8, 9, 10, 11, 12]) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref] && typeof ws[ref].v === 'number' && !ws[ref].z) {
        ws[ref].z = '#,##0'
      }
    }
  }
  // 데이터 영역 border (비교가능 첫 행 ~ 총액 직전)
  for (let r = compStartRow - 1; r < totalRow - 1; r++) {
    for (let c = 0; c < 13; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref] && !(ws[ref].s as { border?: unknown })?.border) {
        ws[ref].s = {
          ...(ws[ref].s ?? {}),
          border: {
            top: { style: 'thin', color: { rgb: 'D1D5DB' } },
            bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
            left: { style: 'thin', color: { rgb: 'D1D5DB' } },
            right: { style: 'thin', color: { rgb: 'D1D5DB' } },
          },
          alignment:
            (ws[ref].s as { alignment?: unknown })?.alignment ??
            { horizontal: typeof ws[ref].v === 'number' ? 'right' : 'left', vertical: 'center' },
        }
      }
    }
  }

  // 저장 — 시트명 '가격비교'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '가격비교')
  const timestamp = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${fileName}_${timestamp}.xlsx`)
}
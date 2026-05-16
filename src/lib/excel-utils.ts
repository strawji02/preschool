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
  return item.extracted_total_price ?? item.extracted_unit_price * item.extracted_quantity
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

export function downloadReportAsExcel(
  items: ComparisonItem[],
  fileName: string = '가격비교_보고서',
  supplyRate: number = 1.0,
) {
  if (items.length === 0) {
    alert('다운로드할 데이터가 없습니다.')
    return
  }

  // ──────────────────────────────────────────────────────────────
  // 1. AOA (Array of Arrays) 구성 — 값만, 수식은 별도 셀에 주입
  // ──────────────────────────────────────────────────────────────
  // Row 1 (group header): No | 기존 업체 품목 (B~F merged) | 신세계 제안 품목 (G~K merged) | 공급율 (L1) | 절감액 (M merged)
  const groupHeader: (string | number)[] = [
    'No', '기존 업체 품목', '', '', '', '', '신세계 제안 품목', '', '', '', '', '공급율', '절감액',
  ]
  // Row 2 (column header): L2에 공급율 값(red), M2는 비움 (M1:M2 merge)
  const colHeader: (string | number)[] = [
    '', '품명', '규격', '수량', '단가(동행)', '금액(동행)',
    '품명', '규격', '수량', '단가(신세계)', '금액(신세계)',
    supplyRate, '',
  ]

  // Row 3+ (data) — L/M열은 placeholder (수식으로 덮어쓸 예정)
  const dataRows = items.map((it, i) => {
    const ssg = shinsegaePriceAmount(it)
    return [
      i + 1,
      it.extracted_name,
      it.extracted_spec ?? '',
      it.extracted_quantity,
      it.extracted_unit_price,
      existingTotal(it),
      ssg ? (it.ssg_match!.product_name ?? '') : '',
      shinsegaeSpec(it),
      ssg ? ssg.qty : '',
      ssg ? ssg.price : '',
      ssg ? ssg.amount : '',
      '', // L (수식으로 덮어씀)
      '', // M (수식으로 덮어씀)
    ]
  })

  // 합계 행 — 값은 추후 SUM 수식으로 대체
  const summaryRow: (string | number)[] = [
    '합계', '', '', '', '', '', '', '', '', '', '', '', '',
  ]

  const aoa = [groupHeader, colHeader, ...dataRows, summaryRow]
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // ──────────────────────────────────────────────────────────────
  // 2. 수식 주입 (L/M 데이터 행 + 합계 행)
  //    엑셀 행번호는 1-based: row 3 = data start, lastRow = summary
  // ──────────────────────────────────────────────────────────────
  const firstDataRow = 3
  const lastDataRow = firstDataRow + items.length - 1
  const summaryRowNum = lastDataRow + 1

  // 각 데이터 행 L/M 수식
  for (let i = 0; i < items.length; i++) {
    const r = firstDataRow + i
    const ssg = shinsegaePriceAmount(items[i])
    // L 셀 (공급율 적용 금액)
    const lRef = `L${r}`
    if (ssg) {
      ws[lRef] = {
        t: 'n',
        f: `INT($L$2*K${r})`,
        v: Math.round(ssg.amount * supplyRate),
        z: '#,##0',
      }
    } else {
      ws[lRef] = { t: 's', v: '' }
    }
    // M 셀 (절감액 = F - L)
    const mRef = `M${r}`
    if (ssg) {
      ws[mRef] = {
        t: 'n',
        f: `F${r}-L${r}`,
        v: existingTotal(items[i]) - Math.round(ssg.amount * supplyRate),
        z: '#,##0',
      }
    } else {
      ws[mRef] = { t: 's', v: '' }
    }
  }

  // 합계 행: F = SUM(F3:F_n), K = SUM(K3:K_n), L = SUM(L), M = SUM(M)
  const sumExisting = items.reduce((s, it) => s + existingTotal(it), 0)
  const sumSsg = items.reduce((s, it) => {
    const x = shinsegaePriceAmount(it)
    return s + (x ? x.amount : 0)
  }, 0)
  const sumApplied = Math.round(sumSsg * supplyRate)
  const sumSavings = sumExisting - sumApplied

  ws[`F${summaryRowNum}`] = {
    t: 'n',
    f: `SUM(F${firstDataRow}:F${lastDataRow})`,
    v: sumExisting,
    z: '#,##0',
  }
  ws[`K${summaryRowNum}`] = {
    t: 'n',
    f: `SUM(K${firstDataRow}:K${lastDataRow})`,
    v: sumSsg,
    z: '#,##0',
  }
  ws[`L${summaryRowNum}`] = {
    t: 'n',
    f: `SUM(L${firstDataRow}:L${lastDataRow})`,
    v: sumApplied,
    z: '#,##0',
  }
  ws[`M${summaryRowNum}`] = {
    t: 'n',
    f: `SUM(M${firstDataRow}:M${lastDataRow})`,
    v: sumSavings,
    z: '#,##0',
  }

  // ──────────────────────────────────────────────────────────────
  // 3. Merge — 사용자 양식과 완전 동일
  //    A1:A2 (No), B1:F1 (기존 업체 품목), G1:K1 (신세계 제안 품목)
  //    L1 단독 (공급율 header), L2 = 값
  //    M1:M2 (절감액 세로)
  // ──────────────────────────────────────────────────────────────
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },   // A1:A2 No
    { s: { r: 0, c: 1 }, e: { r: 0, c: 5 } },   // B1:F1 기존 업체 품목
    { s: { r: 0, c: 6 }, e: { r: 0, c: 10 } },  // G1:K1 신세계 제안 품목
    { s: { r: 0, c: 12 }, e: { r: 1, c: 12 } }, // M1:M2 절감액
  ]

  // 컬럼 너비 (사용자 양식 기준)
  ws['!cols'] = [
    { wch: 5.8 },   // A: No
    { wch: 26.8 },  // B: 기존 품명
    { wch: 36.8 },  // C: 기존 규격
    { wch: 7.8 },   // D: 기존 수량
    { wch: 11.8 },  // E: 기존 단가
    { wch: 13.8 },  // F: 기존 금액
    { wch: 26.8 },  // G: 신세계 품명
    { wch: 16.8 },  // H: 신세계 규격
    { wch: 6.2 },   // I: 신세계 수량
    { wch: 11.8 },  // J: 신세계 단가
    { wch: 11.6 },  // K: 신세계 금액
    { wch: 11.1 },  // L: 공급율 적용 금액
    { wch: 12.6 },  // M: 절감액
  ]

  // ──────────────────────────────────────────────────────────────
  // 4. 스타일 — 헤더 강조 + 공급율 셀 red + 합계 행 + 절감액 색상
  // ──────────────────────────────────────────────────────────────
  // 그룹 헤더 + 컬럼 헤더 (row 1~2)
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
  // L2 (공급율 값) — red font + 굵게 (사용자가 직접 수정 가능 표시)
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
  // 합계 행 highlight + 절감액 색상
  for (let c = 0; c < 13; c++) {
    const ref = XLSX.utils.encode_cell({ r: summaryRowNum - 1, c })
    if (ws[ref]) {
      ws[ref].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'F3F4F6' } },
        alignment: { horizontal: c === 0 ? 'center' : 'right' },
        border: {
          top: { style: 'medium', color: { rgb: '6B7280' } },
        },
      }
    }
  }
  // 절감액 색상 (M열, 양수=녹색, 음수=빨강)
  for (let r = firstDataRow - 1; r <= summaryRowNum - 1; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 12 })
    if (ws[ref] && typeof ws[ref].v === 'number') {
      const v = ws[ref].v as number
      const isSummary = r === summaryRowNum - 1
      if (v > 0) {
        ws[ref].s = {
          ...(ws[ref].s ?? {}),
          font: { color: { rgb: '047857' }, bold: isSummary },
          fill: { fgColor: { rgb: isSummary ? 'D1FAE5' : 'ECFDF5' } },
          alignment: { horizontal: 'right' },
        }
      } else if (v < 0) {
        ws[ref].s = {
          ...(ws[ref].s ?? {}),
          font: { color: { rgb: 'B91C1C' }, bold: isSummary },
          fill: { fgColor: { rgb: isSummary ? 'FEE2E2' : 'FEF2F2' } },
          alignment: { horizontal: 'right' },
        }
      }
    }
  }
  // 숫자 컬럼 number format
  for (let r = firstDataRow - 1; r <= summaryRowNum - 1; r++) {
    for (const c of [3, 4, 5, 8, 9, 10, 11, 12]) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref] && typeof ws[ref].v === 'number' && !ws[ref].z) {
        ws[ref].z = '#,##0'
      }
    }
  }
  // 데이터 영역 border (3 ~ summary-1)
  for (let r = firstDataRow - 1; r < summaryRowNum - 1; r++) {
    for (let c = 0; c < 13; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref]) {
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

  // ──────────────────────────────────────────────────────────────
  // 5. 저장 — 시트명 '가격비교' (사용자 양식 동일)
  // ──────────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '가격비교')
  const timestamp = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${fileName}_${timestamp}.xlsx`)
}

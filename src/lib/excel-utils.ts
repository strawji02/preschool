import * as XLSX from 'xlsx'
import type { ComparisonItem } from '@/types/audit'
import { estimateSsgTotal } from './unit-conversion'

/**
 * 보고서 엑셀 다운로드 (2026-05-04 재구현)
 *
 * 형식 (사용자 첨부 템플릿 기준):
 *   | No |  기존 업체 품목 (merged B~F)         | 신세계 제안 품목 (merged G~K)        | 절감액 |
 *   |    | 품명 | 규격 | 수량 | 단가 | 금액      | 품명 | 규격 | 수량 | 단가 | 금액      |       |
 *   | 1  | ...                                | ...                                |       |
 *
 * 정확성 원칙:
 *  - 거래명세표 합계 = 매칭 화면 KPI 합계와 일치
 *    · 동행 금액 = extracted_total_price ?? unit_price × quantity
 *    · 미매칭 품목도 모두 포함 (신세계 컬럼만 빈 칸)
 *  - 신세계 금액 = estimateSsgTotal (ppk × 단위중량 환산, KPI/리포트와 통일)
 */

interface SheetRow {
  No: string | number
  '기존_품명': string
  '기존_규격': string
  '기존_수량': number | string
  '기존_단가': number | string
  '기존_금액': number | string
  '신세계_품명': string
  '신세계_규격': string
  '신세계_수량': number | string
  '신세계_단가': number | string
  '신세계_금액': number | string
  '절감액': number | string
}

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

function itemRow(item: ComparisonItem, index: number): SheetRow {
  const ourAmount = existingTotal(item)
  const m = item.ssg_match

  const ssgAmount = m ? estimateSsgTotal(item) : 0
  const ssgQty = item.adjusted_quantity ?? item.extracted_quantity
  const ssgPrice = m && ssgQty > 0 ? Math.round(ssgAmount / ssgQty) : 0
  const savings = m ? ourAmount - ssgAmount : 0

  return {
    No: index + 1,
    '기존_품명': item.extracted_name,
    '기존_규격': item.extracted_spec ?? '',
    '기존_수량': item.extracted_quantity,
    '기존_단가': item.extracted_unit_price,
    '기존_금액': ourAmount,
    '신세계_품명': m ? (m.product_name ?? '') : '',
    '신세계_규격': shinsegaeSpec(item),
    '신세계_수량': m ? ssgQty : '',
    '신세계_단가': m ? ssgPrice : '',
    '신세계_금액': m ? ssgAmount : '',
    '절감액': m ? savings : '',
  }
}

function buildAOA(rows: SheetRow[]): (string | number)[][] {
  // Row 1: merged group header
  const groupHeader = ['No', '기존 업체 품목', '', '', '', '', '신세계 제안 품목', '', '', '', '', '절감액']
  // Row 2: column header
  const colHeader = ['', '품명', '규격', '수량', '단가(동행)', '금액(동행)', '품명', '규격', '수량', '단가(신세계)', '금액(신세계)', '']

  const dataRows = rows.map((r) => [
    r.No,
    r['기존_품명'], r['기존_규격'], r['기존_수량'], r['기존_단가'], r['기존_금액'],
    r['신세계_품명'], r['신세계_규격'], r['신세계_수량'], r['신세계_단가'], r['신세계_금액'],
    r['절감액'],
  ])

  // Summary row
  const sumExisting = rows.reduce<number>((s, r) => s + (typeof r['기존_금액'] === 'number' ? r['기존_금액'] : 0), 0)
  const sumSsg = rows.reduce<number>((s, r) => s + (typeof r['신세계_금액'] === 'number' ? r['신세계_금액'] : 0), 0)
  const sumSavings = rows.reduce<number>((s, r) => s + (typeof r['절감액'] === 'number' ? r['절감액'] : 0), 0)
  const summaryRow = [
    '합계', '', '', '', '', sumExisting,
    '', '', '', '', sumSsg,
    sumSavings,
  ]

  return [groupHeader, colHeader, ...dataRows, summaryRow]
}

export function downloadReportAsExcel(
  items: ComparisonItem[],
  fileName: string = '가격비교_보고서',
) {
  if (items.length === 0) {
    alert('다운로드할 데이터가 없습니다.')
    return
  }

  const rows = items.map((it, i) => itemRow(it, i))
  const aoa = buildAOA(rows)

  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // Merge: A1 (No 세로 2칸), B1:F1 (기존), G1:K1 (신세계), L1 (절감액 세로 2칸)
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },   // A1:A2 No
    { s: { r: 0, c: 1 }, e: { r: 0, c: 5 } },   // B1:F1 기존 업체 품목
    { s: { r: 0, c: 6 }, e: { r: 0, c: 10 } },  // G1:K1 신세계 제안 품목
    { s: { r: 0, c: 11 }, e: { r: 1, c: 11 } }, // L1:L2 절감액
  ]

  // Column widths
  ws['!cols'] = [
    { wch: 5 },   // No
    { wch: 26 },  // 기존 품명
    { wch: 36 },  // 기존 규격
    { wch: 7 },   // 기존 수량
    { wch: 11 },  // 기존 단가
    { wch: 13 },  // 기존 금액
    { wch: 26 },  // 신세계 품명
    { wch: 16 },  // 신세계 규격
    { wch: 7 },   // 신세계 수량
    { wch: 11 },  // 신세계 단가
    { wch: 13 },  // 신세계 금액
    { wch: 13 },  // 절감액
  ]

  // Header style + summary highlight + savings color
  const lastRowIdx = aoa.length - 1
  for (let c = 0; c < 12; c++) {
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
    // Summary row
    const sumRef = XLSX.utils.encode_cell({ r: lastRowIdx, c })
    if (ws[sumRef]) {
      ws[sumRef].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'F3F4F6' } },
        alignment: { horizontal: c === 0 ? 'center' : 'right' },
      }
    }
  }

  // 절감액 색상 (양수=녹색, 음수=빨강)
  for (let r = 2; r <= lastRowIdx; r++) {
    const ref = XLSX.utils.encode_cell({ r, c: 11 })
    if (ws[ref] && typeof ws[ref].v === 'number') {
      const v = ws[ref].v as number
      if (v > 0) {
        ws[ref].s = {
          ...(ws[ref].s ?? {}),
          font: { color: { rgb: '047857' }, bold: r === lastRowIdx },
          fill: { fgColor: { rgb: r === lastRowIdx ? 'D1FAE5' : 'ECFDF5' } },
          alignment: { horizontal: 'right' },
        }
      } else if (v < 0) {
        ws[ref].s = {
          ...(ws[ref].s ?? {}),
          font: { color: { rgb: 'B91C1C' }, bold: r === lastRowIdx },
          fill: { fgColor: { rgb: r === lastRowIdx ? 'FEE2E2' : 'FEF2F2' } },
          alignment: { horizontal: 'right' },
        }
      }
    }
  }

  // Number format (천단위 콤마)
  for (let r = 2; r <= lastRowIdx; r++) {
    for (const c of [3, 4, 5, 8, 9, 10, 11]) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (ws[ref] && typeof ws[ref].v === 'number') {
        ws[ref].z = '#,##0'
      }
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '가격비교')
  const timestamp = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${fileName}_${timestamp}.xlsx`)
}

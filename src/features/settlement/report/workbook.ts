import * as XLSX from 'xlsx'
import type { DeductionSheet } from '../calc/deduction'
import { REPORT_COL, type SettlementSheet } from './settlement-sheet'

/**
 * 정산 내역서를 xlsx 바이트로 만든다.
 *
 * 서식은 담당자가 기존 파일과 같은 감각으로 볼 수 있는 수준까지만 맞춘다
 * (천단위 구분, 열 너비). 셀 배경·테두리까지 재현하려면 SheetJS 유료 기능이
 * 필요하므로 하지 않는다 — 숫자가 맞는지가 본질이다.
 */

/** 금액 열은 천단위 구분 기호를 붙인다 */
const MONEY_FORMAT = '#,##0'

/** 열 너비 (문자 수 기준). A 구분 / B 식당명만 넓게. */
const COLUMN_WIDTHS: number[] = (() => {
  const w = new Array(22).fill(12)
  w[REPORT_COL.division] = 10
  w[REPORT_COL.venue] = 34
  w[REPORT_COL.blank] = 2 // N열은 공백이므로 좁게
  w[REPORT_COL.preTax] = 14
  w[REPORT_COL.netPay] = 14
  w[REPORT_COL.declared] = 14
  return w
})()

export interface WorkbookOptions {
  /** 시트 이름. 기본 `집계표_정산용` — 원본과 같은 이름이면 대조가 쉽다 */
  sheetName?: string
  /**
   * 사업자공제 상세. 있으면 두 번째 시트로 붙인다.
   *
   * 화면에서 입력한 항목별 내역이 다운로드하면 사라지면, 다음 달에
   * "지난달 공제 1,696,500이 뭐였지?"를 답할 수 없다. Q 합계만으로는 근거가 안 남는다.
   */
  deductionSheet?: DeductionSheet | null
}

export function buildSettlementWorkbook(
  sheet: SettlementSheet,
  options: WorkbookOptions = {}
): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][])

  ws['!merges'] = sheet.merges.map((m) => ({ s: { ...m.s }, e: { ...m.e } }))
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }))
  applyMoneyFormat(ws)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, options.sheetName ?? '집계표_정산용')

  // 공제 항목이 하나도 없으면(헤더+합계뿐) 빈 시트를 붙이지 않는다
  const detail = options.deductionSheet
  if (detail && detail.rows.length > 2) {
    const dws = XLSX.utils.aoa_to_sheet(detail.rows as unknown[][])
    dws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 30 }]
    applyMoneyFormat(dws)
    XLSX.utils.book_append_sheet(wb, dws, '사업자공제 상세')
  }

  return wb
}

function applyMoneyFormat(ws: XLSX.WorkSheet): void {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === 'n') cell.z = MONEY_FORMAT
    }
  }
}

/** 브라우저 다운로드·API 응답에 그대로 쓸 수 있는 바이트 */
export function writeSettlementXlsx(
  sheet: SettlementSheet,
  options: WorkbookOptions = {}
): Uint8Array {
  const wb = buildSettlementWorkbook(sheet, options)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

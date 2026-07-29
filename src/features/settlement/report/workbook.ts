import * as XLSX from 'xlsx'
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
}

export function buildSettlementWorkbook(
  sheet: SettlementSheet,
  options: WorkbookOptions = {}
): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][])

  ws['!merges'] = sheet.merges.map((m) => ({ s: { ...m.s }, e: { ...m.e } }))
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }))

  // 숫자 셀에 천단위 서식 적용
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell && cell.t === 'n') cell.z = MONEY_FORMAT
    }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, options.sheetName ?? '집계표_정산용')
  return wb
}

/** 브라우저 다운로드·API 응답에 그대로 쓸 수 있는 바이트 */
export function writeSettlementXlsx(
  sheet: SettlementSheet,
  options: WorkbookOptions = {}
): Uint8Array {
  const wb = buildSettlementWorkbook(sheet, options)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

import * as XLSX from 'xlsx'
import type { DeductionSheet } from '../calc/deduction'
import { ADJUSTMENT_COL_WIDTHS, type AdjustmentSheet } from './adjustment-sheet'
import type { DeclarationSheet } from './declaration-sheet'
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
  /**
   * 사업소득 지급명세서 (docs §6-3). 있으면 세 번째 시트로 붙인다.
   *
   * 세무사 제출용이라 **주민번호 열은 빈칸**으로 나간다 — 담당자가 다운로드 후
   * 직접 채운다 (docs §7: 주민번호는 저장하지 않는다).
   */
  declarationSheet?: DeclarationSheet | null
  /**
   * 품목 조정 내역 (docs §18). 있으면 마지막 시트로 붙인다.
   *
   * 조정하면 영업자 지급액이 줄어든다. 왜 줄었는지가 내역서에 없으면
   * 영업자에게 설명할 근거가 없다 — 금액만이 아니라 **사유와 요청자**를 함께 싣는다.
   */
  adjustmentSheet?: AdjustmentSheet | null
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

  // 신고할 소득이 없으면(전원 신고액 0) 빈 명세서를 붙이지 않는다
  const declaration = options.declarationSheet
  if (declaration && declaration.lines.length > 0) {
    const nws = XLSX.utils.aoa_to_sheet(declaration.rows as unknown[][])
    nws['!merges'] = declaration.merges.map((m) => ({ s: { ...m.s }, e: { ...m.e } }))
    nws['!cols'] = [
      { wch: 6 }, // 구분
      { wch: 12 }, // 성명
      { wch: 14 }, // 사업소득액
      { wch: 12 }, // 소득세
      { wch: 12 }, // 지방소득세
      { wch: 12 }, // 소득세계
      { wch: 14 }, // 실지급액
      { wch: 18 }, // 주민번호 — 손으로 채울 자리라 넉넉히
    ].map((c) => c)
    applyMoneyFormat(nws)
    XLSX.utils.book_append_sheet(wb, nws, '사업소득 신고내역')
  }

  // 조정이 없으면 빈 시트를 붙이지 않는다 (빌더가 null을 준다)
  const adjustment = options.adjustmentSheet
  if (adjustment) {
    const aws = XLSX.utils.aoa_to_sheet(adjustment.rows as unknown[][])
    aws['!cols'] = ADJUSTMENT_COL_WIDTHS.map((wch) => ({ wch }))
    applyMoneyFormat(aws)
    XLSX.utils.book_append_sheet(wb, aws, '품목 조정 내역')
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

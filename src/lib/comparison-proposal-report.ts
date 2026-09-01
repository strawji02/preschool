import 'server-only'

import ExcelJS from 'exceljs'
import { aggregateProposalMonth, type ProposalAmountSnapshot } from '@/lib/comparison-proposal-history'

export interface MonthlyProposalReportRow {
  id: string
  sessionId: string
  kindergartenId: string
  kindergartenName: string
  targetPeriod: string
  versionNo: number
  issueFormat: string
  statementChanged: boolean | null
  proposalAmountChanged: boolean | null
  statementDiff: Record<string, number>
  amountDiff: Record<string, number>
  amountSnapshot: ProposalAmountSnapshot
  changeReasons: string[]
  isEstimated: boolean
  estimateConfidence: string | null
  estimateBasis: string[]
  issuedAt: string
}

const NAVY = 'FF26374A'
const BLUE = 'FF3E6B89'
const PALE_BLUE = 'FFEAF1F5'
const PALE_GREEN = 'FFE8F2EC'
const BORDER = 'FFD1D9DF'

function asObject(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asObject(value[0])
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asNumberObject(value: unknown): Record<string, number> {
  const object = asObject(value)
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, Number(item ?? 0)]))
}

function amountSnapshot(value: unknown): ProposalAmountSnapshot {
  const object = asNumberObject(value)
  return {
    monthlyExistingAmount: object.monthlyExistingAmount ?? 0,
    monthlyProposedAmount: object.monthlyProposedAmount ?? 0,
    monthlySavings: object.monthlySavings ?? 0,
    annualExistingAmount: object.annualExistingAmount ?? 0,
    annualProposedAmount: object.annualProposedAmount ?? 0,
    annualSavings: object.annualSavings ?? 0,
    savingsPercent: object.savingsPercent ?? 0,
    supplyRate: object.supplyRate ?? 0,
    totalExtrasAnnual: object.totalExtrasAnnual ?? 0,
  }
}

export function normalizeMonthlyProposalRows(rows: unknown[]): MonthlyProposalReportRow[] {
  return rows.map((raw) => {
    const row = asObject(raw)
    const proposal = asObject(row.proposal)
    return {
      id: String(row.id ?? ''),
      sessionId: String(row.session_id ?? ''),
      kindergartenId: String(proposal.kindergarten_id ?? ''),
      kindergartenName: String(proposal.kindergarten_name_snapshot ?? '미확인'),
      targetPeriod: String(proposal.target_period ?? ''),
      versionNo: Number(row.version_no ?? 0),
      issueFormat: String(row.issue_format ?? ''),
      statementChanged: row.statement_changed == null ? null : Boolean(row.statement_changed),
      proposalAmountChanged: row.proposal_amount_changed == null ? null : Boolean(row.proposal_amount_changed),
      statementDiff: asNumberObject(row.statement_diff),
      amountDiff: asNumberObject(row.amount_diff),
      amountSnapshot: amountSnapshot(row.amount_snapshot),
      changeReasons: Array.isArray(row.change_reasons) ? row.change_reasons.map(String) : [],
      isEstimated: Boolean(row.is_estimated),
      estimateConfidence: row.estimate_confidence == null ? null : String(row.estimate_confidence),
      estimateBasis: Array.isArray(row.estimate_basis) ? row.estimate_basis.map(String) : [],
      issuedAt: String(row.issued_at ?? ''),
    }
  })
}

function styleTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, endColumn: number) {
  sheet.mergeCells(1, 1, 1, endColumn)
  const titleCell = sheet.getCell(1, 1)
  titleCell.value = title
  titleCell.font = { name: '맑은 고딕', size: 18, bold: true, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(1).height = 32
  sheet.mergeCells(2, 1, 2, endColumn)
  const subtitleCell = sheet.getCell(2, 1)
  subtitleCell.value = subtitle
  subtitleCell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF536574' } }
  subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE_BLUE } }
  sheet.getRow(2).height = 22
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 24
  row.eachCell((cell) => {
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } }
  })
}

function finishSheet(sheet: ExcelJS.Worksheet, headerRow: number) {
  sheet.views = [{ state: 'frozen', ySplit: headerRow, showGridLines: false }]
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: sheet.columnCount } }
  sheet.eachRow((row, number) => {
    if (number <= headerRow) return
    row.eachCell((cell) => {
      cell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF263238' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E6EA' } } }
    })
  })
}

function yesNo(value: boolean | null): string {
  if (value == null) return '최초 발행'
  return value ? '변경' : '변경 없음'
}

function confidenceLabel(value: string | null): string {
  return value === 'high' ? '높음' : value === 'medium' ? '보통' : value === 'low' ? '낮음' : ''
}

function issueFormatLabel(value: string): string {
  return value === 'pptx' ? 'PPTX' : value === 'pdf_print' ? 'PDF/인쇄' : '과거 추정'
}

export async function buildMonthlyProposalReport(month: string, rawRows: unknown[]): Promise<Buffer> {
  const rows = normalizeMonthlyProposalRows(rawRows)
  const summary = aggregateProposalMonth(rows.map((row) => ({
    kindergartenId: row.kindergartenId,
    versionNo: row.versionNo,
    isEstimated: row.isEstimated,
    statementChanged: row.statementChanged,
    proposalAmountChanged: row.proposalAmountChanged,
  })))
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '퍼스트컨설팅 비교 시스템'
  workbook.created = new Date()

  const overview = workbook.addWorksheet('월간 요약', { properties: { defaultRowHeight: 20 } })
  overview.columns = [
    { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 40 },
  ]
  styleTitle(overview, `${month} 제안서 발행·변경 보고서`, '한국시간 발행일 기준 · 과거 자료는 추정 신뢰도를 별도 표시', 9)
  const metrics = [
    ['유치원 수', summary.kindergartenCount, '중복 제거'],
    ['전체 발행 버전', summary.totalVersions, 'PPTX·PDF/인쇄·과거 추정 포함'],
    ['최초 발행', summary.newProposalCount, '세션별 제안서 1차 버전'],
    ['재발행', summary.reissueCount, '같은 세션의 2차 이상 발행'],
    ['명세+금액 변경', summary.bothChangedCount, '거래명세표와 월 제안금액 모두 변경'],
    ['명세만 변경', summary.statementOnlyChangedCount, '월 제안금액은 동일'],
    ['금액만 변경', summary.amountOnlyChangedCount, '거래명세표는 동일'],
    ['변경 없음', summary.neitherChangedCount, '동일 내용 재발행'],
    ['과거 추정', summary.estimatedCount, '실제 다운로드 로그가 없어 근거 기반 추정'],
  ]
  overview.addRow([])
  const metricHeader = overview.addRow(['지표', '건수', '산출 기준'])
  styleHeader(metricHeader)
  metrics.forEach((metric, index) => {
    const row = overview.addRow(metric)
    row.getCell(2).numFmt = '#,##0"건"'
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFFFFFFF' : PALE_GREEN } }
  })
  overview.addRow([])
  const kindergartenHeader = overview.addRow(['유치원', '발행 버전', '최초', '재발행', '명세 변경', '금액 변경', '과거 추정', '최신 제안금액', '비고'])
  styleHeader(kindergartenHeader)
  const byKindergarten = new Map<string, MonthlyProposalReportRow[]>()
  for (const row of rows) {
    const bucket = byKindergarten.get(row.kindergartenId) ?? []
    bucket.push(row)
    byKindergarten.set(row.kindergartenId, bucket)
  }
  for (const bucket of [...byKindergarten.values()].sort((a, b) => a[0].kindergartenName.localeCompare(b[0].kindergartenName, 'ko'))) {
    const latest = bucket[bucket.length - 1]
    overview.addRow([
      latest.kindergartenName,
      bucket.length,
      bucket.filter((row) => row.versionNo === 1).length,
      bucket.filter((row) => row.versionNo > 1).length,
      bucket.filter((row) => row.statementChanged === true).length,
      bucket.filter((row) => row.proposalAmountChanged === true).length,
      bucket.filter((row) => row.isEstimated).length,
      latest.amountSnapshot.monthlyProposedAmount,
      bucket.some((row) => row.isEstimated) ? '추정치 포함' : '',
    ])
  }
  overview.getColumn(8).numFmt = '#,##0"원"'
  finishSheet(overview, kindergartenHeader.number)

  const history = workbook.addWorksheet('제안서 버전 이력')
  history.columns = [
    { width: 20 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 16 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 24 }, { width: 38 },
  ]
  styleTitle(history, '제안서 버전 이력', '최초 발행은 변경 비교 대상이 아니며, 2차 버전부터 직전 버전과 비교', 13)
  history.addRow([])
  const historyHeader = history.addRow(['유치원', '버전', '발행 형식', '발행일시(KST)', '명세 변경', '금액 변경', '월 기존금액', '월 제안금액', '월 절감액', '제안금액 증감', '추정 신뢰도', '근거', '변경 사유'])
  styleHeader(historyHeader)
  for (const row of rows) {
    history.addRow([
      row.kindergartenName,
      row.versionNo,
      issueFormatLabel(row.issueFormat),
      new Date(row.issuedAt),
      yesNo(row.statementChanged),
      yesNo(row.proposalAmountChanged),
      row.amountSnapshot.monthlyExistingAmount,
      row.amountSnapshot.monthlyProposedAmount,
      row.amountSnapshot.monthlySavings,
      row.amountDiff.monthlyProposedAmount ?? 0,
      confidenceLabel(row.estimateConfidence),
      row.estimateBasis.join(', '),
      row.changeReasons.join(', '),
    ])
  }
  history.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm'
  for (const column of [7, 8, 9, 10]) history.getColumn(column).numFmt = '#,##0"원"'
  finishSheet(history, historyHeader.number)

  const statement = workbook.addWorksheet('거래명세표 변경 상세')
  statement.columns = [
    { width: 20 }, { width: 12 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 },
  ]
  styleTitle(statement, '거래명세표 변경 상세', '공급사·품목·규격·원산지·단위·수량·단가·금액의 정규화 스냅샷 비교', 10)
  statement.addRow([])
  const statementHeader = statement.addRow(['유치원', '버전', '발행일시(KST)', '변경 여부', '추가 행', '삭제 행', '수정 행', '직전 총액', '현재 총액', '총액 증감'])
  styleHeader(statementHeader)
  for (const row of rows.filter((item) => item.versionNo > 1)) {
    statement.addRow([
      row.kindergartenName, row.versionNo, new Date(row.issuedAt), yesNo(row.statementChanged),
      row.statementDiff.addedCount ?? 0, row.statementDiff.removedCount ?? 0, row.statementDiff.modifiedCount ?? 0,
      row.statementDiff.previousTotal ?? 0, row.statementDiff.currentTotal ?? 0, row.statementDiff.totalDelta ?? 0,
    ])
  }
  statement.getColumn(3).numFmt = 'yyyy-mm-dd hh:mm'
  for (const column of [8, 9, 10]) statement.getColumn(column).numFmt = '#,##0"원"'
  finishSheet(statement, statementHeader.number)

  const amount = workbook.addWorksheet('제안금액 변경 상세')
  amount.columns = [
    { width: 20 }, { width: 12 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 18 },
    { width: 18 }, { width: 18 }, { width: 16 }, { width: 18 },
  ]
  styleTitle(amount, '제안금액 변경 상세', '월 제안금액의 직전 발행 대비 증감을 중심으로 산출', 10)
  amount.addRow([])
  const amountHeader = amount.addRow(['유치원', '버전', '발행일시(KST)', '변경 여부', '월 기존금액', '월 제안금액', '월 제안금액 증감', '연 제안금액', '공급율', '연 부가서비스'])
  styleHeader(amountHeader)
  for (const row of rows.filter((item) => item.versionNo > 1)) {
    amount.addRow([
      row.kindergartenName, row.versionNo, new Date(row.issuedAt), yesNo(row.proposalAmountChanged),
      row.amountSnapshot.monthlyExistingAmount, row.amountSnapshot.monthlyProposedAmount,
      row.amountDiff.monthlyProposedAmount ?? 0, row.amountSnapshot.annualProposedAmount,
      row.amountSnapshot.supplyRate, row.amountSnapshot.totalExtrasAnnual,
    ])
  }
  amount.getColumn(3).numFmt = 'yyyy-mm-dd hh:mm'
  for (const column of [5, 6, 7, 8, 10]) amount.getColumn(column).numFmt = '#,##0"원"'
  amount.getColumn(9).numFmt = '0.00x'
  finishSheet(amount, amountHeader.number)

  for (const sheet of workbook.worksheets) {
    sheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    }
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

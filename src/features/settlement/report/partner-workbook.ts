import ExcelJS from 'exceljs'
import type { AdjustmentRecord } from '../data/adjustment'
import type { DeductionItem } from '../calc/deduction'
import type { ClosingPartnerRow, ClosingStatus, ClosingVenueRow } from '../calc/closing'
import type { ManualItemRecord } from '../calc/manual-item'

export interface BuildPartnerSettlementWorkbookInput {
  period: string
  status: ClosingStatus
  partner: ClosingPartnerRow
  venues: readonly ClosingVenueRow[]
  deductionItems: readonly DeductionItem[]
  adjustments: readonly AdjustmentRecord[]
  adjustmentAmounts: Readonly<Record<string, number>>
  manualItems: readonly ManualItemRecord[]
  /** 적립금 적용 제외 외부 사입을 반영한 공급가. 신규 스냅샷에서 전달한다. */
  platformFeeBaseSupply?: number
}

const MONEY = '#,##0"원"'
const QUANTITY = '#,##0.##'
const COLORS = {
  deepTeal: 'FF365A67',
  mutedTeal: 'FF6F8F8F',
  sage: 'FFB8CBC4',
  paleBlue: 'FFEAF1F4',
  paleSage: 'FFEAF0ED',
  ivory: 'FFF7F5F0',
  white: 'FFFFFFFF',
  ink: 'FF25343B',
  mutedInk: 'FF5E6D73',
  border: 'FFD4DFE2',
  accent: 'FFD9E7E3',
} as const

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: COLORS.border } },
  left: { style: 'thin', color: { argb: COLORS.border } },
  bottom: { style: 'thin', color: { argb: COLORS.border } },
  right: { style: 'thin', color: { argb: COLORS.border } },
}

function statusLabel(status: ClosingStatus): string {
  if (status === 'closed') return '최종'
  if (status === 'confirmed') return '확정 전 검토용'
  return '작성중'
}

function partnerTypeLabel(type: ClosingPartnerRow['partnerType']): string {
  return type === 'cofounder' ? '코파운더' : '영업 파트너'
}

function fill(color: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
}

function prepareSheet(
  ws: ExcelJS.Worksheet,
  frozenRows: number,
  activeCell: string
) {
  ws.properties.defaultRowHeight = 21
  ws.views = [{
    state: 'frozen',
    ySplit: frozenRows,
    topLeftCell: activeCell,
    activeCell,
    showGridLines: false,
  }]
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  }
  ws.headerFooter.oddFooter = '&L파트너 배포용&C&P / &N&RFirst Consulting'
}

function styleTitle(ws: ExcelJS.Worksheet, range: string, title: string) {
  ws.mergeCells(range)
  const cell = ws.getCell(range.split(':')[0])
  cell.value = title
  cell.fill = fill(COLORS.deepTeal)
  cell.font = { name: '맑은 고딕', size: 18, bold: true, color: { argb: COLORS.white } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(Number(cell.row)).height = 36
}

function styleSection(ws: ExcelJS.Worksheet, range: string, title: string) {
  ws.mergeCells(range)
  const cell = ws.getCell(range.split(':')[0])
  cell.value = title
  cell.fill = fill(COLORS.mutedTeal)
  cell.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: COLORS.white } }
  cell.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(Number(cell.row)).height = 25
}

function styleHeader(row: ExcelJS.Row, from: number, to: number) {
  row.height = 30
  for (let column = from; column <= to; column++) {
    const cell = row.getCell(column)
    cell.fill = fill(COLORS.deepTeal)
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: COLORS.white } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = THIN_BORDER
  }
}

function styleDataRange(
  ws: ExcelJS.Worksheet,
  fromRow: number,
  toRow: number,
  fromColumn: number,
  toColumn: number
) {
  for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber++) {
    const row = ws.getRow(rowNumber)
    if (rowNumber % 2 === 0) {
      for (let column = fromColumn; column <= toColumn; column++) {
        row.getCell(column).fill = fill(COLORS.ivory)
      }
    }
    for (let column = fromColumn; column <= toColumn; column++) {
      const cell = row.getCell(column)
      cell.font = { name: '맑은 고딕', size: 10, color: { argb: COLORS.ink } }
      cell.alignment = {
        vertical: 'middle',
        horizontal: column <= 2 ? 'left' : 'right',
        wrapText: column <= 2,
      }
      cell.border = THIN_BORDER
    }
  }
}

function setFormula(cell: ExcelJS.Cell, formula: string, result: number) {
  cell.value = { formula, result }
}

function sumFormula(column: string, startRow: number, endRow: number): string {
  return endRow < startRow ? '0' : `SUM(${column}${startRow}:${column}${endRow})`
}

function buildDetailSheet(
  wb: ExcelJS.Workbook,
  input: BuildPartnerSettlementWorkbookInput,
  ownVenues: readonly ClosingVenueRow[]
): number {
  const ws = wb.addWorksheet('유치원별 상세', { properties: { tabColor: { argb: COLORS.mutedTeal } } })
  prepareSheet(ws, 4, 'A5')
  styleTitle(ws, 'A1:K1', `${input.period} ${input.partner.partnerName} 유치원별 상세`)
  ws.getCell('A2').value = '확정 스냅샷을 기준으로 생성되며, 행별 합계와 차액은 수식으로 연결됩니다.'
  ws.getCell('A2').font = { name: '맑은 고딕', size: 9, color: { argb: COLORS.mutedInk } }
  ws.mergeCells('A2:K2')

  const headers = [
    '유치원', '구분', '원가 공급가', '원가 세액', '원가 면세', '원가 합계',
    '청구 공급가', '청구 세액', '청구 면세', '청구 합계', '차액·마진',
  ]
  ws.getRow(4).values = headers
  styleHeader(ws.getRow(4), 1, 11)

  const startRow = 5
  ownVenues.forEach((venue, index) => {
    const rowNumber = startRow + index
    const row = ws.getRow(rowNumber)
    row.values = [
      venue.companyName ?? venue.businessName,
      venue.restaurantName,
      venue.cost.taxableSupply,
      venue.cost.vat,
      venue.cost.exempt,
      undefined,
      venue.price.taxableSupply,
      venue.price.vat,
      venue.price.exempt,
      undefined,
      undefined,
    ]
    setFormula(row.getCell(6), `SUM(C${rowNumber}:E${rowNumber})`, venue.cost.total)
    setFormula(row.getCell(10), `SUM(G${rowNumber}:I${rowNumber})`, venue.price.total)
    setFormula(row.getCell(11), `J${rowNumber}-F${rowNumber}`, venue.price.total - venue.cost.total)
    for (let column = 3; column <= 11; column++) row.getCell(column).numFmt = MONEY
  })

  const lastDataRow = startRow + ownVenues.length - 1
  const totalRow = Math.max(startRow, lastDataRow + 1)
  if (ownVenues.length === 0) {
    ws.getCell(`A${startRow}`).value = '거래 내역 없음'
    ws.mergeCells(`A${startRow}:K${startRow}`)
    ws.getCell(`A${startRow}`).alignment = { horizontal: 'center' }
  } else {
    styleDataRange(ws, startRow, lastDataRow, 1, 11)
  }

  const total = ws.getRow(totalRow)
  total.getCell(1).value = '합계'
  ws.mergeCells(`A${totalRow}:B${totalRow}`)
  for (let column = 3; column <= 11; column++) {
    const letter = ws.getColumn(column).letter
    const result = column === 4
      ? input.partner.costVat
      : column === 6
        ? input.partner.costTotal
        : column === 8
          ? input.partner.priceVat
          : column === 10
            ? input.partner.priceTotal
            : column === 11
              ? input.partner.margin
              : ownVenues.reduce((sum, venue) => {
                  if (column === 3) return sum + venue.cost.taxableSupply
                  if (column === 5) return sum + venue.cost.exempt
                  if (column === 7) return sum + venue.price.taxableSupply
                  if (column === 9) return sum + venue.price.exempt
                  return sum
                }, 0)
    setFormula(total.getCell(column), sumFormula(letter, startRow, lastDataRow), result)
    total.getCell(column).numFmt = MONEY
  }
  for (let column = 1; column <= 11; column++) {
    const cell = total.getCell(column)
    cell.fill = fill(COLORS.paleSage)
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: COLORS.ink } }
    cell.alignment = { vertical: 'middle', horizontal: column <= 2 ? 'left' : 'right' }
    cell.border = THIN_BORDER
  }
  total.height = 25

  ws.columns = [
    { width: 22 }, { width: 28 },
    ...new Array(9).fill(undefined).map(() => ({ width: 15 })),
  ]
  ws.autoFilter = 'A4:K4'
  ws.pageSetup.printTitlesRow = '1:4'
  ws.pageSetup.printArea = `A1:K${totalRow}`
  return totalRow
}

function buildEvidenceSheet(
  wb: ExcelJS.Workbook,
  input: BuildPartnerSettlementWorkbookInput,
  ownAdjustments: readonly AdjustmentRecord[],
  ownManual: readonly ManualItemRecord[]
): number {
  const ws = wb.addWorksheet('공제·조정·외부사입', { properties: { tabColor: { argb: COLORS.sage } } })
  prepareSheet(ws, 3, 'A4')
  styleTitle(ws, 'A1:L1', '공제·조정·외부 사입 산출 근거')
  ws.getCell('A2').value = '사업자공제 합계는 정산 요약 시트에서 직접 참조합니다.'
  ws.getCell('A2').font = { name: '맑은 고딕', size: 9, color: { argb: COLORS.mutedInk } }
  ws.mergeCells('A2:L2')

  ws.getRow(3).values = ['사업자공제 항목', '금액', '비고']
  styleHeader(ws.getRow(3), 1, 3)
  const deductionStart = 4
  if (input.deductionItems.length === 0) {
    ws.getCell(`A${deductionStart}`).value = '없음'
  } else {
    input.deductionItems.forEach((item, index) => {
      const row = ws.getRow(deductionStart + index)
      row.values = [item.category, item.amount, item.note ?? '']
      row.getCell(2).numFmt = MONEY
    })
  }
  const deductionLast = deductionStart + Math.max(input.deductionItems.length, 1) - 1
  styleDataRange(ws, deductionStart, deductionLast, 1, 3)
  const deductionTotalRow = deductionLast + 1
  const deductionTotal = ws.getRow(deductionTotalRow)
  deductionTotal.values = ['사업자공제 합계', undefined, '정산 요약 참조 셀']
  setFormula(
    deductionTotal.getCell(2),
    input.deductionItems.length === 0 ? '0' : `SUM(B${deductionStart}:B${deductionLast})`,
    input.partner.businessDeduction
  )
  deductionTotal.getCell(2).numFmt = MONEY
  for (let column = 1; column <= 3; column++) {
    const cell = deductionTotal.getCell(column)
    cell.fill = fill(COLORS.paleSage)
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: COLORS.ink } }
    cell.border = THIN_BORDER
  }

  const adjustmentTitleRow = deductionTotalRow + 2
  styleSection(ws, `A${adjustmentTitleRow}:H${adjustmentTitleRow}`, '품목 조정 내역')
  const adjustmentHeaderRow = adjustmentTitleRow + 1
  ws.getRow(adjustmentHeaderRow).values = [
    '유치원', '식당', '일자', '품목', '수량', '금액', '사유', '요청자',
  ]
  styleHeader(ws.getRow(adjustmentHeaderRow), 1, 8)
  const adjustmentStart = adjustmentHeaderRow + 1
  if (ownAdjustments.length === 0) {
    ws.getCell(`A${adjustmentStart}`).value = '없음'
  } else {
    ownAdjustments.forEach((item, index) => {
      const row = ws.getRow(adjustmentStart + index)
      row.values = [
        item.businessName,
        item.restaurantName,
        item.itemDate,
        item.productName,
        item.quantity,
        input.adjustmentAmounts[item.id] ?? 0,
        item.reason,
        item.requestedBy,
      ]
      row.getCell(5).numFmt = QUANTITY
      row.getCell(6).numFmt = MONEY
    })
  }
  const adjustmentLast = adjustmentStart + Math.max(ownAdjustments.length, 1) - 1
  styleDataRange(ws, adjustmentStart, adjustmentLast, 1, 8)

  const manualTitleRow = adjustmentLast + 2
  styleSection(ws, `A${manualTitleRow}:L${manualTitleRow}`, '외부 사입·임의 청구 내역')
  const manualHeaderRow = manualTitleRow + 1
  ws.getRow(manualHeaderRow).values = [
    '유치원', '거래일', '품목', '수량', '단위', '매입처', '매입가', '청구가',
    '파트너 정산', '적립금', '부담 주체', '사유',
  ]
  styleHeader(ws.getRow(manualHeaderRow), 1, 12)
  const manualStart = manualHeaderRow + 1
  if (ownManual.length === 0) {
    ws.getCell(`A${manualStart}`).value = '없음'
  } else {
    ownManual.forEach((item, index) => {
      const row = ws.getRow(manualStart + index)
      row.values = [
        item.businessName,
        item.transactionDate,
        item.productName,
        item.quantity,
        item.unit,
        item.vendorName,
        item.purchase.total,
        item.charge.total,
        item.partnerIncluded ? '포함' : '제외',
        item.platformFeeApplies ? '적용' : '미적용',
        item.burden === 'venue' ? '유치원' : item.burden === 'partner' ? '파트너' : '본사',
        item.reason,
      ]
      row.getCell(4).numFmt = QUANTITY
      row.getCell(7).numFmt = MONEY
      row.getCell(8).numFmt = MONEY
    })
  }
  const manualLast = manualStart + Math.max(ownManual.length, 1) - 1
  styleDataRange(ws, manualStart, manualLast, 1, 12)

  ws.columns = [
    { width: 22 }, { width: 16 }, { width: 27 }, { width: 11 }, { width: 11 },
    { width: 18 }, { width: 15 }, { width: 15 }, { width: 14 }, { width: 13 },
    { width: 13 }, { width: 34 },
  ]
  ws.pageSetup.printTitlesRow = '1:3'
  ws.pageSetup.printArea = `A1:L${manualLast}`
  return deductionTotalRow
}

function buildSummarySheet(
  wb: ExcelJS.Workbook,
  input: BuildPartnerSettlementWorkbookInput,
  detailTotalRow: number,
  deductionTotalRow: number,
  platformFeeBaseSupply: number
) {
  const { partner } = input
  const ws = wb.getWorksheet('정산 요약')
    ?? wb.addWorksheet('정산 요약', { properties: { tabColor: { argb: COLORS.deepTeal } } })
  prepareSheet(ws, 6, 'A7')
  styleTitle(ws, 'A1:F1', `${input.period} ${partner.partnerName} 파트너 정산서`)

  const metadata: Array<[string, string, string, string]> = [
    ['정산월', input.period, '생성 상태', statusLabel(input.status)],
    ['파트너', partner.partnerName, '자료 기준', '확정 스냅샷'],
    ['안내', '금액 셀은 관련 시트와 수식으로 연결됩니다.', '단위', '원'],
  ]
  metadata.forEach((values, index) => {
    const row = ws.getRow(index + 2)
    row.values = values
    row.getCell(1).font = row.getCell(3).font = {
      name: '맑은 고딕', size: 9, bold: true, color: { argb: COLORS.mutedInk },
    }
    row.getCell(2).font = row.getCell(4).font = {
      name: '맑은 고딕', size: 9, color: { argb: COLORS.ink },
    }
  })

  styleSection(ws, 'A6:B6', '정산 요약')
  styleSection(ws, 'D6:F6', '산출 근거')

  const summaryRows: Array<[string, string, number]> = [
    ['원가 합계', `'유치원별 상세'!F${detailTotalRow}`, partner.costTotal],
    ['유치원 청구 합계', `'유치원별 상세'!J${detailTotalRow}`, partner.priceTotal],
    ['차액·마진', `'유치원별 상세'!K${detailTotalRow}`, partner.margin],
    ['적립금', 'ROUNDUP($E$9*$E$8/100,-1)', partner.platformFee],
    ['부가세차액', '$E$11-$E$10', partner.vatDiff],
    ['사업자공제', `'공제·조정·외부사입'!B${deductionTotalRow}`, partner.businessDeduction],
    ['지급액(세전)', 'B9-B10-B11-B12', partner.preTax],
    ['소득세', 'ROUNDDOWN(B17*3%,-1)', partner.incomeTax],
    ['지방소득세', 'ROUNDDOWN(B14*10%,-1)', partner.localTax],
    ['실지급액', 'B13-B14-B15', partner.netPay],
    ['사업소득 신고액', 'IF($E$7="코파운더",B13+B10,B13)', partner.declared],
  ]
  summaryRows.forEach(([label, formula, result], index) => {
    const rowNumber = 7 + index
    const row = ws.getRow(rowNumber)
    row.getCell(1).value = label
    setFormula(row.getCell(2), formula, result)
    row.getCell(2).numFmt = MONEY
    row.height = rowNumber === 16 ? 30 : 24
    for (let column = 1; column <= 2; column++) {
      const cell = row.getCell(column)
      cell.fill = fill(rowNumber === 16 ? COLORS.accent : rowNumber % 2 === 0 ? COLORS.ivory : COLORS.white)
      cell.font = {
        name: '맑은 고딕',
        size: rowNumber === 16 ? 12 : 10,
        bold: rowNumber === 16 || column === 1,
        color: { argb: COLORS.ink },
      }
      cell.alignment = { vertical: 'middle', horizontal: column === 1 ? 'left' : 'right' }
      cell.border = THIN_BORDER
    }
  })

  const evidence: Array<[string, string | number, string]> = [
    ['파트너 유형', partnerTypeLabel(partner.partnerType), '신고액 산식 구분'],
    ['적용 수수료율', partner.commissionPercent, '적립금 계산 비율'],
    ['적립금 기준 공급가', platformFeeBaseSupply, '적립금 미적용 외부 사입 제외'],
    ['원가 세액', '', `유치원별 상세 D${detailTotalRow} 참조`],
    ['청구 세액', '', `유치원별 상세 H${detailTotalRow} 참조`],
    ['사업자공제 합계', '', `공제·조정·외부사입 B${deductionTotalRow} 참조`],
    ['계산 기준', statusLabel(input.status), '확정 스냅샷 재현'],
  ]
  evidence.forEach(([label, value, note], index) => {
    const rowNumber = 7 + index
    const row = ws.getRow(rowNumber)
    row.getCell(4).value = label
    if (rowNumber === 10) setFormula(row.getCell(5), `'유치원별 상세'!D${detailTotalRow}`, partner.costVat)
    else if (rowNumber === 11) setFormula(row.getCell(5), `'유치원별 상세'!H${detailTotalRow}`, partner.priceVat)
    else if (rowNumber === 12) {
      setFormula(row.getCell(5), `'공제·조정·외부사입'!B${deductionTotalRow}`, partner.businessDeduction)
    } else row.getCell(5).value = value
    row.getCell(6).value = note
    if (rowNumber >= 8 && rowNumber <= 12) row.getCell(5).numFmt = rowNumber === 8 ? '0.##"%"' : MONEY
    for (let column = 4; column <= 6; column++) {
      const cell = row.getCell(column)
      cell.fill = fill(rowNumber % 2 === 0 ? COLORS.ivory : COLORS.white)
      cell.font = {
        name: '맑은 고딕', size: 9, bold: column === 4, color: { argb: COLORS.ink },
      }
      cell.alignment = {
        vertical: 'middle',
        horizontal: column === 5 && rowNumber >= 8 && rowNumber <= 12 ? 'right' : 'left',
        wrapText: true,
      }
      cell.border = THIN_BORDER
    }
  })

  styleSection(ws, 'D15:F15', '계산식 안내')
  const formulaNotes = [
    ['적립금', '기준 공급가 × 수수료율', '10원 단위 올림'],
    ['부가세차액', '청구 세액 − 원가 세액', '세액 차이 반영'],
    ['지급액(세전)', '마진 − 적립금 − 부가세차액 − 공제', '파트너 세전 지급액'],
    ['세금', '신고액의 소득세 3% + 지방소득세', '각 10원 단위 절사'],
    ['실지급액', '세전 지급액 − 소득세 − 지방소득세', '최종 송금 기준'],
  ]
  formulaNotes.forEach((values, index) => {
    const row = ws.getRow(16 + index)
    values.forEach((value, valueIndex) => {
      row.getCell(4 + valueIndex).value = value
    })
    for (let column = 4; column <= 6; column++) {
      const cell = row.getCell(column)
      cell.fill = fill(index % 2 === 0 ? COLORS.paleBlue : COLORS.white)
      cell.font = {
        name: '맑은 고딕', size: 9, bold: column === 4, color: { argb: COLORS.ink },
      }
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
      cell.border = THIN_BORDER
    }
  })

  ws.columns = [
    { width: 22 }, { width: 19 }, { width: 3 }, { width: 22 }, { width: 20 }, { width: 36 },
  ]
  ws.pageSetup.printArea = 'A1:F20'
}

/** 파트너 한 명에게만 배포하는 독립 워크북. 다른 파트너 데이터는 입력부터 받지 않는다. */
export function buildPartnerSettlementWorkbook(
  input: BuildPartnerSettlementWorkbookInput
): ExcelJS.Workbook {
  const { partner } = input
  const ownVenues = input.venues.filter(
    (venue) => !venue.isExcluded && venue.partnerId === partner.partnerId
  )
  const ownKeys = new Set(ownVenues.map((venue) => `${venue.source}:${venue.businessCode}`))
  const ownNames = new Set(
    ownVenues.map((venue) => `${venue.businessName}\0${venue.restaurantName}`)
  )
  const ownAdjustments = input.adjustments.filter((adjustment) =>
    ownNames.has(`${adjustment.businessName}\0${adjustment.restaurantName}`)
  )
  const ownManual = input.manualItems.filter(
    (item) => item.status === 'approved' && ownKeys.has(`${item.source}:${item.businessCode}`)
  )
  const platformFeeBaseSupply = input.platformFeeBaseSupply
    ?? ownVenues.reduce((sum, venue) => sum + venue.cost.total - venue.cost.vat, 0)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'First Consulting'
  wb.company = 'First Consulting'
  wb.subject = `${input.period} ${partner.partnerName} 파트너 정산서`
  wb.calcProperties.fullCalcOnLoad = true

  // 요약 탭을 먼저 만든 뒤 참조 대상 시트의 셀 주소를 채운다.
  wb.addWorksheet('정산 요약', { properties: { tabColor: { argb: COLORS.deepTeal } } })
  const detailTotalRow = buildDetailSheet(wb, input, ownVenues)
  const deductionTotalRow = buildEvidenceSheet(wb, input, ownAdjustments, ownManual)
  buildSummarySheet(wb, input, detailTotalRow, deductionTotalRow, platformFeeBaseSupply)
  wb.views = [{
    x: 0, y: 0, width: 16000, height: 10000, firstSheet: 0, activeTab: 0, visibility: 'visible',
  }]
  return wb
}

/** ExcelJS의 ArrayBuffer를 ZIP 입력용 Uint8Array로 굳힌다. */
export async function writePartnerSettlementWorkbook(
  input: BuildPartnerSettlementWorkbookInput
): Promise<Uint8Array> {
  const out = await buildPartnerSettlementWorkbook(input).xlsx.writeBuffer()
  return new Uint8Array(out as unknown as ArrayBuffer)
}

function safeFilePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '파트너'
}

export function partnerReportFileName(
  period: string,
  partnerName: string,
  status: ClosingStatus
): string {
  return `${safeFilePart(period)}_${safeFilePart(partnerName)}_파트너정산서_${statusLabel(status)}.xlsx`
}

import 'server-only'
import ExcelJS from 'exceljs'
import type { CjStatementItem } from '../parse/cj-statement'
import type { InvoiceRow } from './invoice-sheet'

const NAVY = '334E68'
const BLUE = 'D9EAF2'
const PALE = 'F5F8FA'
const BORDER = 'C7D3DD'

export async function writeCjVenueStatementXlsx(input: {
  period: string
  businessName: string
  items: readonly CjStatementItem[]
  finalInvoiceRows?: readonly InvoiceRow[]
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  wb.creator = '급식 정산 시스템'
  wb.created = new Date()

  const detail = wb.addWorksheet('거래명세서', {
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.15, footer: 0.15 },
    },
  })
  detail.views = [{ state: 'frozen', ySplit: 4 }]
  detail.mergeCells('A1:M1')
  detail.getCell('A1').value = `${input.businessName} 거래명세서`
  detail.getCell('A2').value = '정산월'
  detail.getCell('B2').value = input.period
  detail.getCell('D2').value = '금액 기준'
  detail.getCell('E2').value = 'CJ 공급사 원본(원단위)'
  const headers = [
    '납품일', '식당명', '상품코드', '상품명', '원산지', '단위', '수량', '단가',
    '과세 공급가', '면세', '공급가 합계', '부가세', '총액',
  ]
  detail.addRow([])
  detail.addRow(headers)
  for (const item of input.items) {
    detail.addRow([
      item.date,
      item.restaurantName,
      item.productCode,
      item.productName,
      item.origin,
      item.unit,
      item.quantity,
      item.unitPrice,
      item.tax.taxableSupply,
      item.tax.exempt,
      item.tax.taxableSupply + item.tax.exempt,
      item.tax.vat,
      item.tax.total,
    ])
  }
  const detailLastRow = 4 + input.items.length
  detail.autoFilter = `A4:M${Math.max(4, detailLastRow)}`
  detail.pageSetup.printArea = `A1:M${Math.max(4, detailLastRow)}`
  detail.pageSetup.printTitlesRow = '1:4'

  const summary = wb.addWorksheet('집계표', {
    pageSetup: {
      orientation: 'landscape',
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.15, footer: 0.15 },
    },
  })
  summary.mergeCells('A1:H1')
  summary.getCell('A1').value = `${input.businessName} 월 집계표`
  summary.getCell('A2').value = '정산월'
  summary.getCell('B2').value = input.period
  summary.getCell('D2').value = '검증 기준'
  summary.getCell('E2').value = '집계표 총액 = 거래명세서 총액'
  summary.addRow([])
  summary.addRow(['식당명', '과세 공급가', '면세', '공급가 합계', '부가세', '총액', '품목 수', '산출 근거'])

  const restaurants = [...new Set(input.items.map((item) => item.restaurantName))].sort((a, b) =>
    a.localeCompare(b, 'ko')
  )
  for (const name of restaurants) {
    const row = summary.addRow([name])
    const n = row.number
    row.getCell(2).value = { formula: `SUMIF('거래명세서'!$B$5:$B$${detailLastRow},A${n},'거래명세서'!$I$5:$I$${detailLastRow})` }
    row.getCell(3).value = { formula: `SUMIF('거래명세서'!$B$5:$B$${detailLastRow},A${n},'거래명세서'!$J$5:$J$${detailLastRow})` }
    row.getCell(4).value = { formula: `B${n}+C${n}` }
    row.getCell(5).value = { formula: `SUMIF('거래명세서'!$B$5:$B$${detailLastRow},A${n},'거래명세서'!$L$5:$L$${detailLastRow})` }
    row.getCell(6).value = { formula: `D${n}+E${n}` }
    row.getCell(7).value = { formula: `COUNTIF('거래명세서'!$B$5:$B$${detailLastRow},A${n})` }
    row.getCell(8).value = '거래명세서 식당명 기준 SUMIF'
  }
  const totalRow = summary.addRow(['합계'])
  for (let col = 2; col <= 7; col++) {
    const letter = String.fromCharCode(64 + col)
    totalRow.getCell(col).value = { formula: `SUM(${letter}5:${letter}${totalRow.number - 1})` }
  }
  totalRow.getCell(8).value = `거래명세서 ${input.items.length.toLocaleString('ko-KR')}개 품목`

  // 오른쪽에는 유치원에 실제 청구할 계산서 기준 금액을 둔다. CJ 1016 승인 조정도
  // 여기에 반영되며, 왼쪽 공급사 원본 집계는 바뀌지 않아 차이의 근거가 남는다.
  summary.getCell('J2').value = '최종 청구 기준'
  summary.getCell('K2').value = '세금계산서·계산서 발행 금액'
  ;['구분', '품목', '공급가', '부가세', '합계', '산출 근거'].forEach((value, index) => {
    summary.getRow(4).getCell(10 + index).value = value
  })
  const finalRows = input.finalInvoiceRows ?? []
  let finalRowNo = 5
  for (const row of finalRows) {
    summary.getRow(finalRowNo).getCell(10).value = row.taxKind === 'taxable' ? '과세' : '면세'
    summary.getRow(finalRowNo).getCell(11).value = row.itemName
    summary.getRow(finalRowNo).getCell(12).value = row.supply
    summary.getRow(finalRowNo).getCell(13).value = row.vat
    summary.getRow(finalRowNo).getCell(14).value = { formula: `L${finalRowNo}+M${finalRowNo}` }
    summary.getRow(finalRowNo).getCell(15).value = '공급사 원본 + 승인된 예외조정'
    finalRowNo += 1
  }
  const finalTotalRow = Math.max(5, finalRowNo)
  summary.getRow(finalTotalRow).getCell(10).value = '최종 합계'
  summary.getRow(finalTotalRow).getCell(12).value = { formula: `SUM(L5:L${finalTotalRow - 1})` }
  summary.getRow(finalTotalRow).getCell(13).value = { formula: `SUM(M5:M${finalTotalRow - 1})` }
  summary.getRow(finalTotalRow).getCell(14).value = { formula: `L${finalTotalRow}+M${finalTotalRow}` }
  summary.getRow(finalTotalRow).font = { bold: true, color: { argb: NAVY } }
  summary.getRow(finalTotalRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }

  summary.pageSetup.printArea = `A1:O${Math.max(totalRow.number, finalTotalRow)}`
  summary.pageSetup.printTitlesRow = '1:4'
  summary.views = [{ state: 'frozen', ySplit: 4 }]

  styleSheet(detail, 13)
  styleSheet(summary, 15)
  summary.columns = [24, 16, 16, 16, 14, 16, 11, 28, 3, 12, 22, 16, 14, 16, 30].map((width) => ({ width }))
  detail.columns = [13, 22, 14, 28, 15, 10, 10, 13, 16, 14, 16, 14, 16].map((width) => ({ width }))
  totalRow.font = { bold: true, color: { argb: NAVY } }
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
  for (let col = 10; col <= 15; col++) {
    const cell = summary.getRow(4).getCell(col)
    cell.font = { bold: true, color: { argb: 'FFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  }

  const bytes = await wb.xlsx.writeBuffer()
  return new Uint8Array(bytes)
}

function styleSheet(ws: ExcelJS.Worksheet, width: number): void {
  ws.getCell('A1').font = { bold: true, size: 18, color: { argb: NAVY } }
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(1).height = 30
  const header = ws.getRow(4)
  header.font = { bold: true, color: { argb: 'FFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  header.height = 28
  for (let row = 5; row <= ws.rowCount; row++) {
    if (row % 2 === 0) {
      ws.getRow(row).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } }
    }
    for (let col = 1; col <= width; col++) {
      const cell = ws.getRow(row).getCell(col)
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER } },
        left: { style: 'thin', color: { argb: BORDER } },
        bottom: { style: 'thin', color: { argb: BORDER } },
        right: { style: 'thin', color: { argb: BORDER } },
      }
      cell.alignment = { vertical: 'middle', wrapText: true }
      if (col >= 7 && col <= 13) cell.numFmt = '#,##0'
    }
  }
}

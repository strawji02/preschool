import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { writeCjVenueStatementXlsx } from '@/features/settlement'

describe('CJ 유치원 청구 파일', () => {
  it('집계표와 거래명세서 정확히 2시트이며 집계표는 명세서를 수식으로 참조한다', async () => {
    const bytes = await writeCjVenueStatementXlsx({
      period: '2026-08',
      businessName: '인천 복자유치원',
      items: [
        {
          date: '2026-08-01',
          businessName: '키즈웰에듀푸드(복자유치원)',
          restaurantName: '급식',
          productCode: 'P1',
          productName: '쌀',
          origin: '국산',
          unit: '10kg',
          quantity: 2,
          unitPrice: 50_000,
          tax: { taxableSupply: 0, vat: 0, exempt: 100_000, total: 100_000 },
        },
      ],
      finalInvoiceRows: [
        {
          taxKind: 'exempt',
          buyer: {
            bizRegNo: '1234567890', companyName: '인천 복자유치원', ceoName: '대표자',
            address: '인천', bizType: '교육', bizItem: '유치원', email: 'a@example.com',
          },
          itemName: '급식재료',
          supply: 99_999,
          vat: 0,
          mergedFrom: 1,
          venueKeys: ['cj:1016'],
          roundingDiff: 0,
        },
      ],
    })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(bytes) as never)

    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual(['거래명세서', '집계표'])
    expect(String(wb.getWorksheet('집계표')!.getCell('C5').formula)).toContain("'거래명세서'!")
    expect(wb.getWorksheet('집계표')!.getCell('L5').value).toBe(99_999)
    expect(wb.getWorksheet('집계표')!.getCell('J7').value).toBe('조정 증감')
    expect(wb.getWorksheet('집계표')!.getCell('N7').formula).toBe('N6-F6')
    expect(wb.getWorksheet('거래명세서')!.pageSetup.fitToWidth).toBe(1)
    expect(wb.getWorksheet('집계표')!.pageSetup.fitToWidth).toBe(1)
  })
})

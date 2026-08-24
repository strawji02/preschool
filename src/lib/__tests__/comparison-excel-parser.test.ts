import { File as NodeFile } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseInvoiceExcel } from '@/lib/excel-parser'
import { extractSupplierName } from '@/lib/supplier-name'

function makeWorkbookFile(rows: unknown[][], name = '거래내역서_소망유치원_2026년06월.xlsx'): File {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '거래내역서')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new NodeFile([new Uint8Array(bytes)], name) as unknown as File
}

describe('비교 거래내역서 엑셀 파서', () => {
  it('푸디스트 입고 열을 읽고 음수 매출 보정 행도 보존한다', async () => {
    const file = makeWorkbookFile([
      ['거래내역서 (소망유치원)'],
      ['사업장 : 소망유치원 | 식당 : 전체 | 공급업체 : 푸디스트 주식회사'],
      [],
      [
        'NO.', '입고일', '상품코드', '상품명', '규격', '원산지', '단위', '과/면',
        '단가', '입고량', '입고금액', '부가세', '입고총액',
      ],
      [1, '2026-06-01', 'F101709', '브로콜리(국내산)', 'KG', '국내', 'KG', '면세', 5520, 2, 11040, 0, 11040],
      [2, '2026-06-01', 'F120526', '부침가루(오뚜기)', '1KG', '국내', 'EA', '과세', 2880, 2, 5760, 576, 6336],
      [3, '2026-06-30', '709999999997', '과세매출보정자재', '매출결산 보정', '국내', 'EA', '과세', 0, 1, 0, -7, -7],
    ])

    const result = await parseInvoiceExcel(file)

    expect(result.success).toBe(true)
    expect(result.items).toHaveLength(3)
    expect(result.items[0]).toMatchObject({
      quantity: 2,
      unit_price: 5520,
      supply_amount: 11040,
      tax_amount: 0,
      total_price: 11040,
    })
    expect(result.items[1]).toMatchObject({
      quantity: 2,
      supply_amount: 5760,
      tax_amount: 576,
      total_price: 6336,
    })
    expect(result.items[2]).toMatchObject({
      name: '과세매출보정자재',
      quantity: 1,
      supply_amount: 0,
      tax_amount: -7,
      total_price: -7,
    })
    expect(result.items.filter((item) =>
      (item.supply_amount ?? item.quantity * item.unit_price)
        + (item.tax_amount ?? 0) !== item.total_price
    )).toHaveLength(0)
  })

  it('기관명 뒤에 정산월이 붙은 파일명에서는 날짜가 아니라 기관명을 고른다', () => {
    expect(extractSupplierName('거래내역서_소망유치원_2026년06월.xlsx')).toBe('소망유치원')
    expect(extractSupplierName('8월 급식 거래명세서_만안.xlsx')).toBe('만안')
  })

  it('공급가·총액 없이 세액 0원 열만 있으면 단가 곱하기 수량을 사용한다', async () => {
    const file = makeWorkbookFile([
      ['품명', '수량', '단가', '세액'],
      ['양파', 3, 1000, 0],
    ], '간단명세서_만안.xlsx')

    const result = await parseInvoiceExcel(file)

    expect(result.success).toBe(true)
    expect(result.items[0]).toMatchObject({
      quantity: 3,
      unit_price: 1000,
      supply_amount: 3000,
      tax_amount: 0,
      total_price: 3000,
    })
  })
})

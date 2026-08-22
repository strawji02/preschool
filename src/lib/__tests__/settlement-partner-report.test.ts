import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  buildPartnerSettlementWorkbook,
  createZipArchive,
  partnerReportFileName,
  writePartnerSettlementWorkbook,
  type ClosingPartnerRow,
  type ClosingVenueRow,
  type ManualItemRecord,
} from '@/features/settlement'

const breakdown = (total: number) => ({
  taxableSupply: total,
  vat: 0,
  exempt: 0,
  total,
})

const partners: ClosingPartnerRow[] = [
  {
    partnerId: 'p1', partnerName: '김명일', partnerType: 'partner', commissionPercent: 5,
    costTotal: 100, costVat: 0, priceTotal: 150, priceVat: 0, margin: 50,
    platformFee: 10, vatDiff: 0, businessDeduction: 5, preTax: 35,
    declared: 35, incomeTax: 0, localTax: 0, netPay: 35,
  },
  {
    partnerId: 'p2', partnerName: '다른파트너', partnerType: 'partner', commissionPercent: 5,
    costTotal: 200, costVat: 0, priceTotal: 300, priceVat: 0, margin: 100,
    platformFee: 20, vatDiff: 0, businessDeduction: 0, preTax: 80,
    declared: 80, incomeTax: 0, localTax: 0, netPay: 80,
  },
]

const venues: ClosingVenueRow[] = [
  {
    source: 'cj', businessCode: '1001', businessName: '가유치원', restaurantCode: 'R1',
    restaurantName: '급식재료', companyName: '가유치원', partnerId: 'p1', partnerName: '김명일',
    isExcluded: false, exclusionReason: null, cost: breakdown(100), price: breakdown(150),
  },
  {
    source: 'cj', businessCode: '1002', businessName: '나유치원', restaurantCode: 'R2',
    restaurantName: '급식재료', companyName: '나유치원', partnerId: 'p2', partnerName: '다른파트너',
    isExcluded: false, exclusionReason: null, cost: breakdown(200), price: breakdown(300),
  },
]

const manualItem = {
  id: 'm1', period: '2026-08', kind: 'billable', status: 'approved', source: 'cj',
  businessCode: '1001', businessName: '가유치원', restaurantCode: null, restaurantName: null,
  transactionDate: '2026-08-20', deliveryDate: '2026-08-21', productName: '김 선물세트',
  invoiceItemName: '선물세트', specification: '', unit: '세트', quantity: 20,
  vendorName: '쿠팡', orderNumber: 'A1', purchaseTaxKind: 'taxable', purchase: breakdown(100),
  chargeTaxKind: 'taxable', charge: breakdown(150), burden: 'venue', partnerIncluded: true,
  platformFeeApplies: true, invoiceMode: 'separate', reason: '요청', requestedBy: '원장',
  duplicateOverrideReason: null, createdBy: 'a', createdAt: '2026-08-20', updatedBy: 'a',
  updatedAt: '2026-08-20', approvedBy: 'a', approvedAt: '2026-08-20', cancelledBy: null,
  cancelledAt: null, cancelReason: null, evidence: [],
} satisfies ManualItemRecord

describe('파트너 배포용 정산서', () => {
  it('선택한 파트너 자료만 3개 시트에 담는다', () => {
    const wb = buildPartnerSettlementWorkbook({
      period: '2026-08', status: 'closed', partner: partners[0], venues,
      deductionItems: [{ category: '커피차', amount: 5 }], adjustments: [],
      adjustmentAmounts: {}, manualItems: [manualItem],
    })
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual([
      '정산 요약', '유치원별 상세', '공제·조정·외부사입',
    ])

    const text = wb.worksheets.flatMap((sheet) =>
      sheet.getSheetValues().flatMap((row) => Array.isArray(row) ? row : [])
    ).join('\n')
    expect(text).toContain('김명일')
    expect(text).toContain('가유치원')
    expect(text).toContain('김 선물세트')
    expect(text).not.toContain('다른파트너')
    expect(text).not.toContain('나유치원')
    expect(text).not.toContain('주민번호')
  })

  it('파일명에서 경로 문자를 제거하고 최종 상태를 표시한다', () => {
    expect(partnerReportFileName('2026-08', '김/명일', 'closed')).toBe(
      '2026-08_김_명일_파트너정산서_최종.xlsx'
    )
  })

  it('승인 전·취소된 외부 사입은 배포 파일에 노출하지 않는다', () => {
    const wb = buildPartnerSettlementWorkbook({
      period: '2026-08', status: 'confirmed', partner: partners[0], venues,
      deductionItems: [], adjustments: [], adjustmentAmounts: {},
      manualItems: [
        { ...manualItem, id: 'draft-item', status: 'draft', productName: '승인 전 품목' },
        { ...manualItem, id: 'cancel-item', status: 'cancelled', productName: '취소 품목' },
      ],
    })
    const text = wb.getWorksheet('공제·조정·외부사입')!
      .getSheetValues()
      .flatMap((row) => Array.isArray(row) ? row : [])
      .join('\n')
    expect(text).not.toContain('승인 전 품목')
    expect(text).not.toContain('취소 품목')
  })

  it('요약 금액을 상세·근거 시트 참조 수식으로 연결하고 산출 근거를 표시한다', () => {
    const wb = buildPartnerSettlementWorkbook({
      period: '2026-08', status: 'closed', partner: partners[0], venues,
      deductionItems: [{ category: '커피차', amount: 5 }], adjustments: [],
      adjustmentAmounts: {}, manualItems: [manualItem], platformFeeBaseSupply: 100,
    })
    const summary = wb.getWorksheet('정산 요약')!
    const detail = wb.getWorksheet('유치원별 상세')!

    expect(summary.getCell('B7').value).toMatchObject({
      formula: "'유치원별 상세'!F6",
      result: 100,
    })
    expect(summary.getCell('B12').value).toMatchObject({
      formula: "'공제·조정·외부사입'!B5",
      result: 5,
    })
    expect(summary.getCell('B16').value).toMatchObject({
      formula: 'B13-B14-B15',
      result: 35,
    })
    expect(detail.getCell('F5').value).toMatchObject({ formula: 'SUM(C5:E5)', result: 100 })
    expect(summary.getCell('D6').value).toBe('산출 근거')
    expect(summary.getCell('D15').value).toBe('계산식 안내')
  })

  it('차분한 색상·고정 영역·통화 형식을 적용한다', () => {
    const wb = buildPartnerSettlementWorkbook({
      period: '2026-08', status: 'closed', partner: partners[0], venues,
      deductionItems: [], adjustments: [], adjustmentAmounts: {}, manualItems: [],
    })
    const summary = wb.getWorksheet('정산 요약')!
    const detail = wb.getWorksheet('유치원별 상세')!

    expect(summary.getCell('A1').fill).toMatchObject({
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF365A67' },
    })
    expect(summary.getCell('B7').numFmt).toBe('#,##0"원"')
    expect(summary.views[0]).toMatchObject({ showGridLines: false, state: 'frozen' })
    expect(detail.autoFilter).toEqual('A4:K4')
    expect(detail.views[0]).toMatchObject({ showGridLines: false, state: 'frozen', ySplit: 4 })
  })

  it('ZIP에 넣을 XLSX를 실제 Uint8Array로 직렬화한다', async () => {
    const bytes = await writePartnerSettlementWorkbook({
      period: '2026-08', status: 'closed', partner: partners[0], venues,
      deductionItems: [], adjustments: [], adjustmentAmounts: {}, manualItems: [manualItem],
    })
    expect(bytes).toBeInstanceOf(Uint8Array)
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual(['정산 요약', '유치원별 상세', '공제·조정·외부사입'])
  })
})

describe('ZIP 생성', () => {
  it('여러 파일을 표준 ZIP 구조로 묶고 한글 파일명을 남긴다', () => {
    const zip = createZipArchive([
      { name: '김명일.xlsx', bytes: new Uint8Array([1, 2, 3]) },
      { name: '이동현.xlsx', bytes: new Uint8Array([4, 5]) },
    ])
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(new TextDecoder().decode(zip)).toContain('김명일.xlsx')
    expect([...zip.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06])
  })
})

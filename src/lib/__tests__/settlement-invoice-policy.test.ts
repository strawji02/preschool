import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INVOICE_OVERRIDE_REASON,
  applyInvoiceOverrides,
  applyInvoiceOverrideDeltaToClosingVenues,
  closingTotals,
  collectInvoiceRows,
  rollupByKindergarten,
  validateInvoiceOverrideDraft,
  type InvoiceOverride,
  type InvoiceParty,
  type InvoiceVenueLine,
} from '@/features/settlement'

const BUYER: InvoiceParty = {
  bizRegNo: '1234567890',
  companyName: '인천 복자유치원',
  ceoName: '대표자',
  address: '인천광역시',
  bizType: '교육서비스',
  bizItem: '유치원',
  email: 'billing@example.com',
}

function line(over: Partial<InvoiceVenueLine> = {}): InvoiceVenueLine {
  return {
    source: 'cj',
    businessCode: '1005',
    businessName: '해밀유치원',
    restaurantCode: '1',
    restaurantName: '급식',
    price: { taxableSupply: 136_140, vat: 13_614, exempt: 386_692, total: 536_446 },
    isExcluded: false,
    roundDown: true,
    buyer: BUYER,
    itemNames: { taxable: '급식재료', exempt: '급식재료' },
    ...over,
  }
}

describe('계산서 금액 정책 — 공급사 원본 유지', () => {
  it('기존 절사 플래그가 남아 있어도 10원 절사를 하지 않는다', () => {
    const result = collectInvoiceRows([line()])
    const taxable = result.rows.find((row) => row.taxKind === 'taxable')!
    const exempt = result.rows.find((row) => row.taxKind === 'exempt')!

    expect(taxable).toMatchObject({ supply: 136_140, vat: 13_614, roundingDiff: 0 })
    expect(exempt).toMatchObject({ supply: 386_692, vat: 0, roundingDiff: 0 })
    expect(result.roundingTotal).toBe(0)
  })
})

describe('CJ 1016 원단위 예외', () => {
  const approved: InvoiceOverride = {
    id: 'override-1',
    period: '2026-08',
    source: 'cj',
    businessCode: '1016',
    taxKind: 'taxable',
    itemName: '급식재료',
    originalSupply: 136_140,
    originalVat: 13_614,
    finalSupply: 136_139,
    finalVat: 13_615,
    reason: '유치원 회계 요청에 따른 원단위 조정',
    status: 'approved',
  }

  it('승인 요청 사유의 기본값은 유치원 요청이다', () => {
    expect(DEFAULT_INVOICE_OVERRIDE_REASON).toBe('유치원 요청')
  })

  it('일괄 요청도 각 행의 원단위·면세 규칙을 먼저 검증한다', () => {
    expect(validateInvoiceOverrideDraft({
      taxKind: 'taxable',
      itemName: '급식재료',
      originalSupply: 100,
      originalVat: 10,
      finalSupply: 99,
      finalVat: 11,
      reason: DEFAULT_INVOICE_OVERRIDE_REASON,
    })).toBeNull()
    expect(validateInvoiceOverrideDraft({
      taxKind: 'exempt',
      itemName: '급식재료',
      originalSupply: 100,
      originalVat: 0,
      finalSupply: 99,
      finalVat: 1,
      reason: DEFAULT_INVOICE_OVERRIDE_REASON,
    })).toContain('면세')
  })

  it('유치원 요청에 따라 공급가·부가세와 총 청구액을 함께 바꿀 수 있다', () => {
    expect(validateInvoiceOverrideDraft({
      taxKind: 'taxable',
      itemName: '급식재료',
      originalSupply: 100,
      originalVat: 10,
      finalSupply: 105,
      finalVat: 11,
      reason: '유치원 요청',
    })).toBeNull()
  })

  it('승인된 CJ 1016 조정만 계산서 행에 반영한다', () => {
    const rows = collectInvoiceRows([
      line({ businessCode: '1016', businessName: '인천 복자유치원' }),
    ]).rows
    const result = applyInvoiceOverrides(rows, [approved])
    const taxable = result.rows.find((row) => row.taxKind === 'taxable')!

    expect(taxable).toMatchObject({ supply: 136_139, vat: 13_615 })
    expect(result.applied).toEqual(['override-1'])
    expect(result.problems).toEqual([])
  })

  it('다른 사업장 조정은 거부하고 원본을 유지한다', () => {
    const rows = collectInvoiceRows([line()]).rows
    const invalid = { ...approved, id: 'bad', businessCode: '1005' }
    const result = applyInvoiceOverrides(rows, [invalid])

    expect(result.rows.find((row) => row.taxKind === 'taxable')).toMatchObject({
      supply: 136_140,
      vat: 13_614,
    })
    expect(result.problems[0]).toContain('CJ 사업장코드 1016')
  })

  it('저장 당시 원본과 현재 원본이 다르면 조정을 적용하지 않는다', () => {
    const rows = collectInvoiceRows([
      line({ businessCode: '1016', businessName: '인천 복자유치원' }),
    ]).rows
    const stale = { ...approved, originalVat: 13_613 }
    const result = applyInvoiceOverrides(rows, [stale])

    expect(result.rows.find((row) => row.taxKind === 'taxable')).toMatchObject({
      supply: 136_140,
      vat: 13_614,
    })
    expect(result.problems[0]).toContain('원본 금액이 변경')
  })

  it('조정 차액은 파트너 원본을 바꾸지 않고 본사 부담 행으로 분리한다', () => {
    const source = [{
      source: 'cj' as const,
      businessCode: '1016',
      businessName: '키즈웰에듀푸드(복자유치원)',
      restaurantCode: 'restaurant-1',
      restaurantName: '급식재료',
      companyName: '인천 복자유치원',
      partnerId: 'partner-1',
      partnerName: '이동현',
      isExcluded: false,
      exclusionReason: null,
      cost: { taxableSupply: 80, vat: 8, exempt: 0, total: 88 },
      price: { taxableSupply: 100, vat: 10, exempt: 0, total: 110 },
    }]
    const originalRows = collectInvoiceRows([
      line({
        businessCode: '1016',
        businessName: '키즈웰에듀푸드(복자유치원)',
        price: { taxableSupply: 100, vat: 10, exempt: 0, total: 110 },
      }),
    ]).rows
    const finalRows = applyInvoiceOverrides(originalRows, [{
      ...approved,
      originalSupply: 100,
      originalVat: 10,
      finalSupply: 105,
      finalVat: 11,
    }]).rows

    const result = applyInvoiceOverrideDeltaToClosingVenues(
      source,
      originalRows,
      finalRows,
      { businessName: source[0].businessName, companyName: source[0].companyName }
    )

    expect(result[0]).toEqual(source[0])
    expect(result[1]).toMatchObject({
      restaurantCode: 'invoice-override',
      partnerId: null,
      cost: { total: 0 },
      price: { taxableSupply: 5, vat: 1, exempt: 0, total: 6 },
    })

    const partner = {
      partnerId: 'partner-1', partnerName: '이동현', partnerType: 'partner' as const,
      commissionPercent: 5, costTotal: 88, costVat: 8, priceTotal: 110, priceVat: 10,
      margin: 22, platformFee: 0, vatDiff: 2, businessDeduction: 0,
      preTax: 20, declared: 20, incomeTax: 0, localTax: 0, netPay: 20,
    }
    const totals = closingTotals(result, [partner])
    expect(totals).toMatchObject({ revenue: 116, grossMargin: 28, partnerPreTax: 20, hqShare: 8 })
    expect(rollupByKindergarten(result)[0].priceTotal).toBe(116)
  })
})

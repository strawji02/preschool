import { describe, it, expect } from 'vitest'
import { applyInvoiceRounding, type InvoiceRoundingMode } from '@/features/settlement'

/**
 * [정산] 계산서 원단위 절사 (docs §6-2)
 *
 * 일부 유치원은 **계산서 총액을 10원 단위로** 받는다. 원 단위가 남으면 회계
 * 처리에서 걸린다는 요청이다 (26년 7월 — 해밀·나래).
 *
 * ★ 기준 (2026-07-31 확정, **세무사 협의로 바뀔 수 있음**)
 *   ① 절사 대상은 **공급가 + 세액을 합친 총액**
 *   ② **계산서 한 장씩 각각** — 유치원 합계를 절사하지 않는다
 *   ③ 차액은 **부가세(세액)에서** 뺀다. 공급가는 실제 거래금액이라 건드리지 않는다
 *   ④ 정산(영업자 지급)은 **원값 그대로** — 차액은 본사 몫에서 흡수한다
 *
 * ③은 `mode`로 갈아끼울 수 있게 두었다. 세무사가 "공급가에서 빼라"고 하면
 * 설정만 바꾸면 되고 코드는 그대로다.
 */

const VAT: InvoiceRoundingMode = 'vat'
const SUPPLY: InvoiceRoundingMode = 'supply'

describe('applyInvoiceRounding — 절사하지 않는 경우', () => {
  it('플래그가 꺼진 유치원은 원값 그대로다', () => {
    const r = applyInvoiceRounding({ supply: 136_140, vat: 13_614 }, VAT, false)
    expect(r).toEqual({ supply: 136_140, vat: 13_614, total: 149_754, diff: 0 })
  })

  it('이미 10원 단위면 절사해도 그대로다 — 나래 원아급간식 실측', () => {
    // 663,300 + 66,330 = 729,630 → 이미 딱 떨어진다
    const r = applyInvoiceRounding({ supply: 663_300, vat: 66_330 }, VAT, true)
    expect(r).toEqual({ supply: 663_300, vat: 66_330, total: 729_630, diff: 0 })
  })

  it('금액이 0이면 아무 일도 없다', () => {
    const r = applyInvoiceRounding({ supply: 0, vat: 0 }, VAT, true)
    expect(r).toEqual({ supply: 0, vat: 0, total: 0, diff: 0 })
  })
})

describe('applyInvoiceRounding — 과세 (세액에서 차감)', () => {
  it('해밀 급식재료 실측: 149,754 → 149,750, 세액이 4원 줄어든다', () => {
    const r = applyInvoiceRounding({ supply: 136_140, vat: 13_614 }, VAT, true)
    expect(r.total).toBe(149_750)
    expect(r.diff).toBe(4)
    // 공급가는 그대로 — 실제 거래금액이다
    expect(r.supply).toBe(136_140)
    expect(r.vat).toBe(13_610)
  })

  it('해밀 간식보조금 실측: 138,578 → 138,570, 8원', () => {
    const r = applyInvoiceRounding({ supply: 125_980, vat: 12_598 }, VAT, true)
    expect(r).toEqual({ supply: 125_980, vat: 12_590, total: 138_570, diff: 8 })
  })

  it('나래 방과후간식 실측: 287,914 → 287,910', () => {
    const r = applyInvoiceRounding({ supply: 261_740, vat: 26_174 }, VAT, true)
    expect(r).toEqual({ supply: 261_740, vat: 26_170, total: 287_910, diff: 4 })
  })

  it('나래 소모품 실측: 69,784 → 69,780', () => {
    const r = applyInvoiceRounding({ supply: 63_440, vat: 6_344 }, VAT, true)
    expect(r).toEqual({ supply: 63_440, vat: 6_340, total: 69_780, diff: 4 })
  })

  it('절사 후에도 공급가 + 세액 = 총액이 반드시 맞는다', () => {
    for (const supply of [136_140, 125_980, 261_740, 63_440, 1, 7, 99_999]) {
      const r = applyInvoiceRounding({ supply, vat: Math.round(supply * 0.1) }, VAT, true)
      expect(r.supply + r.vat).toBe(r.total)
      expect(r.total % 10).toBe(0)
    }
  })
})

describe('applyInvoiceRounding — 면세 (세액이 없다)', () => {
  it('세액이 0이면 공급가에서 뺄 수밖에 없다 — 해밀 급식재료 면세 실측', () => {
    // 386,692 → 386,690. 세액이 없으니 세액에서 뺄 수 없다.
    const r = applyInvoiceRounding({ supply: 386_692, vat: 0 }, VAT, true)
    expect(r).toEqual({ supply: 386_690, vat: 0, total: 386_690, diff: 2 })
  })

  it('세액이 차액보다 작으면 세액을 0으로 만들고 나머지는 공급가에서 뺀다', () => {
    // 세액 3원 < 차액 8원. 세액을 음수로 만들 수는 없다.
    const r = applyInvoiceRounding({ supply: 105, vat: 3 }, VAT, true)
    expect(r.total).toBe(100)
    expect(r.diff).toBe(8)
    expect(r.vat).toBe(0)
    expect(r.supply).toBe(100)
    expect(r.supply + r.vat).toBe(r.total)
  })
})

describe('applyInvoiceRounding — supply 모드 (세무사 협의 시 대비)', () => {
  it('공급가에서 빼면 세액이 그대로 남는다 — 해밀 급식재료', () => {
    const r = applyInvoiceRounding({ supply: 136_140, vat: 13_614 }, SUPPLY, true)
    expect(r).toEqual({ supply: 136_136, vat: 13_614, total: 149_750, diff: 4 })
  })

  it('어느 모드든 총액과 차액은 같다 — 어디서 빼느냐만 다르다', () => {
    const input = { supply: 125_980, vat: 12_598 }
    const a = applyInvoiceRounding(input, VAT, true)
    const b = applyInvoiceRounding(input, SUPPLY, true)
    expect(a.total).toBe(b.total)
    expect(a.diff).toBe(b.diff)
    expect(a.supply).not.toBe(b.supply)
  })
})

describe('applyInvoiceRounding — 실제 26년 6월 절사 총액', () => {
  it('해밀·나래에서 6장이 깎이고 총 23원이 줄어든다', () => {
    // 실파일 실측 (`정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx`).
    // 계산서 88장 중 절사 대상 유치원이 10장, 그중 6장이 실제로 깎인다.
    // 이 금액이 본사 몫에서 빠진다.
    const rows = [
      { supply: 136_140, vat: 13_614, expect: 4 }, // 해밀 급식재료 과세
      { supply: 386_692, vat: 0, expect: 2 }, // 해밀 급식재료 면세
      { supply: 125_980, vat: 12_598, expect: 8 }, // 해밀 간식보조금 과세
      { supply: 2_678_031, vat: 0, expect: 1 }, // 나래 급식재료 면세
      { supply: 261_740, vat: 26_174, expect: 4 }, // 나래 방과후간식 과세
      { supply: 63_440, vat: 6_344, expect: 4 }, // 나래 소모품 과세
      { supply: 663_300, vat: 66_330, expect: 0 }, // 나래 원아급간식 — 이미 딱 떨어진다
    ]
    let total = 0
    for (const row of rows) {
      const r = applyInvoiceRounding(row, VAT, true)
      expect(r.diff).toBe(row.expect)
      total += r.diff
    }
    expect(total).toBe(23)
  })
})

// ─────────────────────────────────────────────────────────────
// 계산서 묶기와의 상호작용 — 여기가 진짜 함정이다
// ─────────────────────────────────────────────────────────────
import { collectInvoiceRows, type InvoiceParty, type InvoiceVenueLine } from '@/features/settlement'

const HAEMIL: InvoiceParty = {
  bizRegNo: '2108012671',
  companyName: '해밀유치원',
  ceoName: '김해밀',
  address: '서울시',
  bizType: '유치원',
  bizItem: '유치원',
  email: 'a@b.com',
  email2: null,
}

function line(over: Partial<InvoiceVenueLine> = {}): InvoiceVenueLine {
  return {
    source: 'cj',
    businessCode: '1005',
    businessName: '키즈웰에듀푸드(해밀유치원)',
    restaurantCode: '1000',
    restaurantName: '급식',
    price: { taxableSupply: 0, vat: 0, exempt: 0, total: 0 },
    isExcluded: false,
    roundDown: true,
    buyer: HAEMIL,
    itemNames: { taxable: '급식재료', exempt: '급식재료' },
    ...over,
  }
}

describe('collectInvoiceRows — 절사는 계산서 한 장 단위다', () => {
  it('식당 2개가 한 장으로 합쳐지면 합친 뒤 한 번만 깎는다', () => {
    // 식당별로 깎으면 4 + 4 = 8원이 빠진다. 합치면 총액 200,008 → 200,000, 8원.
    // 이 사례는 우연히 같지만, 아래 테스트가 차이를 드러낸다.
    const r = collectInvoiceRows([
      line({
        restaurantCode: '1000',
        price: { taxableSupply: 100_004, vat: 0, exempt: 0, total: 100_004 },
      }),
      line({
        restaurantCode: '1001',
        price: { taxableSupply: 100_004, vat: 0, exempt: 0, total: 100_004 },
      }),
    ])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].mergedFrom).toBe(2)
    expect(r.rows[0].supply).toBe(200_000)
    expect(r.rows[0].roundingDiff).toBe(8)
    expect(r.roundingTotal).toBe(8)
  })

  it('식당별로 깎았다면 더 많이 빠졌을 경우 — 합계 기준이 맞다', () => {
    // 식당별: 100,009 → 100,000 (9원), 100,009 → 100,000 (9원) = 18원
    // 계산서 기준: 200,018 → 200,010 = 8원. **8원이 정답이다.**
    const r = collectInvoiceRows([
      line({
        restaurantCode: '1000',
        price: { taxableSupply: 100_009, vat: 0, exempt: 0, total: 100_009 },
      }),
      line({
        restaurantCode: '1001',
        price: { taxableSupply: 100_009, vat: 0, exempt: 0, total: 100_009 },
      }),
    ])
    expect(r.rows[0].supply).toBe(200_010)
    expect(r.roundingTotal).toBe(8)
  })

  it('절사 대상이 아닌 유치원은 원값 그대로다', () => {
    const r = collectInvoiceRows([
      line({
        roundDown: false,
        price: { taxableSupply: 136_140, vat: 13_614, exempt: 0, total: 149_754 },
      }),
    ])
    expect(r.rows[0].supply).toBe(136_140)
    expect(r.rows[0].vat).toBe(13_614)
    expect(r.rows[0].roundingDiff).toBe(0)
    expect(r.roundingTotal).toBe(0)
  })

  it('과세·면세는 각각 다른 계산서라 따로 절사한다', () => {
    const r = collectInvoiceRows([
      line({
        price: { taxableSupply: 136_140, vat: 13_614, exempt: 386_692, total: 536_446 },
      }),
    ])
    const taxable = r.rows.find((x) => x.taxKind === 'taxable')!
    const exempt = r.rows.find((x) => x.taxKind === 'exempt')!
    expect(taxable.supply + taxable.vat).toBe(149_750)
    expect(exempt.supply).toBe(386_690)
    expect(r.roundingTotal).toBe(4 + 2)
  })

  it('설정을 supply로 바꾸면 공급가에서 뺀다 — 코드 변경 없이', () => {
    const r = collectInvoiceRows(
      [line({ price: { taxableSupply: 136_140, vat: 13_614, exempt: 0, total: 149_754 } })],
      'supply'
    )
    expect(r.rows[0].supply).toBe(136_136)
    expect(r.rows[0].vat).toBe(13_614)
  })
})

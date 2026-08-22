import { describe, it, expect } from 'vitest'
import {
  INVOICE_COL,
  buildInvoiceSheets,
  collectInvoiceRows,
  monthEndIssueDate,
  type InvoiceParty,
  type InvoiceVenueLine,
} from '@/features/settlement'

/**
 * [정산] 홈택스 일괄발행 엑셀 (docs §6-1)
 *
 * 과세 → 세금계산서(종류 01), 면세 → 계산서(종류 05)로 **파일 2개**를 만든다.
 *
 * 발행 단위는 식당이 아니라 **(유치원 사업자번호 × 품목 × 과세구분)** 이다.
 * 26년 6월 실측: 해밀유치원 과세에서 식당 2개가 한 장으로 합쳐졌다
 * (39,490 + 96,650 = 급식재료 136,140, 세액도 3,949 + 9,665 = 13,614).
 *
 * ⚠️ 행 순서는 검증하지 않는다. 원본 순서는 `집계표_정산용`의 수작업 배열을 따르고
 * 재현할 근거가 없다. 홈택스는 **1행 = 독립 계산서**라 순서가 의미를 갖지 않는다.
 */

const ISSUER: InvoiceParty = {
  bizRegNo: '8310503575',
  companyName: '키즈웰에듀푸드',
  ceoName: '김중영',
  address: '서울특별시 송파구 충민로66, 8층F8101호',
  bizType: '도매 및 소매업',
  bizItem: '교재',
  email: 'kidswellfood@naver.com',
}

/** 26년 6월 해밀유치원 실값 */
const HAEMIL: InvoiceParty = {
  bizRegNo: '1248011407',
  companyName: '해밀유치원',
  ceoName: '박노정',
  address: '경기도 수원시 영통구 동탄원천로1109번길 42(매탄동, 성일아파트)',
  bizType: '유치원',
  bizItem: '유치원',
  email: 'hanul-1994@hanmail.net',
  email2: null,
}

const NARAE: InvoiceParty = {
  bizRegNo: '2108012672',
  companyName: '나래유치원',
  ceoName: '김춘태',
  address: '경기도 안양시 동안구 흥안대로 439(호계동)',
  bizType: '유치원',
  bizItem: '유치원',
  email: 'ksj-429@hanmail.net',
  email2: null,
}

function line(over: Partial<InvoiceVenueLine> = {}): InvoiceVenueLine {
  return {
    source: 'cj',
    businessCode: '1005',
    businessName: '키즈웰에듀푸드(해밀유치원)',
    restaurantCode: '1000',
    restaurantName: '키즈웰에듀푸드(해밀유치원)',
    price: { taxableSupply: 0, vat: 0, exempt: 0, total: 0 },
    isExcluded: false,
    roundDown: false,
    buyer: HAEMIL,
    itemNames: { taxable: '급식재료', exempt: '급식재료' },
    ...over,
  }
}

describe('monthEndIssueDate', () => {
  it('작성일자는 월말일 8자리다', () => {
    expect(monthEndIssueDate(2026, 6).issueDate).toBe('20260630')
    expect(monthEndIssueDate(2026, 7).issueDate).toBe('20260731')
    expect(monthEndIssueDate(2026, 2).issueDate).toBe('20260228')
  })

  it('일자1은 2자리 (작성년월 제외)', () => {
    expect(monthEndIssueDate(2026, 6).day).toBe('30')
    expect(monthEndIssueDate(2026, 2).day).toBe('28')
  })

  it('윤년 2월은 29일이다', () => {
    expect(monthEndIssueDate(2028, 2).issueDate).toBe('20280229')
    expect(monthEndIssueDate(2028, 2).day).toBe('29')
  })
})

describe('collectInvoiceRows — 발행 단위 (유치원 × 품목 × 과세구분)', () => {
  it('과세 금액이 있으면 과세 행을 만든다', () => {
    const { rows } = collectInvoiceRows([
      line({ price: { taxableSupply: 136_140, vat: 13_614, exempt: 0, total: 149_754 } }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      taxKind: 'taxable',
      itemName: '급식재료',
      supply: 136_140,
      vat: 13_614,
    })
  })

  it('면세 금액이 있으면 면세 행을 만든다 (세액은 항상 0)', () => {
    const { rows } = collectInvoiceRows([
      line({ price: { taxableSupply: 0, vat: 0, exempt: 386_692, total: 386_692 } }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ taxKind: 'exempt', supply: 386_692, vat: 0 })
  })

  it('과세·면세가 둘 다 있으면 행이 2개 나온다', () => {
    const { rows } = collectInvoiceRows([
      line({ price: { taxableSupply: 96_650, vat: 9_665, exempt: 386_692, total: 493_007 } }),
    ])
    expect(rows.map((r) => r.taxKind).sort()).toEqual(['exempt', 'taxable'])
  })

  it('금액이 0인 과세구분은 행을 만들지 않는다', () => {
    const { rows } = collectInvoiceRows([
      line({ price: { taxableSupply: 0, vat: 0, exempt: 0, total: 0 } }),
    ])
    expect(rows).toEqual([])
  })

  it('같은 유치원·같은 품목이면 한 장으로 합산한다 (해밀 실사례)', () => {
    const { rows } = collectInvoiceRows([
      line({
        restaurantCode: '1000',
        restaurantName: '키즈웰에듀푸드(해밀유치원)',
        price: { taxableSupply: 39_490, vat: 3_949, exempt: 0, total: 43_439 },
      }),
      line({
        restaurantCode: '1001',
        restaurantName: '키즈웰에듀푸드(해밀유치원_급식재료)',
        price: { taxableSupply: 96_650, vat: 9_665, exempt: 0, total: 106_315 },
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      itemName: '급식재료',
      supply: 136_140,
      vat: 13_614,
      mergedFrom: 2,
    })
  })

  it('품목이 다르면 합치지 않는다', () => {
    const { rows } = collectInvoiceRows([
      line({
        restaurantCode: '1001',
        price: { taxableSupply: 96_650, vat: 9_665, exempt: 0, total: 106_315 },
        itemNames: { taxable: '급식재료', exempt: null },
      }),
      line({
        restaurantCode: '1002',
        price: { taxableSupply: 125_980, vat: 12_598, exempt: 0, total: 138_578 },
        itemNames: { taxable: '간식보조금', exempt: null },
      }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.itemName).sort()).toEqual(['간식보조금', '급식재료'])
  })

  it('유치원이 다르면 합치지 않는다 (상호가 같아도 사업자번호로 구분)', () => {
    // 26년 6월에 `복자유치원`이라는 상호가 3곳 있다 — 상호는 키가 아니다.
    const bokjaA: InvoiceParty = { ...HAEMIL, bizRegNo: '1318208466', companyName: '복자유치원' }
    const bokjaB: InvoiceParty = { ...HAEMIL, bizRegNo: '5798200308', companyName: '복자유치원' }
    const { rows } = collectInvoiceRows([
      line({ businessCode: '1016', buyer: bokjaA, price: { taxableSupply: 100, vat: 10, exempt: 0, total: 110 } }),
      line({ businessCode: '1007', buyer: bokjaB, price: { taxableSupply: 200, vat: 20, exempt: 0, total: 220 } }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('같은 식당이라도 과세·면세 품목명이 다르면 각자 이름으로 나간다 (나래 실사례)', () => {
    const { rows } = collectInvoiceRows([
      line({
        source: 'shinsegae',
        businessCode: '89912',
        restaurantCode: '01',
        restaurantName: '원아급간식',
        buyer: NARAE,
        price: { taxableSupply: 663_300, vat: 66_330, exempt: 2_678_031, total: 3_407_661 },
        itemNames: { taxable: '원아급간식', exempt: '급식재료' },
      }),
    ])
    expect(rows.find((r) => r.taxKind === 'taxable')!.itemName).toBe('원아급간식')
    expect(rows.find((r) => r.taxKind === 'exempt')!.itemName).toBe('급식재료')
  })

  it('외부 사입 별도 발행 키가 있으면 같은 유치원·품목명이어도 합치지 않는다', () => {
    const price = { taxableSupply: 100, vat: 10, exempt: 0, total: 110 }
    const { rows } = collectInvoiceRows([
      line({ price, groupKey: 'manual:1' }),
      line({ price, groupKey: 'manual:2' }),
    ])
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.mergedFrom === 1)).toBe(true)
  })
})

describe('collectInvoiceRows — 발행하지 않는 경우', () => {
  it('정산 제외 사업장은 계산서를 만들지 않는다 (본사 = 마케팅비)', () => {
    const { rows, problems } = collectInvoiceRows([
      line({
        source: 'shinsegae',
        businessCode: '88689',
        restaurantName: '본사',
        isExcluded: true,
        buyer: null,
        itemNames: { taxable: null, exempt: null },
        price: { taxableSupply: 11_750, vat: 1_175, exempt: 0, total: 12_925 },
      }),
    ])
    expect(rows).toEqual([])
    // 의도적 제외는 문제가 아니다 — 경고를 내면 매달 무시하게 된다
    expect(problems).toEqual([])
  })

  it('사업자 정보가 없으면 행을 만들지 않고 알려준다', () => {
    const { rows, problems } = collectInvoiceRows([
      line({ buyer: null, price: { taxableSupply: 100, vat: 10, exempt: 0, total: 110 } }),
    ])
    expect(rows).toEqual([])
    expect(problems.join(' ')).toContain('사업자 정보')
    expect(problems.join(' ')).toContain('1005')
  })

  it('품목명이 없으면 그 과세구분만 빼고 알려준다', () => {
    const { rows, problems } = collectInvoiceRows([
      line({
        price: { taxableSupply: 100, vat: 10, exempt: 200, total: 310 },
        itemNames: { taxable: null, exempt: '급식재료' },
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.taxKind).toBe('exempt')
    expect(problems.join(' ')).toContain('품목명')
    expect(problems.join(' ')).toContain('과세')
  })

  it('금액이 0이면 품목명이 없어도 문제로 보지 않는다', () => {
    // 그 달에 거래가 없었을 뿐이다. 경고를 내면 소음이 된다.
    const { problems } = collectInvoiceRows([
      line({
        price: { taxableSupply: 0, vat: 0, exempt: 200, total: 200 },
        itemNames: { taxable: null, exempt: '급식재료' },
      }),
    ])
    expect(problems).toEqual([])
  })
})

describe('buildInvoiceSheets — 홈택스 양식', () => {
  const { issueDate, day } = monthEndIssueDate(2026, 6)
  const { rows } = collectInvoiceRows([
    line({ price: { taxableSupply: 136_140, vat: 13_614, exempt: 386_692, total: 536_446 } }),
  ])
  const sheets = buildInvoiceSheets({ issueDate, day, issuer: ISSUER, rows })

  it('과세는 59열, 면세는 54열이다', () => {
    expect(sheets.taxable.rows[6]).toHaveLength(59)
    expect(sheets.exempt.rows[6]).toHaveLength(54)
  })

  it('1~5행은 비우고 6행이 헤더, 7행부터 데이터다', () => {
    for (const kind of ['taxable', 'exempt'] as const) {
      const r = sheets[kind].rows
      for (let i = 0; i < 5; i++) {
        expect(r[i]!.some((v) => v !== null && v !== ''), `${kind} ${i + 1}행`).toBe(false)
      }
      expect(r[5]![1]).toBe('작성일자')
      expect(r[6]![INVOICE_COL.taxable.kind]).not.toBeNull()
    }
  })

  it('종류는 과세 01 / 면세 05다', () => {
    expect(sheets.taxable.rows[6]![INVOICE_COL.taxable.kind]).toBe('01')
    expect(sheets.exempt.rows[6]![INVOICE_COL.exempt.kind]).toBe('05')
  })

  it('영수/청구는 청구(02)다 — 열 위치가 양식마다 다르다', () => {
    expect(sheets.taxable.rows[6]![INVOICE_COL.taxable.receiptType]).toBe('02')
    expect(sheets.exempt.rows[6]![INVOICE_COL.exempt.receiptType]).toBe('02')
    expect(INVOICE_COL.taxable.receiptType).toBe(58) // BG
    expect(INVOICE_COL.exempt.receiptType).toBe(53) // BB
  })

  it('과세는 세액합계(U) 때문에 이후 열이 1칸 밀린다', () => {
    expect(INVOICE_COL.taxable.supplyTotal).toBe(19)
    expect(INVOICE_COL.taxable.vatTotal).toBe(20)
    expect(INVOICE_COL.taxable.itemName).toBe(23)
    // 면세는 세액 열이 없다
    expect(INVOICE_COL.exempt.supplyTotal).toBe(19)
    expect(INVOICE_COL.exempt.itemName).toBe(22)
  })

  it('공급자 정보를 채운다', () => {
    const r = sheets.taxable.rows[6]!
    const C = INVOICE_COL.taxable
    expect(r[C.issuerBizRegNo]).toBe('8310503575')
    expect(r[C.issuerCompanyName]).toBe('키즈웰에듀푸드')
    expect(r[C.issuerCeoName]).toBe('김중영')
    expect(r[C.issuerEmail]).toBe('kidswellfood@naver.com')
  })

  it('공급받는자는 계산서 상호를 쓴다 (원천 사업장명이 아니다)', () => {
    const r = sheets.taxable.rows[6]!
    const C = INVOICE_COL.taxable
    expect(r[C.buyerBizRegNo]).toBe('1248011407')
    expect(r[C.buyerCompanyName]).toBe('해밀유치원')
    expect(r[C.buyerEmail1]).toBe('hanul-1994@hanmail.net')
    expect(r[C.buyerEmail2]).toBeNull()
  })

  it('금액은 합계와 품목1에 같이 들어간다', () => {
    const C = INVOICE_COL.taxable
    const r = sheets.taxable.rows[6]!
    expect(r[C.supplyTotal]).toBe(136_140)
    expect(r[C.vatTotal]).toBe(13_614)
    expect(r[C.itemSupply]).toBe(136_140)
    expect(r[C.itemVat]).toBe(13_614)
  })

  it('작성일자는 8자리 문자열, 일자1은 2자리다', () => {
    const C = INVOICE_COL.taxable
    const r = sheets.taxable.rows[6]!
    expect(r[C.issueDate]).toBe('20260630')
    expect(r[C.itemDay]).toBe('30')
  })

  it('규격·수량·단가는 비운다 (원본도 비어 있다)', () => {
    const C = INVOICE_COL.taxable
    const r = sheets.taxable.rows[6]!
    expect(r[C.itemSpec]).toBeNull()
    expect(r[C.itemQuantity]).toBeNull()
    expect(r[C.itemUnitPrice]).toBeNull()
  })

  it('품목2~4 슬롯과 결제 정보는 비운다', () => {
    const C = INVOICE_COL.taxable
    const r = sheets.taxable.rows[6]!
    expect(r[30]).toBeNull() // 일자2
    expect(r[C.cash]).toBeNull()
    expect(r[C.note]).toBeNull()
  })

  it('합계와 장수를 함께 돌려준다', () => {
    expect(sheets.taxable.count).toBe(1)
    expect(sheets.taxable.supplyTotal).toBe(136_140)
    expect(sheets.taxable.vatTotal).toBe(13_614)
    expect(sheets.exempt.count).toBe(1)
    expect(sheets.exempt.supplyTotal).toBe(386_692)
    expect(sheets.exempt.vatTotal).toBe(0)
  })

  it('해당 과세구분에 행이 없으면 헤더만 남는다', () => {
    const only = collectInvoiceRows([
      line({ price: { taxableSupply: 100, vat: 10, exempt: 0, total: 110 } }),
    ])
    const s = buildInvoiceSheets({ issueDate, day, issuer: ISSUER, rows: only.rows })
    expect(s.exempt.count).toBe(0)
    expect(s.exempt.rows).toHaveLength(6) // 빈 5행 + 헤더
  })
})

describe('26년 6월 실합계 (docs §6-1 역검증 픽스처)', () => {
  it('과세·면세 합계가 실제 홈택스 파일과 같아야 한다', () => {
    // 실파일 대조는 scripts/generate-invoice-files.ts가 한다.
    // 여기서는 합계 상수를 테스트로 고정해 회귀를 막는다.
    const EXPECTED = {
      taxableSupply: 33_182_420,
      taxableVat: 3_318_242,
      exempt: 65_846_245,
      taxableCount: 47,
      exemptCount: 41,
    }
    expect(EXPECTED.taxableSupply + EXPECTED.taxableVat + EXPECTED.exempt).toBe(102_346_907)
    // 단가합계 102,359,832 − 본사 12,925 = 102,346,907
    expect(102_359_832 - 12_925).toBe(102_346_907)
  })
})

/**
 * 미해결 항목 구조화 (docs §14-3)
 *
 * 화면에서 **그 자리에서 고칠 수 있어야** 하므로 문자열 경고만으로는 부족하다.
 * 어느 사업장·어느 식당·어느 과세구분인지 기계가 읽을 수 있게 돌려준다.
 */
describe('collectInvoiceRows — pending (인라인 해결용)', () => {
  it('사업자 정보 미비는 사업장 단위로 한 번만 알려준다', () => {
    // 같은 사업장의 식당이 3개여도 고칠 대상은 사업장 1개다
    const { pending } = collectInvoiceRows([
      line({ restaurantCode: '1000', buyer: null, price: { taxableSupply: 100, vat: 10, exempt: 0, total: 110 } }),
      line({ restaurantCode: '1001', buyer: null, price: { taxableSupply: 200, vat: 20, exempt: 0, total: 220 } }),
      line({ restaurantCode: '1002', buyer: null, price: { taxableSupply: 300, vat: 30, exempt: 0, total: 330 } }),
    ])
    expect(pending.buyers).toHaveLength(1)
    expect(pending.buyers[0]).toMatchObject({
      source: 'cj',
      businessCode: '1005',
      restaurantCount: 3,
    })
  })

  it('사업자 정보 미비 사업장의 청구액 합계를 알려준다 (영향 규모)', () => {
    const { pending } = collectInvoiceRows([
      line({ restaurantCode: '1000', buyer: null, price: { taxableSupply: 100, vat: 10, exempt: 50, total: 160 } }),
      line({ restaurantCode: '1001', buyer: null, price: { taxableSupply: 200, vat: 20, exempt: 0, total: 220 } }),
    ])
    expect(pending.buyers[0]!.priceTotal).toBe(380)
  })

  it('품목명 미지정은 식당 × 과세구분 단위로 알려준다', () => {
    const { pending } = collectInvoiceRows([
      line({
        restaurantCode: '1000',
        restaurantName: '키즈웰에듀푸드(해밀유치원)',
        price: { taxableSupply: 100, vat: 10, exempt: 200, total: 310 },
        itemNames: { taxable: null, exempt: null },
      }),
    ])
    expect(pending.itemNames).toHaveLength(2)
    expect(pending.itemNames.map((p) => p.taxKind).sort()).toEqual(['exempt', 'taxable'])
    expect(pending.itemNames.find((p) => p.taxKind === 'taxable')).toMatchObject({
      source: 'cj',
      businessCode: '1005',
      restaurantCode: '1000',
      restaurantName: '키즈웰에듀푸드(해밀유치원)',
      amount: 100,
    })
  })

  it('한쪽만 미지정이면 그 한쪽만 나온다', () => {
    const { pending } = collectInvoiceRows([
      line({
        price: { taxableSupply: 100, vat: 10, exempt: 200, total: 310 },
        itemNames: { taxable: null, exempt: '급식재료' },
      }),
    ])
    expect(pending.itemNames).toHaveLength(1)
    expect(pending.itemNames[0]!.taxKind).toBe('taxable')
  })

  it('금액이 0이면 pending에 넣지 않는다 (거래가 없던 달이다)', () => {
    const { pending } = collectInvoiceRows([
      line({
        price: { taxableSupply: 0, vat: 0, exempt: 200, total: 200 },
        itemNames: { taxable: null, exempt: '급식재료' },
      }),
    ])
    expect(pending.itemNames).toEqual([])
  })

  it('정산 제외 사업장은 pending에 넣지 않는다', () => {
    const { pending } = collectInvoiceRows([
      line({
        isExcluded: true,
        buyer: null,
        itemNames: { taxable: null, exempt: null },
        price: { taxableSupply: 11_750, vat: 1_175, exempt: 0, total: 12_925 },
      }),
    ])
    expect(pending.buyers).toEqual([])
    expect(pending.itemNames).toEqual([])
  })

  it('사업자 정보가 없으면 품목명은 따로 묻지 않는다 — 한 번에 하나씩 고치게 한다', () => {
    // 사업자 정보부터 채워야 계산서가 나오므로, 품목명까지 같이 띄우면 소음이다
    const { pending } = collectInvoiceRows([
      line({
        buyer: null,
        itemNames: { taxable: null, exempt: null },
        price: { taxableSupply: 100, vat: 10, exempt: 0, total: 110 },
      }),
    ])
    expect(pending.buyers).toHaveLength(1)
    expect(pending.itemNames).toEqual([])
  })

  it('모두 정상이면 pending이 비어 있다', () => {
    const { pending, problems } = collectInvoiceRows([
      line({ price: { taxableSupply: 100, vat: 10, exempt: 200, total: 310 } }),
    ])
    expect(pending.buyers).toEqual([])
    expect(pending.itemNames).toEqual([])
    expect(problems).toEqual([])
  })
})

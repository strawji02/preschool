import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * [정산] 마스터 데이터 로더 — migration 050
 *
 * 핵심은 **세 상태를 구분**하는 것이다:
 *   is_excluded=true            → 매핑값 null   (의도적 정산 제외)
 *   partner_id 있음             → 매핑값 id     (배정됨)
 *   partner_id 없고 제외도 아님  → 매핑에 없음   (미배정 → 집계에서 누락으로 잡힘)
 *
 * 미배정을 null로 넣으면 의도적 제외와 구분이 사라져 마감 검증이 무력화된다.
 */

const tables: Record<string, { data: unknown[] | null; error: unknown }> = {}

/**
 * `settlement_issuer`는 `.eq().maybeSingle()`로 읽으므로 목도 체인을 지원해야 한다.
 * `select()` 결과를 그대로 await할 수도 있어야 해서 thenable로 만든다.
 */
const mockFrom = vi.fn((table: string) => {
  const result = () => tables[table] ?? { data: [], error: null }
  type Chain = {
    eq: () => Chain
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>
    then: <T>(
      onFulfilled: (value: { data: unknown[] | null; error: unknown }) => T
    ) => Promise<T>
  }
  const chain: Chain = {
    eq: () => chain,
    maybeSingle: () => {
      const r = result()
      return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error })
    },
    then: (onFulfilled) => Promise.resolve(result()).then(onFulfilled),
  }
  return { select: () => chain }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

const { loadSettlementMaster, missingInvoiceFields, venueItemKey } = await import(
  '@/features/settlement/data/master'
)

/** 계산서 발행에 필요한 항목이 다 채워진 사업장 (26년 6월 해밀유치원 실값) */
const FULL_INVOICE = {
  biz_reg_no: '1248011407',
  company_name: '해밀유치원',
  ceo_name: '박노정',
  address: '경기도 수원시 영통구 동탄원천로1109번길 42(매탄동, 성일아파트)',
  biz_type: '유치원',
  biz_item: '유치원',
  email: 'hanul-1994@hanmail.net',
  email2: null,
}

const PARTNERS = [
  {
    id: 'p-kim',
    name: '김중영',
    partner_type: 'cofounder',
    taxpayer_type: 'individual',
    commission_percent: '5.00', // numeric은 문자열로 올 수 있다
    is_active: true,
  },
  {
    id: 'p-lee',
    name: '김영수',
    partner_type: 'partner',
    taxpayer_type: 'business',
    commission_percent: 3,
    is_active: true,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  tables['settlement_partners'] = { data: PARTNERS, error: null }
  tables['settlement_venues'] = { data: [], error: null }
  tables['settlement_venue_items'] = { data: [], error: null }
  tables['settlement_issuer'] = { data: [], error: null }
})

describe('loadSettlementMaster — 영업자', () => {
  it('id로 조회할 수 있는 Map을 만든다', async () => {
    const m = await loadSettlementMaster()
    expect(m.partners.get('p-kim')).toEqual({
      id: 'p-kim',
      name: '김중영',
      partnerType: 'cofounder',
      taxpayerType: 'individual',
      commissionPercent: 5,
      isActive: true,
    })
  })

  it('numeric 수수료율이 문자열로 와도 숫자로 변환한다', async () => {
    const m = await loadSettlementMaster()
    expect(m.partners.get('p-kim')!.commissionPercent).toBe(5)
    expect(typeof m.partners.get('p-kim')!.commissionPercent).toBe('number')
    expect(m.partners.get('p-lee')!.commissionPercent).toBe(3)
  })
})

describe('loadSettlementMaster — 매핑 3상태 구분', () => {
  it('배정된 사업장은 영업자 id로 매핑한다', async () => {
    tables['settlement_venues'] = {
      data: [
        { source: 'cj', business_code: '1008', business_name: '선경', partner_id: 'p-kim', is_excluded: false },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.mapping['cj:1008']).toBe('p-kim')
  })

  it('제외 사업장은 null로 매핑한다 (의도적 제외)', async () => {
    tables['settlement_venues'] = {
      data: [
        { source: 'shinsegae', business_code: '88689', business_name: '본사', partner_id: null, is_excluded: true },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.mapping['shinsegae:88689']).toBeNull()
    expect('shinsegae:88689' in m.mapping).toBe(true)
  })

  it('미배정 사업장은 매핑에 넣지 않는다 — 제외와 섞이면 안 된다', async () => {
    tables['settlement_venues'] = {
      data: [
        { source: 'cj', business_code: '9999', business_name: '신규', partner_id: null, is_excluded: false },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect('cj:9999' in m.mapping).toBe(false)
    expect(m.mapping['cj:9999']).toBeUndefined()
  })

  it('세 상태가 섞여 있어도 각각 올바르게 분류한다', async () => {
    tables['settlement_venues'] = {
      data: [
        { source: 'cj', business_code: '1008', business_name: '선경', partner_id: 'p-kim', is_excluded: false },
        { source: 'shinsegae', business_code: '88689', business_name: '본사', partner_id: null, is_excluded: true },
        { source: 'cj', business_code: '9999', business_name: '신규', partner_id: null, is_excluded: false },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.mapping).toEqual({
      'cj:1008': 'p-kim',
      'shinsegae:88689': null,
    })
    expect(m.venues).toHaveLength(3) // venues에는 미배정도 그대로 남는다
  })

  it('사업장코드가 숫자로 와도 문자열로 통일한다 (엑셀이 1008을 숫자로 준다)', async () => {
    tables['settlement_venues'] = {
      data: [
        { source: 'cj', business_code: 1008, business_name: '선경', partner_id: 'p-kim', is_excluded: false },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.mapping['cj:1008']).toBe('p-kim')
    expect(m.venues[0].businessCode).toBe('1008')
  })
})

describe('loadSettlementMaster — 오류 처리', () => {
  it('영업자 조회 실패는 조용히 넘기지 않고 throw한다', async () => {
    tables['settlement_partners'] = { data: null, error: { message: 'permission denied' } }
    await expect(loadSettlementMaster()).rejects.toThrow('영업자 마스터 조회 실패')
  })

  it('사업장 조회 실패도 throw한다 (빈 매핑으로 진행하면 전원 누락 처리됨)', async () => {
    tables['settlement_venues'] = { data: null, error: { message: 'timeout' } }
    await expect(loadSettlementMaster()).rejects.toThrow('사업장 마스터 조회 실패')
  })
})

/**
 * 계산서 발행 마스터 (migration 051/052, docs §6-1)
 *
 * 매핑 3상태와 같은 이유로 여기도 **미지정과 제외를 구분**해야 한다:
 * 본사(정산제외)에 사업자 정보를 요구하면 영원히 마감할 수 없다.
 */
describe('loadSettlementMaster — 계산서 발행 정보', () => {
  it('계산서 정보를 invoice에 담아 읽는다', async () => {
    tables['settlement_venues'] = {
      data: [
        {
          source: 'cj',
          business_code: '1005',
          business_name: '키즈웰에듀푸드(해밀유치원)',
          partner_id: 'p-kim',
          is_excluded: false,
          exclusion_reason: null,
          ...FULL_INVOICE,
        },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.venues[0]!.invoice).toEqual({
      bizRegNo: '1248011407',
      companyName: '해밀유치원',
      ceoName: '박노정',
      address: '경기도 수원시 영통구 동탄원천로1109번길 42(매탄동, 성일아파트)',
      bizType: '유치원',
      bizItem: '유치원',
      email: 'hanul-1994@hanmail.net',
      email2: null,
    })
  })

  it('계산서 상호는 원천 사업장명과 다르다', async () => {
    tables['settlement_venues'] = {
      data: [
        {
          source: 'cj',
          business_code: '1005',
          business_name: '키즈웰에듀푸드(해밀유치원)',
          partner_id: 'p-kim',
          is_excluded: false,
          exclusion_reason: null,
          ...FULL_INVOICE,
        },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.venues[0]!.businessName).toBe('키즈웰에듀푸드(해밀유치원)')
    expect(m.venues[0]!.invoice.companyName).toBe('해밀유치원')
  })

  it('제외 사유를 읽는다', async () => {
    tables['settlement_venues'] = {
      data: [
        {
          source: 'shinsegae',
          business_code: '88689',
          business_name: '키즈웰에듀푸드(본사)',
          partner_id: null,
          is_excluded: true,
          exclusion_reason: '마케팅비 — 본사 자체 소비분',
          biz_reg_no: null,
          company_name: null,
          ceo_name: null,
          address: null,
          biz_type: null,
          biz_item: null,
          email: null,
          email2: null,
        },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.venues[0]!.exclusionReason).toBe('마케팅비 — 본사 자체 소비분')
  })
})

describe('missingInvoiceFields', () => {
  const venue = (over: Record<string, unknown>) =>
    ({
      source: 'cj',
      businessCode: '1005',
      businessName: 'x',
      partnerId: 'p-kim',
      isExcluded: false,
      exclusionReason: null,
      invoice: {
        bizRegNo: '1248011407',
        companyName: '해밀유치원',
        ceoName: '박노정',
        address: '주소',
        bizType: '유치원',
        bizItem: '유치원',
        email: 'a@b.com',
        email2: null,
      },
      ...over,
    }) as Parameters<typeof missingInvoiceFields>[0]

  it('다 채워져 있으면 빈 배열이다', () => {
    expect(missingInvoiceFields(venue({}))).toEqual([])
  })

  it('이메일2는 없어도 된다', () => {
    const v = venue({})
    v.invoice.email2 = null
    expect(missingInvoiceFields(v)).toEqual([])
  })

  it('빠진 항목을 한국어 이름으로 알려준다', () => {
    const v = venue({})
    v.invoice.bizRegNo = null
    v.invoice.address = ''
    expect(missingInvoiceFields(v)).toEqual(['사업자등록번호', '사업장주소'])
  })

  it('정산 제외 사업장은 검사하지 않는다 — 요구하면 영원히 마감 못 한다', () => {
    const v = venue({ isExcluded: true, partnerId: null })
    v.invoice.bizRegNo = null
    v.invoice.companyName = null
    v.invoice.ceoName = null
    v.invoice.address = null
    v.invoice.bizType = null
    v.invoice.bizItem = null
    v.invoice.email = null
    expect(missingInvoiceFields(v)).toEqual([])
  })
})

describe('loadSettlementMaster — 식당 품목명', () => {
  beforeEach(() => {
    // 나래유치원 원아급간식: 같은 식당인데 과세·면세 품목명이 다르다 (26년 6월 실측)
    tables['settlement_venue_items'] = {
      data: [
        {
          source: 'shinsegae',
          business_code: '89912',
          restaurant_code: '01',
          restaurant_name: '원아급간식',
          tax_kind: 'taxable',
          invoice_item_name: '원아급간식',
        },
        {
          source: 'shinsegae',
          business_code: '89912',
          restaurant_code: '01',
          restaurant_name: '원아급간식',
          tax_kind: 'exempt',
          invoice_item_name: '급식재료',
        },
      ],
      error: null,
    }
  })

  it('과세구분까지 넣은 키로 조회한다', async () => {
    const m = await loadSettlementMaster()
    expect(
      m.venueItems.get(venueItemKey('shinsegae', '89912', '01', 'taxable'))!.invoiceItemName
    ).toBe('원아급간식')
    expect(
      m.venueItems.get(venueItemKey('shinsegae', '89912', '01', 'exempt'))!.invoiceItemName
    ).toBe('급식재료')
  })

  it('지정되지 않은 식당은 키가 없다 (마감 차단 사유)', async () => {
    const m = await loadSettlementMaster()
    expect(m.venueItems.get(venueItemKey('cj', '9999', '1000', 'taxable'))).toBeUndefined()
  })

  it('사업장코드가 숫자로 와도 문자열로 통일한다', async () => {
    tables['settlement_venue_items'] = {
      data: [
        {
          source: 'cj',
          business_code: 1008,
          restaurant_code: 1000,
          restaurant_name: '키즈웰에듀푸드(선경유치원)',
          tax_kind: 'taxable',
          invoice_item_name: '급식재료',
        },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.venueItems.get(venueItemKey('cj', '1008', '1000', 'taxable'))).toBeDefined()
  })

  it('조회 실패는 throw한다 — 빈 맵으로 진행하면 전 식당이 미지정이 된다', async () => {
    tables['settlement_venue_items'] = { data: null, error: { message: 'boom' } }
    await expect(loadSettlementMaster()).rejects.toThrow('품목명 마스터 조회 실패')
  })
})

describe('loadSettlementMaster — 계산서 공급자', () => {
  it('단일 행을 읽는다', async () => {
    tables['settlement_issuer'] = {
      data: [
        {
          biz_reg_no: '8310503575',
          company_name: '키즈웰에듀푸드',
          ceo_name: '김중영',
          address: '서울특별시 송파구 충민로66, 8층F8101호',
          biz_type: '도매 및 소매업',
          biz_item: '교재',
          email: 'kidswellfood@naver.com',
        },
      ],
      error: null,
    }
    const m = await loadSettlementMaster()
    expect(m.issuer).toEqual({
      bizRegNo: '8310503575',
      companyName: '키즈웰에듀푸드',
      ceoName: '김중영',
      address: '서울특별시 송파구 충민로66, 8층F8101호',
      bizType: '도매 및 소매업',
      bizItem: '교재',
      email: 'kidswellfood@naver.com',
    })
  })

  it('설정이 없으면 null이다 (계산서를 만들 수 없다)', async () => {
    const m = await loadSettlementMaster()
    expect(m.issuer).toBeNull()
  })
})

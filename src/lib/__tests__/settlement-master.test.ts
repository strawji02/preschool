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
const mockFrom = vi.fn((table: string) => ({
  select: () => Promise.resolve(tables[table] ?? { data: [], error: null }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

const { loadSettlementMaster } = await import('@/features/settlement/data/master')

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

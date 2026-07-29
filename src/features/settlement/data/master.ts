// 클라이언트 컴포넌트가 실수로 이 모듈을 import하면 빌드가 실패한다.
// service_role 키를 다루는 코드가 브라우저 번들에 들어가는 것을 구조적으로 막는다.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PartnerType } from '../calc/settlement-formula'
import type { PartnerMapping, SettlementSource } from '../parse/types'

/**
 * 마스터 데이터 로딩 (migration 050: settlement_partners / settlement_venues).
 *
 * 데이터 접근은 프로젝트 관례대로 `createAdminClient()`(service_role)를 쓴다.
 * 두 테이블 모두 RLS default deny라 anon/authenticated로는 읽히지 않는다.
 */

export interface PartnerRecord {
  id: string
  name: string
  /** 코파운더는 적립금(O)을 신고액에 포함한다 */
  partnerType: PartnerType
  taxpayerType: 'individual' | 'business'
  /** 플랫폼 수수료율 % (기본 5) */
  commissionPercent: number
  isActive: boolean
}

export interface VenueRecord {
  source: SettlementSource
  businessCode: string
  businessName: string
  /** 담당 영업자 id. 제외 사업장이거나 미배정이면 null */
  partnerId: string | null
  isExcluded: boolean
}

export interface SettlementMaster {
  /** id → 영업자 */
  partners: Map<string, PartnerRecord>
  /**
   * `aggregateByPartner`에 그대로 넣는 매핑.
   * 값이 `null`이면 의도적 정산 제외, 키가 없으면 매핑 누락이다.
   */
  mapping: PartnerMapping
  venues: VenueRecord[]
}

/**
 * 영업자·사업장 마스터를 한 번에 읽어 파서가 쓸 형태로 만든다.
 *
 * ⚠️ **미배정 사업장은 매핑에 넣지 않는다.** `partner_id IS NULL AND NOT is_excluded`는
 * "아직 담당자를 정하지 않은" 상태이고, 이걸 `null`로 넣으면 의도적 제외와
 * 구분이 사라져 마감 검증이 무력화된다. 키를 비워두면 집계 단계에서 누락으로 잡힌다.
 */
export async function loadSettlementMaster(): Promise<SettlementMaster> {
  const supabase = createAdminClient()

  const [partnersRes, venuesRes] = await Promise.all([
    supabase
      .from('settlement_partners')
      .select('id, name, partner_type, taxpayer_type, commission_percent, is_active'),
    supabase
      .from('settlement_venues')
      .select('source, business_code, business_name, partner_id, is_excluded'),
  ])

  if (partnersRes.error) {
    throw new Error(`영업자 마스터 조회 실패: ${partnersRes.error.message}`)
  }
  if (venuesRes.error) {
    throw new Error(`사업장 마스터 조회 실패: ${venuesRes.error.message}`)
  }

  const partners = new Map<string, PartnerRecord>()
  for (const row of partnersRes.data ?? []) {
    partners.set(row.id, {
      id: row.id,
      name: row.name,
      partnerType: row.partner_type as PartnerType,
      taxpayerType: row.taxpayer_type as 'individual' | 'business',
      // numeric은 드라이버가 문자열로 줄 수 있다
      commissionPercent: Number(row.commission_percent),
      isActive: row.is_active,
    })
  }

  const venues: VenueRecord[] = (venuesRes.data ?? []).map((row) => ({
    source: row.source as SettlementSource,
    businessCode: String(row.business_code),
    businessName: row.business_name,
    partnerId: row.partner_id,
    isExcluded: row.is_excluded,
  }))

  const mapping: PartnerMapping = {}
  for (const v of venues) {
    const key = `${v.source}:${v.businessCode}`
    if (v.isExcluded) {
      mapping[key] = null // 의도적 제외
    } else if (v.partnerId) {
      mapping[key] = v.partnerId
    }
    // 미배정은 의도적으로 키를 만들지 않는다 (위 주석 참고)
  }

  return { partners, mapping, venues }
}

// 클라이언트 컴포넌트가 실수로 이 모듈을 import하면 빌드가 실패한다.
// service_role 키를 다루는 코드가 브라우저 번들에 들어가는 것을 구조적으로 막는다.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InvoiceRoundingMode } from '../calc/invoice-rounding'
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
  /** 왜 제외했는지 (예: 마케팅비). 제외가 아니면 null */
  exclusionReason: string | null
  /**
   * 계산서 총액을 10원 단위로 절사한다 (docs §6-2, migration 058).
   *
   * 유치원별 플래그로 둔 이유: 나중에 다른 곳이 추가돼도 코드를 안 고친다.
   * 절사는 **계산서 한 장씩 각각** 적용하고, 정산은 원값을 쓴다.
   */
  invoiceRoundDown: boolean
  /**
   * 계산서 발행 정보 (docs §6-1). 하나라도 비어 있으면 계산서를 만들 수 없다.
   *
   * ⚠️ `companyName`은 원천의 `businessName`과 **다르다** —
   * `해밀유치원`(계산서) vs `키즈웰에듀푸드(해밀유치원)`(원천).
   */
  invoice: VenueInvoiceInfo
}

export interface VenueInvoiceInfo {
  bizRegNo: string | null
  companyName: string | null
  ceoName: string | null
  address: string | null
  bizType: string | null
  bizItem: string | null
  email: string | null
  email2: string | null
}

/** 계산서 발행에 반드시 있어야 하는 항목 (이메일2는 선택) */
const REQUIRED_INVOICE_FIELDS = [
  ['bizRegNo', '사업자등록번호'],
  ['companyName', '상호'],
  ['ceoName', '대표자'],
  ['address', '사업장주소'],
  ['bizType', '업태'],
  ['bizItem', '종목'],
  ['email', '이메일'],
] as const

/**
 * 계산서 발행에 빠진 항목 이름들. 비어 있으면 발행 가능하다.
 *
 * 정산 제외 사업장은 계산서를 발행하지 않으므로 검사하지 않는다 —
 * 본사에 사업자 정보를 요구하면 영원히 마감할 수 없다.
 */
export function missingInvoiceFields(venue: VenueRecord): string[] {
  if (venue.isExcluded) return []
  return REQUIRED_INVOICE_FIELDS.filter(
    ([key]) => (venue.invoice[key] ?? '') === ''
  ).map(([, label]) => label)
}

export type TaxKind = 'taxable' | 'exempt'

export interface VenueItemRecord {
  source: SettlementSource
  businessCode: string
  restaurantCode: string
  restaurantName: string
  /**
   * ⚠️ 같은 식당이 과세·면세에서 품목명이 다를 수 있다 (나래유치원 `원아급간식`:
   * 과세 `원아급간식` / 면세 `급식재료`). 그래서 키에 포함한다.
   */
  taxKind: TaxKind
  invoiceItemName: string
}

/** 품목명 조회 키 — `"<원천>:<사업장>:<식당>:<과세구분>"` */
export type VenueItemKey = string

export function venueItemKey(
  source: SettlementSource,
  businessCode: string,
  restaurantCode: string,
  taxKind: TaxKind
): VenueItemKey {
  return `${source}:${businessCode}:${restaurantCode}:${taxKind}`
}

export interface IssuerRecord {
  bizRegNo: string
  companyName: string
  ceoName: string
  address: string
  bizType: string
  bizItem: string
  email: string
  /**
   * 원단위 절사 차액을 어디서 뺄지 (docs §6-2).
   * **세무사 협의로 바뀔 수 있어** 코드가 아니라 설정에 둔다.
   */
  roundingMode: InvoiceRoundingMode
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
  /** `venueItemKey()`로 조회. 키가 없으면 품목명 미지정 = 마감 차단 (docs §14-2) */
  venueItems: Map<VenueItemKey, VenueItemRecord>
  /** 계산서 공급자(본사). 미설정이면 null — 계산서를 만들 수 없다 */
  issuer: IssuerRecord | null
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

  const [partnersRes, venuesRes, itemsRes, issuerRes] = await Promise.all([
    supabase
      .from('settlement_partners')
      .select('id, name, partner_type, taxpayer_type, commission_percent, is_active'),
    // ⚠️ select 문자열을 `+`로 이으면 supabase-js가 열 타입을 추론하지 못해
    // 결과가 GenericStringError로 떨어진다. 반드시 한 개의 리터럴로 둘 것.
    supabase
      .from('settlement_venues')
      .select(
        'source, business_code, business_name, partner_id, is_excluded, exclusion_reason, invoice_round_down, biz_reg_no, company_name, ceo_name, address, biz_type, biz_item, email, email2'
      ),
    supabase
      .from('settlement_venue_items')
      .select('source, business_code, restaurant_code, restaurant_name, tax_kind, invoice_item_name'),
    supabase
      .from('settlement_issuer')
      .select('biz_reg_no, company_name, ceo_name, address, biz_type, biz_item, email, invoice_rounding_mode')
      .eq('id', 1)
      .maybeSingle(),
  ])

  if (partnersRes.error) {
    throw new Error(`영업자 마스터 조회 실패: ${partnersRes.error.message}`)
  }
  if (venuesRes.error) {
    throw new Error(`사업장 마스터 조회 실패: ${venuesRes.error.message}`)
  }
  if (itemsRes.error) {
    throw new Error(`품목명 마스터 조회 실패: ${itemsRes.error.message}`)
  }
  if (issuerRes.error) {
    throw new Error(`계산서 공급자 조회 실패: ${issuerRes.error.message}`)
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
    exclusionReason: row.exclusion_reason ?? null,
    invoiceRoundDown: row.invoice_round_down ?? false,
    invoice: {
      bizRegNo: row.biz_reg_no ?? null,
      companyName: row.company_name ?? null,
      ceoName: row.ceo_name ?? null,
      address: row.address ?? null,
      bizType: row.biz_type ?? null,
      bizItem: row.biz_item ?? null,
      email: row.email ?? null,
      email2: row.email2 ?? null,
    },
  }))

  const venueItems = new Map<VenueItemKey, VenueItemRecord>()
  for (const row of itemsRes.data ?? []) {
    const record: VenueItemRecord = {
      source: row.source as SettlementSource,
      businessCode: String(row.business_code),
      restaurantCode: String(row.restaurant_code),
      restaurantName: row.restaurant_name,
      taxKind: row.tax_kind as TaxKind,
      invoiceItemName: row.invoice_item_name,
    }
    venueItems.set(
      venueItemKey(
        record.source,
        record.businessCode,
        record.restaurantCode,
        record.taxKind
      ),
      record
    )
  }

  const issuerRow = issuerRes.data
  const issuer: IssuerRecord | null = issuerRow
    ? {
        bizRegNo: issuerRow.biz_reg_no,
        companyName: issuerRow.company_name,
        ceoName: issuerRow.ceo_name,
        address: issuerRow.address,
        bizType: issuerRow.biz_type,
        bizItem: issuerRow.biz_item,
        email: issuerRow.email,
        roundingMode: (issuerRow.invoice_rounding_mode ?? 'vat') as InvoiceRoundingMode,
      }
    : null

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

  return { partners, mapping, venues, venueItems, issuer }
}

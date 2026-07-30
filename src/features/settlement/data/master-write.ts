// 클라이언트 컴포넌트가 실수로 이 모듈을 import하면 빌드가 실패한다.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidBizRegNo, normalizeBizRegNo } from '../calc/biz-reg-no'
import type { SettlementSource } from '../parse/types'
import type { TaxKind } from './master'

/**
 * 마스터 쓰기 (docs §14-3).
 *
 * 매월 정산을 시작하면 신규 유치원·신규 식당이 나타난다. 그걸 **정산 화면 안에서
 * 그 자리에서** 해결하게 하는 것이 이 모듈의 목적이다 — 별도 관리 화면으로
 * 내보내면 담당자가 업로드한 파일과 맥락을 잃는다.
 *
 * ⚠️ 검증은 **서버에서 다시 한다.** 화면에서 이미 검증했더라도 클라이언트가 보낸
 * 값을 그대로 믿으면 안 된다 — 계산서에 그대로 찍히는 값이다.
 */

export interface VenueInvoiceInput {
  bizRegNo: string
  companyName: string
  ceoName: string
  address: string
  bizType: string
  bizItem: string
  email: string
  email2?: string | null
}

export interface AssignVenueInput {
  source: SettlementSource
  businessCode: string
  /** 원천 사업장명. 신규 등록 시 초기값으로 쓴다 */
  businessName: string
  /** 담당 영업자 id. 기존 영업자를 고른 경우 */
  partnerId?: string | null
  /** 신규 영업자를 만들 경우의 이름. `partnerId`와 둘 중 하나만 준다 */
  newPartnerName?: string | null
  /** 계산서 발행 정보. 생략하면 기존 값을 유지한다 */
  invoice?: VenueInvoiceInput | null
}

export interface ExcludeVenueInput {
  source: SettlementSource
  businessCode: string
  businessName: string
  reason: string
}

export interface SetItemNameInput {
  source: SettlementSource
  businessCode: string
  restaurantCode: string
  restaurantName: string
  taxKind: TaxKind
  invoiceItemName: string
}

/** 사람이 읽을 수 있는 실패 사유. UI가 그대로 보여준다. */
export class MasterWriteError extends Error {}

function requireText(value: unknown, label: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (s === '') throw new MasterWriteError(`${label}을(를) 입력해 주세요.`)
  return s
}

function validateInvoice(input: VenueInvoiceInput): VenueInvoiceInput {
  const bizRegNo = normalizeBizRegNo(input.bizRegNo ?? '')
  if (!isValidBizRegNo(bizRegNo)) {
    // 체크섬까지 본다. 형식만 맞는 오타는 계산서가 엉뚱한 사업자에게 간다.
    throw new MasterWriteError(
      `사업자등록번호가 올바르지 않습니다: ${input.bizRegNo}. 10자리를 다시 확인해 주세요.`
    )
  }
  const email = requireText(input.email, '이메일')
  if (!email.includes('@')) {
    throw new MasterWriteError(`이메일 형식이 올바르지 않습니다: ${email}`)
  }
  return {
    bizRegNo,
    companyName: requireText(input.companyName, '상호'),
    ceoName: requireText(input.ceoName, '대표자'),
    address: requireText(input.address, '사업장주소'),
    bizType: requireText(input.bizType, '업태'),
    bizItem: requireText(input.bizItem, '종목'),
    email,
    email2:
      typeof input.email2 === 'string' && input.email2.trim() !== ''
        ? input.email2.trim()
        : null,
  }
}

/**
 * 사업장에 담당 영업자를 배정한다 (신규 등록 겸용).
 *
 * 이미 있는 사업장이면 담당자·계산서 정보만 갱신한다 —
 * `(source, business_code)`가 유일 키라서 upsert가 자연스럽다.
 */
export async function assignVenue(input: AssignVenueInput): Promise<void> {
  const supabase = createAdminClient()

  const businessCode = requireText(input.businessCode, '사업장코드')
  const businessName = requireText(input.businessName, '사업장명')

  let partnerId = input.partnerId ?? null

  if (input.newPartnerName) {
    const name = requireText(input.newPartnerName, '영업자 이름')
    // 신규 영업자는 **항상 일반(partner)** 이다 (docs §3).
    // 코파운더 지정은 금액(신고액 V)에 직결되므로 여기서 만들 수 없게 한다.
    const { data, error } = await supabase
      .from('settlement_partners')
      .insert({ name, partner_type: 'partner', note: '정산 화면에서 신규 등록' })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505' || error.message.includes('duplicate')) {
        throw new MasterWriteError(`이미 있는 영업자입니다: ${name}`)
      }
      throw new MasterWriteError(`영업자 생성 실패: ${error.message}`)
    }
    partnerId = data.id
  }

  if (!partnerId) {
    throw new MasterWriteError('담당 영업자를 선택하거나 새로 등록해 주세요.')
  }

  const invoice = input.invoice ? validateInvoice(input.invoice) : null

  const row: Record<string, unknown> = {
    source: input.source,
    business_code: businessCode,
    business_name: businessName,
    partner_id: partnerId,
    is_excluded: false,
    exclusion_reason: null,
  }
  if (invoice) {
    row.biz_reg_no = invoice.bizRegNo
    row.company_name = invoice.companyName
    row.ceo_name = invoice.ceoName
    row.address = invoice.address
    row.biz_type = invoice.bizType
    row.biz_item = invoice.bizItem
    row.email = invoice.email
    row.email2 = invoice.email2
  }

  const { error } = await supabase
    .from('settlement_venues')
    .upsert(row, { onConflict: 'source,business_code' })
  if (error) throw new MasterWriteError(`사업장 저장 실패: ${error.message}`)
}

/**
 * 이미 배정된 사업장의 **계산서 정보만** 갱신한다.
 *
 * `assignVenue`의 upsert를 쓰면 담당 영업자를 함께 보내야 하고, 실수로 빠지면
 * 매핑이 지워진다 — 그 사업장 금액이 조용히 정산에서 빠지는 최악의 사고다.
 * 그래서 UPDATE로 계산서 열만 건드린다.
 */
export async function updateVenueInvoice(input: {
  source: SettlementSource
  businessCode: string
  invoice: VenueInvoiceInput
}): Promise<void> {
  const supabase = createAdminClient()
  const invoice = validateInvoice(input.invoice)

  const { data, error } = await supabase
    .from('settlement_venues')
    .update({
      biz_reg_no: invoice.bizRegNo,
      company_name: invoice.companyName,
      ceo_name: invoice.ceoName,
      address: invoice.address,
      biz_type: invoice.bizType,
      biz_item: invoice.bizItem,
      email: invoice.email,
      email2: invoice.email2,
    })
    .eq('source', input.source)
    .eq('business_code', requireText(input.businessCode, '사업장코드'))
    .select('id')

  if (error) throw new MasterWriteError(`계산서 정보 저장 실패: ${error.message}`)
  if (!data || data.length === 0) {
    throw new MasterWriteError(
      '사업장이 등록되지 않았습니다. 담당 영업자를 먼저 배정해 주세요.'
    )
  }
}

/**
 * 사업장을 정산에서 제외한다 (본사 마케팅비 등).
 *
 * **사유를 반드시 받는다.** 사유 없이 제외만 되어 있으면 다음 담당자가
 * 실수로 되살리거나, 왜 빠졌는지 추적할 수 없다.
 *
 * 제외 사업장에는 담당 영업자를 둘 수 없다 (migration 050 CHECK). 그래서
 * `partner_id`를 명시적으로 비운다.
 */
export async function excludeVenue(input: ExcludeVenueInput): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('settlement_venues').upsert(
    {
      source: input.source,
      business_code: requireText(input.businessCode, '사업장코드'),
      business_name: requireText(input.businessName, '사업장명'),
      partner_id: null,
      is_excluded: true,
      exclusion_reason: requireText(input.reason, '제외 사유'),
    },
    { onConflict: 'source,business_code' }
  )
  if (error) throw new MasterWriteError(`정산 제외 저장 실패: ${error.message}`)
}

/**
 * 식당 × 과세구분의 홈택스 품목명을 지정한다.
 *
 * ⚠️ 과세구분이 키에 들어간다 — 같은 식당이 과세·면세에서 품목명이 다를 수 있다
 * (나래유치원 `원아급간식`: 과세 `원아급간식` / 면세 `급식재료`).
 */
export async function setVenueItemName(input: SetItemNameInput): Promise<void> {
  const supabase = createAdminClient()
  const name = requireText(input.invoiceItemName, '품목명')

  const { error } = await supabase.from('settlement_venue_items').upsert(
    {
      source: input.source,
      business_code: requireText(input.businessCode, '사업장코드'),
      restaurant_code: requireText(input.restaurantCode, '식당코드'),
      restaurant_name: requireText(input.restaurantName, '식당명'),
      tax_kind: input.taxKind,
      invoice_item_name: name,
      note: '정산 화면에서 지정',
    },
    { onConflict: 'source,business_code,restaurant_code,tax_kind' }
  )
  if (error) {
    if (error.code === '23503') {
      // FK 위반 — 사업장이 아직 없다
      throw new MasterWriteError(
        '사업장이 등록되지 않아 품목명을 저장할 수 없습니다. 담당 영업자를 먼저 배정해 주세요.'
      )
    }
    throw new MasterWriteError(`품목명 저장 실패: ${error.message}`)
  }
}

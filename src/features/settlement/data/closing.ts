// 클라이언트 컴포넌트가 실수로 이 모듈을 import하면 빌드가 실패한다.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  closingTotals,
  closingTransition,
  isValidPeriod,
  type ClosingAction,
  type ClosingPartnerRow,
  type ClosingStatus,
  type ClosingTotals,
  type ClosingVenueRow,
} from '../calc/closing'

/**
 * 월 마감 저장·조회 (migration 053, docs §8·§14-1).
 *
 * ★ 절대 원칙: **과거 정산은 바뀌지 않는다.**
 * 마감 시점의 상태를 통째로 굳혀 두고, 재저장은 **새 리비전을 쌓는다** —
 * 덮어쓰지 않는다. 마감 후 수정도 이력이 남아야 한다 (docs §8).
 */

export type { ClosingStatus }

export const CLOSING_STATUS_LABEL: Record<ClosingStatus, string> = {
  draft: '작성중',
  confirmed: '확정',
  closed: '마감',
}

export class ClosingError extends Error {}

export interface SaveClosingInput {
  /** `YYYY-MM` */
  period: string
  /** `confirm`(확정) 또는 `close`(마감). 마감된 달이면 거부된다 (docs §8) */
  action: Extract<ClosingAction, 'confirm' | 'close'>
  venues: readonly ClosingVenueRow[]
  partners: readonly ClosingPartnerRow[]
  /**
   * 재현에 필요한 원본 전체 (정산 결과·공제 입력·분할 신고·계산서 행).
   * 정규화하지 않는다 — 스키마가 바뀌어도 과거 리비전을 그대로 읽어야 한다.
   */
  snapshot: unknown
  /** 저장한 사람 (이메일) */
  actor: string
  /** 왜 다시 저장했는지. 마감 후 수정이면 특히 중요하다 */
  reason?: string | null
  /**
   * 이 리비전에 대한 메모 (예: `테스트 마감`).
   *
   * ★ 주지 않으면 **비워진다.** 메모는 그 리비전에 대한 설명이므로 다음
   * 리비전까지 따라가면 안 된다 — 테스트 딱지가 진짜 마감에 남는다.
   */
  note?: string | null
}

export interface ClosingRecord {
  period: string
  status: ClosingStatus
  revision: number
  totals: ClosingTotals
  confirmedAt: string | null
  confirmedBy: string | null
  closedAt: string | null
  closedBy: string | null
  updatedAt: string
  /** 마감 해제 횟수. 0보다 크면 마감 후 수정이 있었다 */
  reopenCount: number
  /** 이 리비전에 붙은 메모. 재확정하면 비워진다 */
  note: string | null
}

export interface ClosingRevision {
  revision: number
  status: ClosingStatus
  /** `save` = 확정·마감 저장 / `reopen` = 마감 해제 */
  action: 'save' | 'reopen'
  reason: string | null
  createdAt: string
  createdBy: string | null
}

/** DB 컬럼 ↔ ClosingTotals 필드 대응. 한 곳에 두어 양방향이 어긋나지 않게 한다. */
const TOTAL_COLUMNS = [
  ['revenue', 'revenue'],
  ['cost_of_sales', 'costOfSales'],
  ['marketing_cost', 'marketingCost'],
  ['gross_margin', 'grossMargin'],
  ['platform_fee', 'platformFee'],
  ['vat_diff', 'vatDiff'],
  ['business_deduction', 'businessDeduction'],
  ['partner_pre_tax', 'partnerPreTax'],
  ['withholding', 'withholding'],
  ['partner_net_pay', 'partnerNetPay'],
  ['declared', 'declared'],
  ['hq_share', 'hqShare'],
  ['operating_profit', 'operatingProfit'],
  ['sales_vat', 'salesVat'],
  ['purchase_vat', 'purchaseVat'],
  ['vat_payable', 'vatPayable'],
] as const satisfies readonly (readonly [string, keyof ClosingTotals])[]

function totalsToColumns(t: ClosingTotals): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [col, key] of TOTAL_COLUMNS) out[col] = t[key]
  return out
}

function columnsToTotals(row: Record<string, unknown>): ClosingTotals {
  const out = {} as Record<keyof ClosingTotals, number>
  for (const [col, key] of TOTAL_COLUMNS) out[key] = Number(row[col] ?? 0)
  // vatDiffGap은 저장하지 않는다 — 항상 vatDiff − vatPayable로 나오는 파생값이다.
  // 컬럼으로 두면 둘이 어긋날 수 있다.
  return { ...out, vatDiffGap: out.vatDiff - out.vatPayable }
}

/**
 * 마감 저장. **새 리비전을 쌓는다.**
 *
 * 헤드라인 합계는 `closingTotals`로 서버에서 다시 계산한다 —
 * 클라이언트가 보낸 숫자를 그대로 믿으면 화면과 장부가 어긋날 수 있다.
 */
export async function saveClosing(input: SaveClosingInput): Promise<ClosingRecord> {
  if (!isValidPeriod(input.period)) {
    throw new ClosingError(
      `마감 기간이 올바르지 않습니다: ${input.period}. YYYY-MM 형식으로 주세요.`
    )
  }

  const supabase = createAdminClient()
  const totals = closingTotals(input.venues, input.partners)
  const now = new Date().toISOString()

  const existing = await supabase
    .from('settlement_closings')
    .select(
      'period, revision, status, confirmed_at, confirmed_by, closed_at, closed_by, reopen_count'
    )
    .eq('period', input.period)
    .maybeSingle()
  if (existing.error) {
    throw new ClosingError(`마감 조회 실패: ${existing.error.message}`)
  }

  const prev = existing.data

  // ★ 마감된 달은 저장할 수 없다. 해제를 거쳐야 한다 (docs §8).
  // 화면이 버튼을 잠그지만 서버가 최종 판단한다 — API를 직접 부르면 화면을 우회한다.
  const transition = closingTransition(
    (prev?.status as ClosingStatus | undefined) ?? null,
    input.action
  )
  if (!transition.allowed || !transition.nextStatus) {
    throw new ClosingError(transition.reason ?? '저장할 수 없는 상태입니다.')
  }
  const status = transition.nextStatus

  const revision = (prev?.revision ?? 0) + 1

  // 확정·마감 시각은 **처음 도달한 때**를 남긴다. 재저장할 때마다 갱신하면
  // "언제 마감했나"를 답할 수 없다.
  const confirmedAt = prev?.confirmed_at ?? now
  const confirmedBy = prev?.confirmed_by ?? input.actor
  const closedAt = status === 'closed' ? (prev?.closed_at ?? now) : (prev?.closed_at ?? null)
  const closedBy =
    status === 'closed' ? (prev?.closed_by ?? input.actor) : (prev?.closed_by ?? null)

  const upsert = await supabase
    .from('settlement_closings')
    .upsert(
      {
        period: input.period,
        status,
        revision,
        ...totalsToColumns(totals),
        confirmed_at: confirmedAt,
        confirmed_by: confirmedBy,
        closed_at: closedAt,
        closed_by: closedBy,
        // ★ 반드시 명시한다. 빼면 upsert가 기존 값을 그대로 두어, 한 번 붙인
        // 메모가 리비전을 넘어 살아남는다 (실DB 확인: revision 2에도 남았다).
        note: input.note ?? null,
      },
      { onConflict: 'period' }
    )
    .select(
      'period, status, revision, updated_at, confirmed_at, confirmed_by, closed_at, closed_by, reopen_count, note'
    )
    .single()
  if (upsert.error) throw new ClosingError(`마감 저장 실패: ${upsert.error.message}`)

  // 이력은 append-only. 실패하면 마감 상태만 바뀌고 근거가 없어지므로 즉시 알린다.
  const snap = await supabase.from('settlement_closing_snapshots').insert({
    period: input.period,
    revision,
    snapshot: input.snapshot as never,
    status,
    action: 'save',
    reason: input.reason ?? null,
    created_by: input.actor,
  })
  if (snap.error) throw new ClosingError(`스냅샷 저장 실패: ${snap.error.message}`)

  // flat facts는 현재 리비전만 담는다 — 지우고 다시 넣는다 (이력은 위 스냅샷).
  await supabase.from('settlement_closing_venues').delete().eq('period', input.period)
  await supabase.from('settlement_closing_partners').delete().eq('period', input.period)

  if (input.venues.length > 0) {
    const rows = input.venues.map((v) => ({
      period: input.period,
      source: v.source,
      business_code: v.businessCode,
      business_name: v.businessName,
      restaurant_code: v.restaurantCode,
      restaurant_name: v.restaurantName,
      company_name: v.companyName,
      partner_id: v.partnerId,
      partner_name: v.partnerName,
      is_excluded: v.isExcluded,
      exclusion_reason: v.exclusionReason,
      cost_supply: v.cost.taxableSupply,
      cost_vat: v.cost.vat,
      cost_exempt: v.cost.exempt,
      cost_total: v.cost.total,
      price_supply: v.price.taxableSupply,
      price_vat: v.price.vat,
      price_exempt: v.price.exempt,
      price_total: v.price.total,
    }))
    const res = await supabase.from('settlement_closing_venues').insert(rows)
    if (res.error) throw new ClosingError(`식당 확정값 저장 실패: ${res.error.message}`)
  }

  if (input.partners.length > 0) {
    const rows = input.partners.map((p) => ({
      period: input.period,
      partner_id: p.partnerId,
      partner_name: p.partnerName,
      partner_type: p.partnerType,
      commission_percent: p.commissionPercent,
      cost_total: p.costTotal,
      cost_vat: p.costVat,
      price_total: p.priceTotal,
      price_vat: p.priceVat,
      margin: p.margin,
      platform_fee: p.platformFee,
      vat_diff: p.vatDiff,
      business_deduction: p.businessDeduction,
      pre_tax: p.preTax,
      declared: p.declared,
      income_tax: p.incomeTax,
      local_tax: p.localTax,
      net_pay: p.netPay,
    }))
    const res = await supabase.from('settlement_closing_partners').insert(rows)
    if (res.error) throw new ClosingError(`영업자 확정값 저장 실패: ${res.error.message}`)
  }

  return {
    period: upsert.data.period,
    status: upsert.data.status as ClosingStatus,
    revision: upsert.data.revision,
    totals,
    confirmedAt: upsert.data.confirmed_at,
    confirmedBy: upsert.data.confirmed_by,
    closedAt: upsert.data.closed_at,
    closedBy: upsert.data.closed_by,
    updatedAt: upsert.data.updated_at,
    reopenCount: Number(upsert.data.reopen_count ?? 0),
    note: (upsert.data as { note?: string | null }).note ?? null,
  }
}

/**
 * 마감 해제 (docs §8) — **admin 전용**. 권한 확인은 API가 한다.
 *
 * 마감을 `확정`으로 되돌린다. 스냅샷은 지우지 않고 **새 리비전을 쌓는다** —
 * 마감 문서가 바뀐 사건이므로 이력에 남아야 한다.
 *
 * 마감 시각(`closed_at`)은 **지우지 않는다.** "한 번 마감했었다"는 사실이
 * 사라지면 나중에 추적할 수 없다. 다시 마감하면 그 시각이 유지된다.
 */
export async function reopenClosing(input: {
  period: string
  actor: string
  reason: string
}): Promise<ClosingRecord> {
  const reason = input.reason.trim()
  if (reason === '') {
    // 사유 없는 해제는 나중에 "왜 열었나"를 답할 수 없다
    throw new ClosingError('마감을 해제하려면 사유를 입력해 주세요.')
  }

  const supabase = createAdminClient()
  const existing = await supabase
    .from('settlement_closings')
    .select('period, status, revision, reopen_count')
    .eq('period', input.period)
    .maybeSingle()
  if (existing.error) throw new ClosingError(`마감 조회 실패: ${existing.error.message}`)
  if (!existing.data) throw new ClosingError(`${input.period} 마감 기록이 없습니다.`)

  const transition = closingTransition(existing.data.status as ClosingStatus, 'reopen')
  if (!transition.allowed || !transition.nextStatus) {
    throw new ClosingError(transition.reason ?? '해제할 수 없는 상태입니다.')
  }

  const revision = Number(existing.data.revision) + 1
  const update = await supabase
    .from('settlement_closings')
    .update({
      status: transition.nextStatus,
      revision,
      reopen_count: Number(existing.data.reopen_count ?? 0) + 1,
    })
    .eq('period', input.period)
    .select('*')
    .single()
  if (update.error) throw new ClosingError(`마감 해제 실패: ${update.error.message}`)

  // 해제도 이력으로 남긴다. 스냅샷 본문은 직전 리비전과 같으므로 참조만 적는다.
  const snap = await supabase.from('settlement_closing_snapshots').insert({
    period: input.period,
    revision,
    snapshot: { reopenedFrom: Number(existing.data.revision) } as never,
    status: transition.nextStatus,
    action: 'reopen',
    reason,
    created_by: input.actor,
  })
  if (snap.error) throw new ClosingError(`해제 이력 저장 실패: ${snap.error.message}`)

  const row = update.data as Record<string, unknown>
  return {
    period: String(row.period),
    status: row.status as ClosingStatus,
    revision: Number(row.revision),
    totals: columnsToTotals(row),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    confirmedBy: (row.confirmed_by as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
    closedBy: (row.closed_by as string | null) ?? null,
    updatedAt: String(row.updated_at),
    reopenCount: Number(row.reopen_count ?? 0),
    note: (row.note as string | null) ?? null,
  }
}

/** 한 달의 마감 상태. 없으면 null (아직 저장한 적 없음 = 작성중) */
export async function loadClosing(period: string): Promise<ClosingRecord | null> {
  if (!isValidPeriod(period)) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('settlement_closings')
    .select('*')
    .eq('period', period)
    .maybeSingle()
  if (error) throw new ClosingError(`마감 조회 실패: ${error.message}`)
  if (!data) return null

  const row = data as Record<string, unknown>
  return {
    period: String(row.period),
    status: row.status as ClosingStatus,
    revision: Number(row.revision),
    totals: columnsToTotals(row),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    confirmedBy: (row.confirmed_by as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
    closedBy: (row.closed_by as string | null) ?? null,
    updatedAt: String(row.updated_at),
    reopenCount: Number(row.reopen_count ?? 0),
    note: (row.note as string | null) ?? null,
  }
}

/** 저장 이력 (최신순). 마감 후 수정이 있었는지 여기서 드러난다. */
export async function loadClosingRevisions(period: string): Promise<ClosingRevision[]> {
  if (!isValidPeriod(period)) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('settlement_closing_snapshots')
    .select('revision, status, action, reason, created_at, created_by')
    .eq('period', period)
    .order('revision', { ascending: false })
  if (error) throw new ClosingError(`마감 이력 조회 실패: ${error.message}`)

  return (data ?? []).map((r) => ({
    revision: r.revision,
    status: r.status as ClosingStatus,
    action: (r.action as 'save' | 'reopen') ?? 'save',
    reason: r.reason,
    createdAt: r.created_at,
    createdBy: r.created_by,
  }))
}

/** 월별 목록 (최신순) — 경영 보고서의 추이 표에 쓴다 (docs §13) */
export async function listClosings(limit = 24): Promise<ClosingRecord[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('settlement_closings')
    .select('*')
    .order('period', { ascending: false })
    .limit(limit)
  if (error) throw new ClosingError(`마감 목록 조회 실패: ${error.message}`)

  return (data ?? []).map((d) => {
    const row = d as Record<string, unknown>
    return {
      period: String(row.period),
      status: row.status as ClosingStatus,
      revision: Number(row.revision),
      totals: columnsToTotals(row),
      confirmedAt: (row.confirmed_at as string | null) ?? null,
      confirmedBy: (row.confirmed_by as string | null) ?? null,
      closedAt: (row.closed_at as string | null) ?? null,
      closedBy: (row.closed_by as string | null) ?? null,
      updatedAt: String(row.updated_at),
      reopenCount: Number(row.reopen_count ?? 0),
      note: (row.note as string | null) ?? null,
    }
  })
}

/** 경영 보고서용 상세 (docs §13) */
/**
 * 현재 리비전의 스냅샷 원본 (docs §8-2).
 *
 * 확정·마감한 달의 계산서·내역서를 **원천 파일 없이** 다시 만들 때 쓴다.
 * 마스터가 바뀐 뒤에 다시 뽑아도 마감 당시와 같은 파일이 나와야 하므로,
 * 여기서 나온 값으로만 만든다 — 다시 계산하지 않는다.
 */
export async function loadClosingSnapshot(period: string): Promise<{
  closing: ClosingRecord
  snapshot: Record<string, unknown>
} | null> {
  const closing = await loadClosing(period)
  if (!closing) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('settlement_closing_snapshots')
    .select('snapshot')
    .eq('period', period)
    .eq('revision', closing.revision)
    .maybeSingle()

  if (error) throw new ClosingError(`스냅샷 조회 실패: ${error.message}`)
  if (!data?.snapshot) return null
  return { closing, snapshot: data.snapshot as Record<string, unknown> }
}

export interface ClosingDetail {
  closing: ClosingRecord
  venues: ClosingVenueRow[]
  partners: ClosingPartnerRow[]
}

/**
 * 마감 월의 상세 조회 — 식당·영업자 flat facts.
 *
 * jsonb 스냅샷이 아니라 flat 테이블을 읽는다. 스냅샷은 재현용이고, 보고서는
 * 질의용이다 (docs §14-8). 현재 리비전의 값이 들어 있다.
 */
export async function loadClosingDetail(period: string): Promise<ClosingDetail | null> {
  const closing = await loadClosing(period)
  if (!closing) return null

  const supabase = createAdminClient()
  const [venuesRes, partnersRes] = await Promise.all([
    supabase
      .from('settlement_closing_venues')
      .select(
        'source, business_code, business_name, restaurant_code, restaurant_name, company_name, partner_id, partner_name, is_excluded, exclusion_reason, cost_supply, cost_vat, cost_exempt, cost_total, price_supply, price_vat, price_exempt, price_total'
      )
      .eq('period', period),
    supabase
      .from('settlement_closing_partners')
      .select(
        'partner_id, partner_name, partner_type, commission_percent, cost_total, cost_vat, price_total, price_vat, margin, platform_fee, vat_diff, business_deduction, pre_tax, declared, income_tax, local_tax, net_pay'
      )
      .eq('period', period),
  ])
  if (venuesRes.error) throw new ClosingError(`식당 확정값 조회 실패: ${venuesRes.error.message}`)
  if (partnersRes.error) {
    throw new ClosingError(`영업자 확정값 조회 실패: ${partnersRes.error.message}`)
  }

  const venues: ClosingVenueRow[] = (venuesRes.data ?? []).map((r) => ({
    source: r.source as ClosingVenueRow['source'],
    businessCode: String(r.business_code),
    businessName: r.business_name,
    restaurantCode: String(r.restaurant_code),
    restaurantName: r.restaurant_name,
    companyName: r.company_name ?? null,
    partnerId: r.partner_id,
    partnerName: r.partner_name,
    isExcluded: r.is_excluded,
    exclusionReason: r.exclusion_reason,
    cost: {
      taxableSupply: Number(r.cost_supply),
      vat: Number(r.cost_vat),
      exempt: Number(r.cost_exempt),
      total: Number(r.cost_total),
    },
    price: {
      taxableSupply: Number(r.price_supply),
      vat: Number(r.price_vat),
      exempt: Number(r.price_exempt),
      total: Number(r.price_total),
    },
  }))

  const partners: ClosingPartnerRow[] = (partnersRes.data ?? [])
    .map((r) => ({
      partnerId: r.partner_id,
      partnerName: r.partner_name,
      partnerType: r.partner_type as ClosingPartnerRow['partnerType'],
      // numeric은 드라이버가 문자열로 줄 수 있다
      commissionPercent: Number(r.commission_percent),
      costTotal: Number(r.cost_total),
      costVat: Number(r.cost_vat),
      priceTotal: Number(r.price_total),
      priceVat: Number(r.price_vat),
      margin: Number(r.margin),
      platformFee: Number(r.platform_fee),
      vatDiff: Number(r.vat_diff),
      businessDeduction: Number(r.business_deduction),
      preTax: Number(r.pre_tax),
      declared: Number(r.declared),
      incomeTax: Number(r.income_tax),
      localTax: Number(r.local_tax),
      netPay: Number(r.net_pay),
    }))
    // 지급액이 큰 순 — 보고서는 큰 것부터 본다
    .sort((a, b) => b.preTax - a.preTax)

  return { closing, venues, partners }
}

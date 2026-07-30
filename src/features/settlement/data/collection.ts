// 클라이언트 컴포넌트가 실수로 이 모듈을 import하면 빌드가 실패한다.
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildCollectionSummary,
  type CollectionSummary,
  type PayoutRecord,
  type ReceiptRecord,
} from '../calc/collection'
import { isValidPeriod } from '../calc/closing'
import type { SettlementSource } from '../parse/types'
import { loadClosingDetail } from './closing'

/**
 * 수금·지급 기록 (migration 055, docs §9).
 *
 * 청구액·실지급액은 **마감 스냅샷에서 온다.** 여기에는 입금·지급 기록만 저장한다 —
 * 금액을 두 곳에 두면 어긋난다.
 *
 * 마감된 달에만 기록할 수 있다. 마감 전에는 청구액이 확정되지 않아 미수금을
 * 계산할 근거가 없다.
 */

export class CollectionError extends Error {}

/** 화면이 보여줄 항목 — id가 있어야 개별 삭제가 된다 */
export interface ReceiptEntry extends ReceiptRecord {
  id: string
  createdBy: string | null
}

export interface PayoutEntry extends PayoutRecord {
  id: string
  createdBy: string | null
}

export interface CollectionView {
  period: string
  summary: CollectionSummary
  receipts: ReceiptEntry[]
  payouts: PayoutEntry[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function requireDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) {
    throw new CollectionError(`${label}를 YYYY-MM-DD 형식으로 입력해 주세요.`)
  }
  return value
}

function requireAmount(value: number, label: string): number {
  if (!Number.isFinite(value) || value === 0) {
    throw new CollectionError(`${label}을 입력해 주세요. 0은 기록할 수 없습니다.`)
  }
  return Math.trunc(value)
}

async function requireClosedPeriod(period: string): Promise<void> {
  if (!isValidPeriod(period)) {
    throw new CollectionError(`기간이 올바르지 않습니다: ${period}. YYYY-MM 형식으로 주세요.`)
  }
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('settlement_closings')
    .select('period')
    .eq('period', period)
    .maybeSingle()
  if (error) throw new CollectionError(`마감 조회 실패: ${error.message}`)
  if (!data) {
    // 마감 전에는 청구액이 없으므로 미수금을 계산할 수 없다
    throw new CollectionError(
      `${period}은 아직 확정·마감되지 않았습니다. 정산을 확정한 뒤 입금을 기록해 주세요.`
    )
  }
}

/** 유치원 입금 기록 추가 */
export async function addReceipt(input: {
  period: string
  source: SettlementSource
  businessCode: string
  receivedDate: string
  amount: number
  note?: string | null
  actor: string
}): Promise<void> {
  await requireClosedPeriod(input.period)
  const supabase = createAdminClient()
  const { error } = await supabase.from('settlement_receipts').insert({
    period: input.period,
    source: input.source,
    business_code: input.businessCode,
    received_date: requireDate(input.receivedDate, '입금일자'),
    amount: requireAmount(input.amount, '입금액'),
    note: input.note?.trim() || null,
    created_by: input.actor,
  })
  if (error) throw new CollectionError(`입금 기록 저장 실패: ${error.message}`)
}

/** 영업자 지급 기록 추가 */
export async function addPayout(input: {
  period: string
  partnerId: string
  paidDate: string
  amount: number
  note?: string | null
  actor: string
}): Promise<void> {
  await requireClosedPeriod(input.period)
  const supabase = createAdminClient()
  const { error } = await supabase.from('settlement_payouts').insert({
    period: input.period,
    partner_id: input.partnerId,
    paid_date: requireDate(input.paidDate, '지급일자'),
    amount: requireAmount(input.amount, '지급액'),
    note: input.note?.trim() || null,
    created_by: input.actor,
  })
  if (error) throw new CollectionError(`지급 기록 저장 실패: ${error.message}`)
}

/**
 * 기록 삭제.
 *
 * 수정 대신 **삭제 후 재입력**으로 처리한다. 입금 기록은 여러 행이 모여 합계를
 * 이루므로, 부분 수정을 허용하면 어느 행이 어느 입금인지 추적이 어려워진다.
 */
export async function deleteReceipt(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('settlement_receipts').delete().eq('id', id)
  if (error) throw new CollectionError(`입금 기록 삭제 실패: ${error.message}`)
}

export async function deletePayout(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('settlement_payouts').delete().eq('id', id)
  if (error) throw new CollectionError(`지급 기록 삭제 실패: ${error.message}`)
}

/**
 * 한 달의 수금·지급 현황.
 *
 * 마감 스냅샷(청구액·실지급액) + 입금·지급 기록을 합쳐 순수 함수에 넘긴다.
 * 마감되지 않은 달은 null — 청구액이 없어 미수금을 계산할 수 없다.
 */
export async function loadCollection(period: string): Promise<CollectionView | null> {
  if (!isValidPeriod(period)) return null
  const detail = await loadClosingDetail(period)
  if (!detail) return null

  const supabase = createAdminClient()
  const [receiptsRes, payoutsRes] = await Promise.all([
    supabase
      .from('settlement_receipts')
      .select('id, source, business_code, received_date, amount, note, created_by')
      .eq('period', period)
      .order('received_date', { ascending: true }),
    supabase
      .from('settlement_payouts')
      .select('id, partner_id, paid_date, amount, note, created_by')
      .eq('period', period)
      .order('paid_date', { ascending: true }),
  ])
  if (receiptsRes.error) {
    throw new CollectionError(`입금 기록 조회 실패: ${receiptsRes.error.message}`)
  }
  if (payoutsRes.error) {
    throw new CollectionError(`지급 기록 조회 실패: ${payoutsRes.error.message}`)
  }

  const receipts: ReceiptEntry[] = (receiptsRes.data ?? []).map((r) => ({
    id: r.id,
    source: r.source as SettlementSource,
    businessCode: String(r.business_code),
    receivedDate: r.received_date,
    amount: Number(r.amount),
    note: r.note,
    createdBy: r.created_by,
  }))
  const payouts: PayoutEntry[] = (payoutsRes.data ?? []).map((p) => ({
    id: p.id,
    partnerId: p.partner_id,
    paidDate: p.paid_date,
    amount: Number(p.amount),
    note: p.note,
    createdBy: p.created_by,
  }))

  return {
    period,
    summary: buildCollectionSummary({
      venues: detail.venues,
      partners: detail.partners,
      receipts,
      payouts,
    }),
    receipts,
    payouts,
  }
}

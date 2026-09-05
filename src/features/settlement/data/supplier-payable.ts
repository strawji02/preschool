import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildSupplierPayableSummary,
  calculateSupplierPrincipals,
  type SupplierAdjustmentRecord,
  type SupplierPaymentRecord,
  type SupplierPayableSummary,
} from '../calc/supplier-payable'
import type { SettlementSource } from '../parse/types'
import { loadClosingDetail } from './closing'

export class SupplierPayableError extends Error {}

export interface SupplierPaymentEntry extends SupplierPaymentRecord {
  id: string
  closingRevision: number
  note: string | null
  status: 'active' | 'cancelled'
  createdBy: string
}

export interface SupplierAdjustmentEntry extends SupplierAdjustmentRecord {
  id: string
  closingRevision: number
  reason: string
  createdBy: string
}

export interface SupplierPayableView {
  period: string
  closingRevision: number
  summary: SupplierPayableSummary
  payments: SupplierPaymentEntry[]
  adjustments: SupplierAdjustmentEntry[]
  needsReview: boolean
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function requireConfirmedPeriod(period: string) {
  const detail = await loadClosingDetail(period)
  if (!detail || !['confirmed', 'closed'].includes(detail.closing.status)) {
    throw new SupplierPayableError(`${period} 청구를 먼저 확정해 주세요.`)
  }
  return detail
}

export async function loadSupplierPayable(period: string): Promise<SupplierPayableView | null> {
  const detail = await loadClosingDetail(period)
  if (!detail) return null
  const db = createAdminClient()
  const [paymentsRes, adjustmentsRes] = await Promise.all([
    db
      .from('settlement_supplier_payments')
      .select('id, source, closing_revision, paid_date, amount, note, status, created_by')
      .eq('period', period)
      .order('paid_date'),
    db
      .from('settlement_supplier_adjustments')
      .select('id, source, closing_revision, amount, reason, status, created_by')
      .eq('period', period)
      .order('created_at'),
  ])
  if (paymentsRes.error) throw new SupplierPayableError(`공급자 지급 조회 실패: ${paymentsRes.error.message}`)
  if (adjustmentsRes.error) throw new SupplierPayableError(`공급자 조정 조회 실패: ${adjustmentsRes.error.message}`)

  const payments: SupplierPaymentEntry[] = (paymentsRes.data ?? []).map((row) => ({
    id: row.id,
    source: row.source as SettlementSource,
    closingRevision: Number(row.closing_revision),
    paidDate: row.paid_date,
    amount: Number(row.amount),
    note: row.note,
    status: row.status as 'active' | 'cancelled',
    createdBy: row.created_by,
  }))
  const adjustments: SupplierAdjustmentEntry[] = (adjustmentsRes.data ?? []).map((row) => ({
    id: row.id,
    source: row.source as SettlementSource,
    closingRevision: Number(row.closing_revision),
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status as SupplierAdjustmentRecord['status'],
    createdBy: row.created_by,
  }))
  const activePayments = payments.filter((row) => row.status === 'active')
  const summary = buildSupplierPayableSummary({
    principals: calculateSupplierPrincipals(detail.venues),
    adjustments,
    payments: activePayments,
  })
  return {
    period,
    closingRevision: detail.closing.revision,
    summary,
    payments,
    adjustments,
    needsReview: [...payments, ...adjustments].some(
      (row) => row.status !== 'cancelled' && row.closingRevision !== detail.closing.revision
    ),
  }
}

export async function addSupplierPayment(input: {
  period: string
  source: SettlementSource
  paidDate: string
  amount: number
  note?: string | null
  actor: string
}): Promise<void> {
  const detail = await requireConfirmedPeriod(input.period)
  if (!DATE_RE.test(input.paidDate)) throw new SupplierPayableError('지급일자를 확인해 주세요.')
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new SupplierPayableError('지급액은 0보다 큰 원 단위 정수로 입력해 주세요.')
  }
  if (
    calculateSupplierPrincipals(detail.venues).find((row) => row.source === input.source)?.amount === 0
  ) {
    throw new SupplierPayableError('이 공급사의 확정 원금이 없습니다.')
  }
  const db = createAdminClient()
  const { error } = await db.from('settlement_supplier_payments').insert({
    period: input.period,
    source: input.source,
    closing_revision: detail.closing.revision,
    paid_date: input.paidDate,
    amount: input.amount,
    note: input.note?.trim() || null,
    created_by: input.actor,
  })
  if (error) throw new SupplierPayableError(`공급자 지급 저장 실패: ${error.message}`)
}

export async function addSupplierAdjustment(input: {
  period: string
  source: SettlementSource
  amount: number
  reason: string
  actor: string
}): Promise<void> {
  const detail = await requireConfirmedPeriod(input.period)
  if (!Number.isSafeInteger(input.amount) || input.amount === 0 || !input.reason.trim()) {
    throw new SupplierPayableError('0이 아닌 원 단위 조정액과 사유를 입력해 주세요.')
  }
  const db = createAdminClient()
  const { error } = await db.from('settlement_supplier_adjustments').insert({
    period: input.period,
    source: input.source,
    closing_revision: detail.closing.revision,
    amount: input.amount,
    reason: input.reason.trim(),
    created_by: input.actor,
  })
  if (error) throw new SupplierPayableError(`공급자 조정 저장 실패: ${error.message}`)
}

export async function approveSupplierAdjustment(id: string, actor: string): Promise<void> {
  const db = createAdminClient()
  const { data, error: readError } = await db
    .from('settlement_supplier_adjustments')
    .select('period, closing_revision, status')
    .eq('id', id)
    .maybeSingle()
  if (readError || !data) throw new SupplierPayableError('승인할 조정을 찾지 못했습니다.')
  const detail = await requireConfirmedPeriod(data.period)
  if (Number(data.closing_revision) !== detail.closing.revision) {
    throw new SupplierPayableError('청구 금액이 변경되었습니다. 조정을 취소하고 다시 등록해 주세요.')
  }
  const { error } = await db
    .from('settlement_supplier_adjustments')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: actor })
    .eq('id', id)
    .eq('status', 'draft')
  if (error) throw new SupplierPayableError(`공급자 조정 승인 실패: ${error.message}`)
}

export async function cancelSupplierEntry(input: {
  kind: 'payment' | 'adjustment'
  id: string
  actor: string
  reason: string
}): Promise<void> {
  if (!input.reason.trim()) throw new SupplierPayableError('취소 사유를 입력해 주세요.')
  const table = input.kind === 'payment' ? 'settlement_supplier_payments' : 'settlement_supplier_adjustments'
  const db = createAdminClient()
  const { error } = await db
    .from(table)
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: input.actor,
      cancellation_reason: input.reason.trim(),
    })
    .eq('id', input.id)
  if (error) throw new SupplierPayableError(`공급자 원장 취소 실패: ${error.message}`)
}

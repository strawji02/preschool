import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  InvoiceOverride,
  InvoiceOverrideDraft,
  InvoiceOverrideStatus,
} from '../calc/invoice-policy'
import { validateInvoiceOverrideDraft } from '../calc/invoice-policy'
import type { InvoiceTaxKind } from '../report/invoice-sheet'

export class InvoiceOverrideError extends Error {}

interface Row {
  id: string
  period: string
  source: 'cj'
  business_code: '1016'
  tax_kind: InvoiceTaxKind
  item_name: string
  original_supply: number | string
  original_vat: number | string
  final_supply: number | string
  final_vat: number | string
  reason: string
  status: InvoiceOverrideStatus
}

const COLUMNS =
  'id, period, source, business_code, tax_kind, item_name, original_supply, original_vat, final_supply, final_vat, reason, status'

function toRecord(row: Row): InvoiceOverride {
  return {
    id: row.id,
    period: row.period,
    source: row.source,
    businessCode: row.business_code,
    taxKind: row.tax_kind,
    itemName: row.item_name,
    originalSupply: Number(row.original_supply),
    originalVat: Number(row.original_vat),
    finalSupply: Number(row.final_supply),
    finalVat: Number(row.final_vat),
    reason: row.reason,
    status: row.status,
  }
}

export async function listInvoiceOverrides(period: string): Promise<InvoiceOverride[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_invoice_overrides')
    .select(COLUMNS)
    .eq('period', period)
    .order('created_at')
  if (error) throw new InvoiceOverrideError(`원단위 조정 조회 실패: ${error.message}`)
  return (data ?? []).map((row) => toRecord(row as unknown as Row))
}

export async function createInvoiceOverride(input: {
  period: string
  taxKind: InvoiceTaxKind
  itemName: string
  originalSupply: number
  originalVat: number
  finalSupply: number
  finalVat: number
  reason: string
  actor: string
}): Promise<InvoiceOverride> {
  const [created] = await createInvoiceOverrides({
    period: input.period,
    actor: input.actor,
    items: [input],
  })
  return created
}

/** 여러 조정행을 한 SQL insert로 저장해 부분 승인요청을 만들지 않는다. */
export async function createInvoiceOverrides(input: {
  period: string
  actor: string
  items: readonly InvoiceOverrideDraft[]
}): Promise<InvoiceOverride[]> {
  if (input.items.length === 0 || input.items.length > 100) {
    throw new InvoiceOverrideError('승인 요청은 한 번에 1~100건까지 처리할 수 있습니다.')
  }
  const keys = new Set<string>()
  for (const item of input.items) {
    const problem = validateInvoiceOverrideDraft(item)
    if (problem) throw new InvoiceOverrideError(problem)
    const key = `${item.taxKind}:${item.itemName.trim()}`
    if (keys.has(key)) throw new InvoiceOverrideError(`중복된 조정 품목입니다: ${item.itemName}`)
    keys.add(key)
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_invoice_overrides')
    .insert(input.items.map((item) => ({
      period: input.period,
      source: 'cj' as const,
      business_code: '1016' as const,
      tax_kind: item.taxKind,
      item_name: item.itemName.trim(),
      original_supply: item.originalSupply,
      original_vat: item.originalVat,
      final_supply: item.finalSupply,
      final_vat: item.finalVat,
      reason: item.reason.trim(),
      status: 'draft' as const,
      created_by: input.actor,
    })))
    .select(COLUMNS)
  if (error) throw new InvoiceOverrideError(`원단위 조정 저장 실패: ${error.message}`)
  return (data ?? []).map((row) => toRecord(row as unknown as Row))
}

export async function approveInvoiceOverride(id: string, actor: string): Promise<void> {
  await approveInvoiceOverrides([id], actor)
}

/** 여러 승인대기 건을 한 SQL update로 승인한다. */
export async function approveInvoiceOverrides(ids: readonly string[], actor: string): Promise<void> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  if (uniqueIds.length === 0 || uniqueIds.length > 100) {
    throw new InvoiceOverrideError('승인은 한 번에 1~100건까지 처리할 수 있습니다.')
  }
  const db = createAdminClient()
  const existing = await db
    .from('settlement_invoice_overrides')
    .select('id, status')
    .in('id', uniqueIds)
  if (existing.error) {
    throw new InvoiceOverrideError(`원단위 조정 승인 전 확인 실패: ${existing.error.message}`)
  }
  if ((existing.data ?? []).length !== uniqueIds.length ||
    (existing.data ?? []).some((row) => row.status !== 'draft')) {
    throw new InvoiceOverrideError('이미 처리됐거나 찾을 수 없는 승인 요청이 포함되어 있습니다.')
  }
  const { data, error } = await db
    .from('settlement_invoice_overrides')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: actor })
    .in('id', uniqueIds)
    .eq('status', 'draft')
    .select('id')
  if (error) throw new InvoiceOverrideError(`원단위 조정 승인 실패: ${error.message}`)
  if ((data ?? []).length !== uniqueIds.length) {
    throw new InvoiceOverrideError('이미 처리됐거나 찾을 수 없는 승인 요청이 포함되어 있습니다.')
  }
}

export async function cancelInvoiceOverride(
  id: string,
  actor: string,
  reason: string
): Promise<void> {
  if (!reason.trim()) throw new InvoiceOverrideError('취소 사유를 입력해 주세요.')
  const db = createAdminClient()
  const { error } = await db
    .from('settlement_invoice_overrides')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: actor,
      cancellation_reason: reason.trim(),
    })
    .eq('id', id)
    .in('status', ['draft', 'approved'])
  if (error) throw new InvoiceOverrideError(`원단위 조정 취소 실패: ${error.message}`)
}

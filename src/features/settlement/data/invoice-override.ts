import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  InvoiceOverride,
  InvoiceOverrideStatus,
} from '../calc/invoice-policy'
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
  const values = [input.originalSupply, input.originalVat, input.finalSupply, input.finalVat]
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new InvoiceOverrideError('공급가·부가세는 0 이상의 원 단위 정수로 입력해 주세요.')
  }
  if (input.taxKind === 'exempt' && (input.originalVat !== 0 || input.finalVat !== 0)) {
    throw new InvoiceOverrideError('면세 계산서에는 부가세를 입력할 수 없습니다.')
  }
  if (!input.itemName.trim() || !input.reason.trim()) {
    throw new InvoiceOverrideError('품목명과 조정 사유를 입력해 주세요.')
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_invoice_overrides')
    .insert({
      period: input.period,
      source: 'cj',
      business_code: '1016',
      tax_kind: input.taxKind,
      item_name: input.itemName.trim(),
      original_supply: input.originalSupply,
      original_vat: input.originalVat,
      final_supply: input.finalSupply,
      final_vat: input.finalVat,
      reason: input.reason.trim(),
      status: 'draft',
      created_by: input.actor,
    })
    .select(COLUMNS)
    .single()
  if (error) throw new InvoiceOverrideError(`원단위 조정 저장 실패: ${error.message}`)
  return toRecord(data as unknown as Row)
}

export async function approveInvoiceOverride(id: string, actor: string): Promise<void> {
  const db = createAdminClient()
  const { error } = await db
    .from('settlement_invoice_overrides')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: actor })
    .eq('id', id)
    .eq('status', 'draft')
  if (error) throw new InvoiceOverrideError(`원단위 조정 승인 실패: ${error.message}`)
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

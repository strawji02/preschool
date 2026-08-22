import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ManualItemEvidence,
  ManualItemPayload,
  ManualItemRecord,
  ManualItemStatus,
  ManualItemTaxKind,
} from '../calc/manual-item'

const BUCKET = 'settlement-manual-evidence'

export class ManualItemError extends Error {}

interface Row {
  [key: string]: unknown
  id: string
  period: string
}

const COLUMNS = [
  'id', 'period', 'kind', 'status', 'source', 'business_code', 'business_name',
  'restaurant_code', 'restaurant_name', 'transaction_date', 'delivery_date',
  'product_name', 'invoice_item_name', 'specification', 'unit', 'quantity',
  'vendor_name', 'order_number', 'purchase_tax_kind', 'purchase_supply',
  'purchase_vat', 'purchase_exempt', 'purchase_total', 'charge_tax_kind',
  'charge_supply', 'charge_vat', 'charge_exempt', 'charge_total', 'burden',
  'partner_included', 'platform_fee_applies', 'invoice_mode', 'reason',
  'requested_by', 'duplicate_override_reason', 'created_by', 'created_at',
  'updated_by', 'updated_at', 'approved_by', 'approved_at', 'cancelled_by',
  'cancelled_at', 'cancel_reason',
].join(', ')

function amount(row: Row, prefix: 'purchase' | 'charge') {
  return {
    taxableSupply: Number(row[`${prefix}_supply`] ?? 0),
    vat: Number(row[`${prefix}_vat`] ?? 0),
    exempt: Number(row[`${prefix}_exempt`] ?? 0),
    total: Number(row[`${prefix}_total`] ?? 0),
  }
}

function toRecord(row: Row, evidence: ManualItemEvidence[] = []): ManualItemRecord {
  return {
    id: row.id,
    period: row.period,
    kind: row.kind as ManualItemRecord['kind'],
    status: row.status as ManualItemStatus,
    source: row.source as ManualItemRecord['source'],
    businessCode: String(row.business_code ?? ''),
    businessName: String(row.business_name ?? ''),
    restaurantCode: row.restaurant_code ? String(row.restaurant_code) : null,
    restaurantName: row.restaurant_name ? String(row.restaurant_name) : null,
    transactionDate: String(row.transaction_date ?? '').slice(0, 10),
    deliveryDate: row.delivery_date ? String(row.delivery_date).slice(0, 10) : null,
    productName: String(row.product_name ?? ''),
    invoiceItemName: String(row.invoice_item_name ?? ''),
    specification: String(row.specification ?? ''),
    unit: String(row.unit ?? ''),
    quantity: Number(row.quantity),
    vendorName: String(row.vendor_name ?? ''),
    orderNumber: row.order_number ? String(row.order_number) : null,
    purchaseTaxKind: row.purchase_tax_kind as ManualItemTaxKind,
    purchase: amount(row, 'purchase'),
    chargeTaxKind: row.charge_tax_kind as ManualItemTaxKind,
    charge: amount(row, 'charge'),
    burden: row.burden as ManualItemRecord['burden'],
    partnerIncluded: row.partner_included === true,
    platformFeeApplies: row.platform_fee_applies === true,
    invoiceMode: row.invoice_mode as ManualItemRecord['invoiceMode'],
    reason: String(row.reason ?? ''),
    requestedBy: String(row.requested_by ?? ''),
    duplicateOverrideReason: row.duplicate_override_reason
      ? String(row.duplicate_override_reason)
      : null,
    createdBy: String(row.created_by ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedBy: String(row.updated_by ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    cancelledBy: row.cancelled_by ? String(row.cancelled_by) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    evidence,
  }
}

function toColumns(input: ManualItemPayload, actor: string): Record<string, unknown> {
  return {
    period: input.period,
    kind: input.kind,
    source: input.source,
    business_code: input.businessCode,
    business_name: input.businessName,
    restaurant_code: input.restaurantCode,
    restaurant_name: input.restaurantName,
    transaction_date: input.transactionDate,
    delivery_date: input.deliveryDate,
    product_name: input.productName,
    invoice_item_name: input.invoiceItemName,
    specification: input.specification,
    unit: input.unit,
    quantity: input.quantity,
    vendor_name: input.vendorName,
    order_number: input.orderNumber,
    purchase_tax_kind: input.purchaseTaxKind,
    purchase_supply: input.purchase.taxableSupply,
    purchase_vat: input.purchase.vat,
    purchase_exempt: input.purchase.exempt,
    purchase_total: input.purchase.total,
    charge_tax_kind: input.chargeTaxKind,
    charge_supply: input.charge.taxableSupply,
    charge_vat: input.charge.vat,
    charge_exempt: input.charge.exempt,
    charge_total: input.charge.total,
    burden: input.burden,
    partner_included: input.partnerIncluded,
    platform_fee_applies: input.platformFeeApplies,
    invoice_mode: input.invoiceMode,
    reason: input.reason,
    requested_by: input.requestedBy,
    duplicate_override_reason: input.duplicateOverrideReason,
    updated_by: actor,
    updated_at: new Date().toISOString(),
  }
}

async function listEvidence(ids: string[]): Promise<Map<string, ManualItemEvidence[]>> {
  const out = new Map<string, ManualItemEvidence[]>()
  if (ids.length === 0) return out
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_manual_item_evidence')
    .select('id, manual_item_id, file_name, content_type, file_size, uploaded_by, uploaded_at')
    .in('manual_item_id', ids)
    .order('uploaded_at')
  if (error) throw new ManualItemError(`외부 사입 증빙 조회 실패: ${error.message}`)
  for (const row of data ?? []) {
    const itemId = String(row.manual_item_id)
    const list = out.get(itemId) ?? []
    list.push({
      id: String(row.id),
      fileName: String(row.file_name),
      contentType: String(row.content_type),
      fileSize: Number(row.file_size),
      uploadedBy: String(row.uploaded_by),
      uploadedAt: String(row.uploaded_at),
    })
    out.set(itemId, list)
  }
  return out
}

export async function listManualItems(period: string): Promise<ManualItemRecord[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_manual_items')
    .select(COLUMNS)
    .eq('period', period)
    .order('transaction_date')
    .order('created_at')
  if (error) throw new ManualItemError(`외부 사입 조회 실패: ${error.message}`)
  const rows = (data ?? []) as unknown as Row[]
  const evidence = await listEvidence(rows.map((r) => r.id))
  return rows.map((r) => toRecord(r, evidence.get(r.id) ?? []))
}

export async function getManualItem(id: string): Promise<ManualItemRecord | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_manual_items')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ManualItemError(`외부 사입 조회 실패: ${error.message}`)
  if (!data) return null
  const row = data as unknown as Row
  const evidence = await listEvidence([id])
  return toRecord(row, evidence.get(id) ?? [])
}

export async function findManualItemDuplicates(
  input: ManualItemPayload,
  excludeId?: string
): Promise<ManualItemRecord[]> {
  const db = createAdminClient()
  let query = db
    .from('settlement_manual_items')
    .select(COLUMNS)
    .eq('period', input.period)
    .eq('source', input.source)
    .eq('business_code', input.businessCode)
    .eq('transaction_date', input.transactionDate)
    .eq('product_name', input.productName)
    .eq('purchase_total', input.purchase.total)
    .neq('status', 'cancelled')
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query
  if (error) throw new ManualItemError(`중복 확인 실패: ${error.message}`)
  return ((data ?? []) as unknown as Row[])
    .map((r) => toRecord(r))
    .filter((row) =>
      !input.orderNumber || !row.orderNumber || row.orderNumber === input.orderNumber
    )
}

export async function createManualItem(
  input: ManualItemPayload,
  actor: string
): Promise<ManualItemRecord> {
  const db = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('settlement_manual_items')
    .insert({ ...toColumns(input, actor), status: 'draft', created_by: actor, created_at: now })
    .select(COLUMNS)
    .single()
  if (error) throw new ManualItemError(`외부 사입 저장 실패: ${error.message}`)
  return toRecord(data as unknown as Row)
}

export async function updateManualItem(
  id: string,
  input: ManualItemPayload,
  actor: string
): Promise<ManualItemRecord> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_manual_items')
    .update({
      ...toColumns(input, actor),
      status: 'draft',
      approved_by: null,
      approved_at: null,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
    })
    .eq('id', id)
    .neq('status', 'cancelled')
    .select(COLUMNS)
    .single()
  if (error) throw new ManualItemError(`외부 사입 수정 실패: ${error.message}`)
  return toRecord(data as unknown as Row)
}

export async function approveManualItem(id: string, actor: string): Promise<ManualItemRecord> {
  const db = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('settlement_manual_items')
    .update({
      status: 'approved', approved_by: actor, approved_at: now, updated_by: actor, updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'draft')
    .select(COLUMNS)
    .single()
  if (error) throw new ManualItemError(`외부 사입 승인 실패: ${error.message}`)
  return toRecord(data as unknown as Row)
}

export async function cancelManualItem(
  id: string,
  reason: string,
  actor: string
): Promise<ManualItemRecord> {
  const db = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('settlement_manual_items')
    .update({
      status: 'cancelled', cancelled_by: actor, cancelled_at: now, cancel_reason: reason,
      updated_by: actor, updated_at: now,
    })
    .eq('id', id)
    .neq('status', 'cancelled')
    .select(COLUMNS)
    .single()
  if (error) throw new ManualItemError(`외부 사입 취소 실패: ${error.message}`)
  return toRecord(data as unknown as Row)
}

export async function addManualItemEvidence(input: {
  itemId: string
  period: string
  fileName: string
  contentType: string
  bytes: Uint8Array
  actor: string
}): Promise<ManualItemEvidence> {
  const db = createAdminClient()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // 같은 요청에서 여러 파일을 순차 업로드해도 밀리초가 같을 수 있다.
  const path = `${input.period}/${input.itemId}/${stamp}-${crypto.randomUUID()}`
  const upload = await db.storage.from(BUCKET).upload(path, input.bytes as unknown as ArrayBuffer, {
    contentType: input.contentType,
    upsert: false,
  })
  if (upload.error) throw new ManualItemError(`증빙 파일 보관 실패: ${upload.error.message}`)

  const { data, error } = await db
    .from('settlement_manual_item_evidence')
    .insert({
      manual_item_id: input.itemId,
      file_name: input.fileName,
      storage_path: path,
      content_type: input.contentType,
      file_size: input.bytes.byteLength,
      uploaded_by: input.actor,
    })
    .select('id, file_name, content_type, file_size, uploaded_by, uploaded_at')
    .single()
  if (error) {
    await db.storage.from(BUCKET).remove([path])
    throw new ManualItemError(`증빙 기록 실패: ${error.message}`)
  }
  return {
    id: String(data.id),
    fileName: String(data.file_name),
    contentType: String(data.content_type),
    fileSize: Number(data.file_size),
    uploadedBy: String(data.uploaded_by),
    uploadedAt: String(data.uploaded_at),
  }
}

export async function downloadManualItemEvidence(id: string): Promise<{
  fileName: string
  contentType: string
  bytes: Uint8Array
} | null> {
  const db = createAdminClient()
  const { data: row, error } = await db
    .from('settlement_manual_item_evidence')
    .select('file_name, storage_path, content_type')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ManualItemError(`증빙 조회 실패: ${error.message}`)
  if (!row) return null
  const file = await db.storage.from(BUCKET).download(String(row.storage_path))
  if (file.error || !file.data) {
    throw new ManualItemError(`증빙 파일 조회 실패: ${file.error?.message ?? '파일 없음'}`)
  }
  return {
    fileName: String(row.file_name),
    contentType: String(row.content_type),
    bytes: new Uint8Array(await file.data.arrayBuffer()),
  }
}

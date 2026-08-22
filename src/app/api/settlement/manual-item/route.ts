import { NextResponse, type NextRequest } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import {
  ManualItemError,
  approveManualItem,
  calculateTaxBreakdown,
  cancelManualItem,
  createManualItem,
  findManualItemDuplicates,
  getManualItem,
  isValidPeriod,
  listManualItems,
  loadClosing,
  loadSettlementMaster,
  updateManualItem,
  validateManualItem,
  type ManualItemBurden,
  type ManualItemKind,
  type ManualItemPayload,
  type ManualItemRecord,
  type ManualItemTaxKind,
  type TaxBreakdown,
} from '@/features/settlement'

async function assertOpen(period: string): Promise<string | null> {
  const closing = await loadClosing(period)
  return closing?.status === 'closed'
    ? `${period}은 마감된 달입니다. 외부 사입을 변경하려면 먼저 마감을 해제해 주세요.`
    : null
}

function text(body: Record<string, unknown>, key: string): string {
  return typeof body[key] === 'string' ? body[key].trim() : ''
}

function nullableText(body: Record<string, unknown>, key: string): string | null {
  return text(body, key) || null
}

function integer(body: Record<string, unknown>, key: string): number {
  const n = Number(body[key] ?? 0)
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN
}

function taxKind(value: unknown): ManualItemTaxKind {
  return value === 'exempt' ? 'exempt' : 'taxable'
}

function breakdown(
  body: Record<string, unknown>,
  prefix: 'purchase' | 'charge',
  kind: ManualItemTaxKind
): TaxBreakdown {
  const total = integer(body, `${prefix}Total`)
  const explicit = [`${prefix}Supply`, `${prefix}Vat`, `${prefix}Exempt`].some(
    (key) => body[key] !== undefined && body[key] !== ''
  )
  if (!explicit) return calculateTaxBreakdown(total, kind)
  return {
    taxableSupply: integer(body, `${prefix}Supply`),
    vat: integer(body, `${prefix}Vat`),
    exempt: integer(body, `${prefix}Exempt`),
    total,
  }
}

function burdenFor(kind: ManualItemKind, value: unknown): ManualItemBurden {
  if (value === 'venue' || value === 'partner' || value === 'hq') return value
  if (kind === 'partner_service') return 'partner'
  if (kind === 'hq_service') return 'hq'
  return 'venue'
}

function selectionErrors(body: Record<string, unknown>): string[] {
  const errors: string[] = []
  if (!['billable', 'partner_service', 'hq_service', 'custom'].includes(String(body.kind))) {
    errors.push('외부 사입 유형을 선택해 주세요.')
  }
  if (body.source !== 'shinsegae' && body.source !== 'cj') {
    errors.push('유치원 원천을 선택해 주세요.')
  }
  if (body.purchaseTaxKind !== 'taxable' && body.purchaseTaxKind !== 'exempt') {
    errors.push('매입 과세·면세 구분을 선택해 주세요.')
  }
  const kind = String(body.kind)
  const burden = burdenFor(
    ['partner_service', 'hq_service', 'custom'].includes(kind)
      ? kind as ManualItemKind
      : 'billable',
    body.burden
  )
  if (kind === 'custom' && !['venue', 'partner', 'hq'].includes(String(body.burden))) {
    errors.push('기타 항목의 부담 주체를 선택해 주세요.')
  }
  if (burden === 'venue' && body.chargeTaxKind !== 'taxable' && body.chargeTaxKind !== 'exempt') {
    errors.push('청구 과세·면세 구분을 선택해 주세요.')
  }
  return errors
}

function payloadFrom(body: Record<string, unknown>): ManualItemPayload {
  const kind: ManualItemKind =
    body.kind === 'partner_service' || body.kind === 'hq_service' || body.kind === 'custom'
      ? body.kind
      : 'billable'
  const burden = burdenFor(kind, body.burden)
  const purchaseTaxKind = taxKind(body.purchaseTaxKind)
  const chargeTaxKind = taxKind(body.chargeTaxKind)
  return {
    period: text(body, 'period'),
    kind,
    source: body.source === 'shinsegae' ? 'shinsegae' : 'cj',
    businessCode: text(body, 'businessCode'),
    businessName: text(body, 'businessName'),
    restaurantCode: nullableText(body, 'restaurantCode'),
    restaurantName: nullableText(body, 'restaurantName'),
    transactionDate: text(body, 'transactionDate'),
    deliveryDate: nullableText(body, 'deliveryDate'),
    productName: text(body, 'productName'),
    invoiceItemName: text(body, 'invoiceItemName'),
    specification: text(body, 'specification'),
    unit: text(body, 'unit'),
    quantity: Number(body.quantity),
    vendorName: text(body, 'vendorName'),
    orderNumber: nullableText(body, 'orderNumber'),
    purchaseTaxKind,
    purchase: breakdown(body, 'purchase', purchaseTaxKind),
    chargeTaxKind,
    charge: breakdown(body, 'charge', chargeTaxKind),
    burden,
    partnerIncluded: burden === 'venue' && body.partnerIncluded !== false,
    platformFeeApplies: burden === 'venue' && body.platformFeeApplies !== false,
    invoiceMode: body.invoiceMode === 'merge' ? 'merge' : 'separate',
    reason: text(body, 'reason'),
    requestedBy: text(body, 'requestedBy'),
    duplicateOverrideReason: nullableText(body, 'duplicateOverrideReason'),
  }
}

function validationRecord(payload: ManualItemPayload): ManualItemRecord {
  return {
    ...payload,
    id: 'validation',
    status: 'draft',
    createdBy: '',
    createdAt: '',
    updatedBy: '',
    updatedAt: '',
    approvedBy: null,
    approvedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    evidence: [],
  }
}

async function canonicalVenue(payload: ManualItemPayload): Promise<ManualItemPayload> {
  const master = await loadSettlementMaster()
  const venue = master.venues.find(
    (row) => row.source === payload.source && row.businessCode === payload.businessCode
  )
  if (!venue) {
    throw new ManualItemError('유치원 마스터에서 대상 코드를 찾지 못했습니다.')
  }
  return { ...payload, businessName: venue.businessName }
}

async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const period = request.nextUrl.searchParams.get('period') ?? ''
  if (!isValidPeriod(period)) {
    return NextResponse.json({ success: false, error: '정산월을 확인해 주세요.' }, { status: 400 })
  }
  try {
    return NextResponse.json({ success: true, items: await listManualItems(period) })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const body = await readBody(request)
  if (!body) {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const selections = selectionErrors(body)
  if (selections.length > 0) {
    return NextResponse.json(
      { success: false, error: selections.join(' / '), problems: selections },
      { status: 400 }
    )
  }
  let payload = payloadFrom(body)
  const errors = validateManualItem(validationRecord(payload))
  if (errors.length > 0) {
    return NextResponse.json({ success: false, error: errors.join(' / '), problems: errors }, { status: 400 })
  }
  try {
    const blocked = await assertOpen(payload.period)
    if (blocked) return NextResponse.json({ success: false, error: blocked }, { status: 409 })
    payload = await canonicalVenue(payload)
    const duplicates = await findManualItemDuplicates(payload)
    if (duplicates.length > 0 && !payload.duplicateOverrideReason) {
      return NextResponse.json(
        {
          success: false,
          code: 'DUPLICATE',
          error: '같은 유치원·거래일·품목·매입금액의 외부 사입이 있습니다. 중복 저장 사유를 입력해 주세요.',
          duplicates: duplicates.map((d) => ({ id: d.id, productName: d.productName, purchaseTotal: d.purchase.total })),
        },
        { status: 409 }
      )
    }
    const item = await createManualItem(payload, guard.user.email)
    return NextResponse.json({ success: true, item })
  } catch (err) {
    const message = err instanceof ManualItemError || err instanceof Error ? err.message : '저장 실패'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response
  const body = await readBody(request)
  if (!body) {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  const id = text(body, 'id')
  const action = text(body, 'action')
  if (!id) return NextResponse.json({ success: false, error: '대상을 지정해 주세요.' }, { status: 400 })

  try {
    const current = await getManualItem(id)
    if (!current) return NextResponse.json({ success: false, error: '외부 사입을 찾지 못했습니다.' }, { status: 404 })
    const blocked = await assertOpen(current.period)
    if (blocked) return NextResponse.json({ success: false, error: blocked }, { status: 409 })

    if (action === 'approve') {
      if (guard.user.role !== 'admin') {
        return NextResponse.json({ success: false, error: '관리자만 승인할 수 있습니다.' }, { status: 403 })
      }
      const errors = validateManualItem(current)
      if (errors.length > 0) {
        return NextResponse.json({ success: false, error: errors.join(' / ') }, { status: 400 })
      }
      return NextResponse.json({ success: true, item: await approveManualItem(id, guard.user.email) })
    }

    if (action === 'cancel') {
      const reason = text(body, 'cancelReason')
      if (!reason) return NextResponse.json({ success: false, error: '취소 사유를 입력해 주세요.' }, { status: 400 })
      if (current.status === 'approved' && guard.user.role !== 'admin') {
        return NextResponse.json({ success: false, error: '승인된 건은 관리자만 취소할 수 있습니다.' }, { status: 403 })
      }
      return NextResponse.json({ success: true, item: await cancelManualItem(id, reason, guard.user.email) })
    }

    if (action !== 'update') {
      return NextResponse.json({ success: false, error: '동작이 올바르지 않습니다.' }, { status: 400 })
    }
    const selections = selectionErrors(body)
    if (selections.length > 0) {
      return NextResponse.json(
        { success: false, error: selections.join(' / '), problems: selections },
        { status: 400 }
      )
    }
    let payload = payloadFrom(body)
    if (payload.period !== current.period) {
      return NextResponse.json(
        { success: false, error: '기존 외부 사입의 정산월은 변경할 수 없습니다. 다른 월에 새로 등록해 주세요.' },
        { status: 409 }
      )
    }
    payload = await canonicalVenue(payload)
    const errors = validateManualItem(validationRecord(payload))
    if (errors.length > 0) {
      return NextResponse.json({ success: false, error: errors.join(' / ') }, { status: 400 })
    }
    const duplicates = await findManualItemDuplicates(payload, id)
    if (duplicates.length > 0 && !payload.duplicateOverrideReason) {
      return NextResponse.json({ success: false, code: 'DUPLICATE', error: '중복 가능성이 있습니다. 저장 사유를 입력해 주세요.' }, { status: 409 })
    }
    return NextResponse.json({ success: true, item: await updateManualItem(id, payload, guard.user.email) })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 }
    )
  }
}

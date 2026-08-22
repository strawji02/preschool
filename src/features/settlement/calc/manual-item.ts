import type {
  NormalizedVenue,
  PartnerMapping,
  SettlementSource,
  TaxBreakdown,
} from '../parse/types'
import { venueMappingKey } from '../parse/types'

/** 외부 사입·임의 청구 종류. 각 종류는 부담 주체의 기본값을 가진다. */
export type ManualItemKind = 'billable' | 'partner_service' | 'hq_service' | 'custom'
export type ManualItemStatus = 'draft' | 'approved' | 'cancelled'
export type ManualItemBurden = 'venue' | 'partner' | 'hq'
export type ManualItemTaxKind = 'taxable' | 'exempt'
export type ManualItemInvoiceMode = 'merge' | 'separate'

export interface ManualItemEvidence {
  id: string
  fileName: string
  contentType: string
  fileSize: number
  uploadedBy: string
  uploadedAt: string
}

/**
 * 외부 사입 한 건의 저장·스냅샷 형태.
 *
 * 매입과 청구를 `TaxBreakdown`으로 각각 보존하는 이유는 정산식의 원가세액과
 * 홈택스의 매출세액을 둘 다 원단위로 재현해야 하기 때문이다.
 */
export interface ManualItemRecord {
  id: string
  period: string
  kind: ManualItemKind
  status: ManualItemStatus
  source: SettlementSource
  businessCode: string
  businessName: string
  restaurantCode: string | null
  restaurantName: string | null
  transactionDate: string
  deliveryDate: string | null
  productName: string
  invoiceItemName: string
  specification: string
  unit: string
  quantity: number
  vendorName: string
  orderNumber: string | null
  purchaseTaxKind: ManualItemTaxKind
  purchase: TaxBreakdown
  chargeTaxKind: ManualItemTaxKind
  charge: TaxBreakdown
  burden: ManualItemBurden
  partnerIncluded: boolean
  platformFeeApplies: boolean
  invoiceMode: ManualItemInvoiceMode
  reason: string
  requestedBy: string
  duplicateOverrideReason: string | null
  createdBy: string
  createdAt: string
  updatedBy: string
  updatedAt: string
  approvedBy: string | null
  approvedAt: string | null
  cancelledBy: string | null
  cancelledAt: string | null
  cancelReason: string | null
  evidence: ManualItemEvidence[]
}

export type ManualItemPayload = Pick<
  ManualItemRecord,
  | 'period'
  | 'kind'
  | 'source'
  | 'businessCode'
  | 'businessName'
  | 'restaurantCode'
  | 'restaurantName'
  | 'transactionDate'
  | 'deliveryDate'
  | 'productName'
  | 'invoiceItemName'
  | 'specification'
  | 'unit'
  | 'quantity'
  | 'vendorName'
  | 'orderNumber'
  | 'purchaseTaxKind'
  | 'purchase'
  | 'chargeTaxKind'
  | 'charge'
  | 'burden'
  | 'partnerIncluded'
  | 'platformFeeApplies'
  | 'invoiceMode'
  | 'reason'
  | 'requestedBy'
  | 'duplicateOverrideReason'
>

/** DB/API 생성 입력. 감사·승인 필드는 서버가 채운다. */
export type CreateManualItemInput = Omit<
  ManualItemRecord,
  | 'id'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'approvedBy'
  | 'approvedAt'
  | 'cancelledBy'
  | 'cancelledAt'
  | 'cancelReason'
  | 'evidence'
> & {
  status?: Extract<ManualItemStatus, 'draft' | 'approved'>
}

/** 화면의 총액 자동분해 기본값. 사용자는 영수증에 맞게 공급가·세액을 수정할 수 있다. */
export function calculateTaxBreakdown(
  total: number,
  kind: ManualItemTaxKind
): TaxBreakdown {
  const safe = Number.isFinite(total) ? Math.trunc(total) : 0
  if (kind === 'exempt') {
    return { taxableSupply: 0, vat: 0, exempt: safe, total: safe }
  }
  const taxableSupply = Math.round(safe / 1.1)
  const vat = safe - taxableSupply
  return { taxableSupply, vat, exempt: 0, total: safe }
}

/**
 * 매입 총액과 목표 마진율로 청구 총액을 계산한다.
 *
 * 정산 보고서의 마진율 정의가 `(청구가 - 원가) / 청구가`이므로 같은 기준을 쓴다.
 * 화면이 추천값을 채우는 보조 함수이며, 계산 후 사용자가 최종 청구액을 수정할 수 있다.
 */
export function calculateChargeTotal(purchaseTotal: number, marginPercent: number): number {
  if (
    !Number.isFinite(purchaseTotal) ||
    !Number.isFinite(marginPercent) ||
    purchaseTotal <= 0 ||
    marginPercent < 0 ||
    marginPercent >= 100
  ) {
    return 0
  }
  return Math.ceil(purchaseTotal / (1 - marginPercent / 100))
}

function validateBreakdown(
  label: string,
  kind: ManualItemTaxKind,
  value: TaxBreakdown
): string[] {
  const errors: string[] = []
  if (
    ![value.taxableSupply, value.vat, value.exempt, value.total].every(
      (n) => Number.isFinite(n) && Number.isInteger(n) && n >= 0
    )
  ) {
    errors.push(`${label} 금액은 0 이상의 원 단위 정수여야 합니다.`)
    return errors
  }
  if (value.taxableSupply + value.vat + value.exempt !== value.total) {
    errors.push(`${label} 금액 합계가 공급가·부가세·면세의 합과 다릅니다.`)
  }
  if (kind === 'taxable' && value.exempt !== 0) {
    errors.push(`${label} 과세구분이 과세인데 면세 금액이 들어 있습니다.`)
  }
  if (kind === 'exempt' && (value.taxableSupply !== 0 || value.vat !== 0)) {
    errors.push(`${label} 과세구분이 면세인데 과세 공급가 또는 부가세가 들어 있습니다.`)
  }
  return errors
}

export function validateManualItem(item: ManualItemRecord): string[] {
  const errors = [
    ...validateBreakdown('매입', item.purchaseTaxKind, item.purchase),
    ...validateBreakdown('청구', item.chargeTaxKind, item.charge),
  ]
  const period = /^(\d{4})-(\d{2})$/.exec(item.period)
  if (!period || Number(period[2]) < 1 || Number(period[2]) > 12) {
    errors.push('정산월이 올바르지 않습니다.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.transactionDate)) {
    errors.push('거래일이 올바르지 않습니다.')
  }
  if (!item.businessCode.trim() || !item.businessName.trim()) {
    errors.push('유치원을 선택해 주세요.')
  }
  if (!item.productName.trim() || !item.invoiceItemName.trim()) {
    errors.push('품목명과 계산서 품목명을 입력해 주세요.')
  }
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    errors.push('수량은 0보다 커야 합니다.')
  }
  if (!item.reason.trim() || !item.requestedBy.trim()) {
    errors.push('입력 사유와 요청자를 입력해 주세요.')
  }
  if (item.burden === 'venue' && item.charge.total <= 0) {
    errors.push('유치원 청구 건은 청구 금액이 0보다 커야 합니다.')
  }
  if (item.burden !== 'venue' && item.partnerIncluded) {
    errors.push('서비스 비용은 유치원 매출과 파트너 마진에 직접 포함할 수 없습니다.')
  }
  return errors
}

export interface ManualNormalizedVenue extends NormalizedVenue {
  manualItemId?: string
  manualBurden?: ManualItemBurden
  manualPartnerIncluded?: boolean
}

export interface ApplyManualItemsResult {
  /** 회사 재무·마감용. 승인된 모든 외부 사입 원가와 유치원 청구를 포함한다. */
  financialVenues: ManualNormalizedVenue[]
  /** 파트너 산식용. `partnerIncluded`인 유치원 청구 건만 포함한다. */
  settlementVenues: ManualNormalizedVenue[]
  /** 홈택스·유치원 청구에 들어갈 승인된 유치원 부담 품목. */
  invoiceItems: ManualItemRecord[]
  /** 파트너 부담 서비스가 사업자공제 Q에 추가하는 금액. */
  partnerDeductions: Record<string, number>
  /** 적립금 미적용 외부 사입의 매입 공급가(면세 포함). */
  platformFeeExcludedBase: Record<string, number>
  applied: ManualItemRecord[]
  errors: string[]
}

function cloneVenue(v: NormalizedVenue): ManualNormalizedVenue {
  return { ...v, cost: { ...v.cost }, price: { ...v.price } }
}

function zeroBreakdown(): TaxBreakdown {
  return { taxableSupply: 0, vat: 0, exempt: 0, total: 0 }
}

function manualVenue(item: ManualItemRecord): ManualNormalizedVenue {
  return {
    source: item.source,
    businessCode: item.businessCode,
    businessName: item.businessName,
    restaurantCode: `manual:${item.id}`,
    restaurantName: `외부사입 · ${item.productName}`,
    cost: { ...item.purchase },
    price: item.burden === 'venue' ? { ...item.charge } : zeroBreakdown(),
    manualItemId: item.id,
    manualBurden: item.burden,
    manualPartnerIncluded: item.partnerIncluded,
  }
}

/**
 * 원천 교차검증이 끝난 뒤 외부 사입을 얹는다.
 *
 * 오류가 하나라도 있으면 기존 조정과 같은 원칙으로 **아무것도 반영하지 않는다.**
 * 일부만 반영된 숫자는 마감 담당자가 맞는지 판단할 수 없기 때문이다.
 */
export function applyManualItems(
  venues: readonly NormalizedVenue[],
  items: readonly ManualItemRecord[],
  mapping: PartnerMapping
): ApplyManualItemsResult {
  const asIs = venues.map(cloneVenue)
  const approved = items.filter((i) => i.status === 'approved')
  const errors: string[] = []
  const knownBusinesses = new Set(venues.map((v) => venueMappingKey(v.source, v.businessCode)))

  for (const item of approved) {
    errors.push(...validateManualItem(item).map((e) => `${item.productName}: ${e}`))
    const key = venueMappingKey(item.source, item.businessCode)
    if (!knownBusinesses.has(key)) {
      errors.push(`${item.productName}: 원천 자료에서 대상 유치원을 찾지 못했습니다.`)
    }
    if (mapping[key] === undefined) {
      errors.push(`${item.productName}: 대상 유치원의 담당 파트너가 지정되지 않았습니다.`)
    } else if (mapping[key] === null && item.burden !== 'hq') {
      errors.push(
        `${item.productName}: 정산제외 사업장에는 유치원 청구 또는 파트너 부담 항목을 연결할 수 없습니다.`
      )
    }
  }

  if (errors.length > 0) {
    return {
      financialVenues: asIs,
      settlementVenues: venues.map(cloneVenue),
      invoiceItems: [],
      partnerDeductions: {},
      platformFeeExcludedBase: {},
      applied: [],
      errors,
    }
  }

  const financialVenues = venues.map(cloneVenue)
  const settlementVenues = venues.map(cloneVenue)
  const invoiceItems: ManualItemRecord[] = []
  const partnerDeductions: Record<string, number> = {}
  const platformFeeExcludedBase: Record<string, number> = {}

  for (const item of approved) {
    const row = manualVenue(item)
    financialVenues.push(row)
    const partnerId = mapping[venueMappingKey(item.source, item.businessCode)]

    if (item.burden === 'venue') {
      invoiceItems.push(item)
      if (item.partnerIncluded && partnerId) {
        settlementVenues.push(cloneVenue(row))
        if (!item.platformFeeApplies) {
          platformFeeExcludedBase[partnerId] =
            (platformFeeExcludedBase[partnerId] ?? 0) +
            (item.purchase.total - item.purchase.vat)
        }
      }
    } else if (item.burden === 'partner' && partnerId) {
      const amount = item.charge.total > 0 ? item.charge.total : item.purchase.total
      partnerDeductions[partnerId] = (partnerDeductions[partnerId] ?? 0) + amount
    }
  }

  return {
    financialVenues,
    settlementVenues,
    invoiceItems,
    partnerDeductions,
    platformFeeExcludedBase,
    applied: approved,
    errors: [],
  }
}

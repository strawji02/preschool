import type { ManualItemRecord } from '../calc/manual-item'

export interface ManualItemSheet {
  rows: unknown[][]
}

/** 관리자 통합 내역서용 외부 사입 근거 시트. 실제 반영된 승인 건만 싣는다. */
export function buildManualItemSheet(
  items: readonly ManualItemRecord[]
): ManualItemSheet | null {
  const approved = items.filter((i) => i.status === 'approved')
  if (approved.length === 0) return null
  const rows: unknown[][] = [[
    '유치원', '거래일', '납품일', '구분', '품목', '규격', '수량', '단위', '매입처',
    '주문번호', '매입 공급가', '매입 세액', '매입 면세', '매입 합계',
    '청구 공급가', '청구 세액', '청구 면세', '청구 합계', '부담 주체',
    '파트너 정산', '적립금', '계산서 품목', '사유', '요청자', '증빙 수',
  ]]
  for (const item of approved) {
    rows.push([
      item.businessName,
      item.transactionDate,
      item.deliveryDate,
      item.kind,
      item.productName,
      item.specification,
      item.quantity,
      item.unit,
      item.vendorName,
      item.orderNumber,
      item.purchase.taxableSupply,
      item.purchase.vat,
      item.purchase.exempt,
      item.purchase.total,
      item.charge.taxableSupply,
      item.charge.vat,
      item.charge.exempt,
      item.charge.total,
      item.burden,
      item.partnerIncluded ? '포함' : '제외',
      item.platformFeeApplies ? '적용' : '미적용',
      item.invoiceItemName,
      item.reason,
      item.requestedBy,
      item.evidence.length,
    ])
  }
  return { rows }
}

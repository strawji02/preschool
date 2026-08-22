import * as XLSX from 'xlsx'
import type { AdjustmentRecord } from '../data/adjustment'
import type { DeductionItem } from '../calc/deduction'
import type { ClosingPartnerRow, ClosingStatus, ClosingVenueRow } from '../calc/closing'
import type { ManualItemRecord } from '../calc/manual-item'

export interface BuildPartnerSettlementWorkbookInput {
  period: string
  status: ClosingStatus
  partner: ClosingPartnerRow
  venues: readonly ClosingVenueRow[]
  deductionItems: readonly DeductionItem[]
  adjustments: readonly AdjustmentRecord[]
  adjustmentAmounts: Readonly<Record<string, number>>
  manualItems: readonly ManualItemRecord[]
}

const MONEY = '#,##0'

function appendSheet(wb: XLSX.WorkBook, name: string, rows: unknown[][], widths: number[]) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = widths.map((wch) => ({ wch }))
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (cell?.t === 'n') cell.z = MONEY
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, name)
}

function statusLabel(status: ClosingStatus): string {
  if (status === 'closed') return '최종'
  if (status === 'confirmed') return '확정 전 검토용'
  return '작성중'
}

/** 파트너 한 명에게만 배포하는 독립 워크북. 다른 파트너 데이터는 입력부터 받지 않는다. */
export function buildPartnerSettlementWorkbook(
  input: BuildPartnerSettlementWorkbookInput
): XLSX.WorkBook {
  const { partner } = input
  const ownVenues = input.venues.filter(
    (v) => !v.isExcluded && v.partnerId === partner.partnerId
  )
  const ownKeys = new Set(ownVenues.map((v) => `${v.source}:${v.businessCode}`))
  const ownNames = new Set(ownVenues.map((v) => `${v.businessName}\0${v.restaurantName}`))
  const ownAdjustments = input.adjustments.filter((a) =>
    ownNames.has(`${a.businessName}\0${a.restaurantName}`)
  )
  const ownManual = input.manualItems.filter(
    (m) => m.status === 'approved' && ownKeys.has(`${m.source}:${m.businessCode}`)
  )

  const wb = XLSX.utils.book_new()
  appendSheet(
    wb,
    '정산 요약',
    [
      ['파트너 정산서', undefined],
      ['정산월', input.period],
      ['상태', statusLabel(input.status)],
      ['파트너', partner.partnerName],
      [],
      ['항목', '금액'],
      ['원가 합계', partner.costTotal],
      ['유치원 청구 합계', partner.priceTotal],
      ['차액·마진', partner.margin],
      ['적립금', partner.platformFee],
      ['부가세차액', partner.vatDiff],
      ['사업자공제', partner.businessDeduction],
      ['지급액(세전)', partner.preTax],
      ['소득세', partner.incomeTax],
      ['지방소득세', partner.localTax],
      ['실지급액', partner.netPay],
      ['사업소득 신고액', partner.declared],
    ],
    [24, 20]
  )

  const detailRows: unknown[][] = [[
    '유치원', '구분', '원가 공급가', '원가 세액', '원가 면세', '원가 합계',
    '청구 공급가', '청구 세액', '청구 면세', '청구 합계', '차액·마진',
  ]]
  for (const v of ownVenues) {
    detailRows.push([
      v.companyName ?? v.businessName,
      v.restaurantName,
      v.cost.taxableSupply,
      v.cost.vat,
      v.cost.exempt,
      v.cost.total,
      v.price.taxableSupply,
      v.price.vat,
      v.price.exempt,
      v.price.total,
      v.price.total - v.cost.total,
    ])
  }
  detailRows.push([
    '합계', undefined, undefined, partner.costVat, undefined, partner.costTotal,
    undefined, partner.priceVat, undefined, partner.priceTotal, partner.margin,
  ])
  appendSheet(wb, '유치원별 상세', detailRows, [20, 32, ...new Array(9).fill(14)])

  const evidenceRows: unknown[][] = [['[사업자공제]']]
  evidenceRows.push(['항목', '금액', '비고'])
  for (const d of input.deductionItems) evidenceRows.push([d.category, d.amount, d.note])
  if (input.deductionItems.length === 0) evidenceRows.push(['없음'])

  evidenceRows.push([], ['[품목 조정]'])
  evidenceRows.push(['유치원', '식당', '일자', '품목', '수량', '금액', '사유', '요청자'])
  for (const a of ownAdjustments) {
    evidenceRows.push([
      a.businessName, a.restaurantName, a.itemDate, a.productName, a.quantity,
      input.adjustmentAmounts[a.id] ?? 0, a.reason, a.requestedBy,
    ])
  }
  if (ownAdjustments.length === 0) evidenceRows.push(['없음'])

  evidenceRows.push([], ['[외부 사입·임의 청구]'])
  evidenceRows.push([
    '유치원', '거래일', '품목', '수량', '단위', '매입처', '매입가', '청구가',
    '파트너 정산', '적립금', '부담 주체', '사유',
  ])
  for (const m of ownManual) {
    evidenceRows.push([
      m.businessName,
      m.transactionDate,
      m.productName,
      m.quantity,
      m.unit,
      m.vendorName,
      m.purchase.total,
      m.charge.total,
      m.partnerIncluded ? '포함' : '제외',
      m.platformFeeApplies ? '적용' : '미적용',
      m.burden === 'venue' ? '유치원' : m.burden === 'partner' ? '파트너' : '본사',
      m.reason,
    ])
  }
  if (ownManual.length === 0) evidenceRows.push(['없음'])
  appendSheet(wb, '공제·조정·외부사입', evidenceRows, [20, 14, 26, 10, 10, 16, 14, 14, 12, 12, 12, 30])

  return wb
}

function safeFilePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '파트너'
}

export function partnerReportFileName(
  period: string,
  partnerName: string,
  status: ClosingStatus
): string {
  return `${safeFilePart(period)}_${safeFilePart(partnerName)}_파트너정산서_${statusLabel(status)}.xlsx`
}

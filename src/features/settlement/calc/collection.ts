import type { ClosingPartnerRow, ClosingVenueRow } from './closing'
import type { SettlementSource } from '../parse/types'

/**
 * 수금·지급 관리 (docs/systems/settlement.md §9, §13-3).
 *
 * 발생(청구)과 현금(수금)을 잇는다. 보고서의 "장부상 이익은 났는데 통장에 없다"를
 * 설명하는 쪽이 이것이다.
 *
 * ```
 * 미수금 = 청구합계 − 수금액
 * 미지급 = 실지급액 − 지급완료액
 * 담당 유치원 전원 입금 완료 → 지급 요청 알림
 * ```
 *
 * 청구액·실지급액은 **마감 스냅샷**에서 온다. 입금·지급 기록만 수기 입력이다.
 * 순수 함수라 테스트로 고정할 수 있다.
 */

/** 유치원 입금 기록 (docs §9 — 입금일자 수기 입력) */
export interface ReceiptRecord {
  source: SettlementSource
  businessCode: string
  /** `YYYY-MM-DD` */
  receivedDate: string
  /**
   * 입금액. §9는 "입금일자만 입력"이지만 부분 입금이 실제로 생기므로 금액을 받는다.
   * 화면에서는 청구액을 기본값으로 넣어 한 번에 처리할 수 있게 한다.
   */
  amount: number
  note: string | null
}

export interface ReceiptAdjustmentRecord {
  source: SettlementSource
  businessCode: string
  /** 양수면 미수금을 줄이고, 음수면 다시 받을 금액을 늘린다. */
  amount: number
  reason: string
  status: 'draft' | 'approved' | 'cancelled'
}

/** 영업자 지급 기록 */
export interface PayoutRecord {
  partnerId: string
  /** `YYYY-MM-DD` */
  paidDate: string
  amount: number
  note: string | null
}

export interface CollectionRow {
  source: SettlementSource
  businessCode: string
  /** 계산서 상호가 있으면 그걸, 없으면 원천 사업장명 */
  label: string
  partnerId: string | null
  partnerName: string | null
  /** 청구액 (마감 스냅샷의 단가합계) */
  billed: number
  received: number
  /** 승인된 수금 차이 조정. 청구 원금과 실제 입금액은 바꾸지 않는다. */
  adjusted: number
  /** 청구 − 수금. **음수를 0으로 만들지 않는다** — 초과 입금을 못 찾게 된다 */
  outstanding: number
  /** 마지막 입금일. 완납 시점이 궁금한 값이다 */
  receivedDate: string | null
  isFullyReceived: boolean
  receiptCount: number
}

export interface PartnerCollection {
  partnerId: string
  partnerName: string
  /** 담당 유치원 수 (이번 달 청구 대상) */
  venueCount: number
  /** 완납된 유치원 수 */
  receivedCount: number
  billed: number
  received: number
  outstanding: number
  /** 담당 유치원 전원 완납 여부. 담당이 0곳이면 false */
  allReceived: boolean
  /** 실지급액 U (마감 스냅샷) */
  netPay: number
  paid: number
  unpaid: number
  paidDate: string | null
}

export interface CollectionTotals {
  billed: number
  received: number
  adjusted: number
  outstanding: number
  netPay: number
  paid: number
  unpaid: number
}

export interface CollectionSummary {
  venues: CollectionRow[]
  partners: PartnerCollection[]
  totals: CollectionTotals
  /**
   * 지급 요청 알림 (docs §9) — 담당 유치원 전원 입금 완료 & 아직 미지급.
   * 실지급액이 0인 영업자는 올리지 않는다 (지급할 것이 없다).
   */
  readyToPay: PartnerCollection[]
}

export interface CollectionInput {
  /** 마감 스냅샷의 식당 행 */
  venues: readonly ClosingVenueRow[]
  /** 마감 스냅샷의 영업자 행 */
  partners: readonly ClosingPartnerRow[]
  receipts: readonly ReceiptRecord[]
  receiptAdjustments?: readonly ReceiptAdjustmentRecord[]
  payouts: readonly PayoutRecord[]
}

export function buildCollectionSummary(input: CollectionInput): CollectionSummary {
  // ── 유치원(사업장) 단위로 청구액을 모은다 ─────────────
  const rows = new Map<string, CollectionRow>()
  for (const v of input.venues) {
    // ⚠️ 정산제외 사업장은 계산서를 발행하지 않으므로 받을 돈이 없다.
    // 목록에 넣으면 영원히 미수금으로 남아 "전원 입금 완료"가 되지 않는다.
    if (v.isExcluded) continue

    const key = `${v.source}:${v.businessCode}`
    let row = rows.get(key)
    if (!row) {
      row = {
        source: v.source,
        businessCode: v.businessCode,
        label: v.companyName ?? v.businessName,
        partnerId: v.partnerId,
        partnerName: v.partnerName,
        billed: 0,
        received: 0,
        adjusted: 0,
        outstanding: 0,
        receivedDate: null,
        isFullyReceived: false,
        receiptCount: 0,
      }
      rows.set(key, row)
    }
    row.billed += v.price.total
  }

  for (const adjustment of input.receiptAdjustments ?? []) {
    if (adjustment.status !== 'approved') continue
    const row = rows.get(`${adjustment.source}:${adjustment.businessCode}`)
    if (!row) continue
    row.adjusted += adjustment.amount
  }

  for (const r of input.receipts) {
    const row = rows.get(`${r.source}:${r.businessCode}`)
    // 마감 대상이 아닌 입금 기록은 무시한다 (사업장이 바뀌었거나 잘못 들어온 것).
    // 조용히 합계에 더하면 미수금이 틀어진다.
    if (!row) continue
    row.received += r.amount
    row.receiptCount += 1
    // 마지막 입금일 — 문자열 비교로 충분하다 (YYYY-MM-DD는 사전순 = 시간순)
    if (!row.receivedDate || r.receivedDate > row.receivedDate) {
      row.receivedDate = r.receivedDate
    }
  }

  const venues = [...rows.values()]
  for (const row of venues) {
    row.outstanding = row.billed - row.received - row.adjusted
    row.isFullyReceived = row.outstanding <= 0 && row.billed > 0
  }
  // 받아야 할 것부터 본다
  venues.sort((a, b) => b.outstanding - a.outstanding)

  // ── 영업자 단위 ───────────────────────────────────────
  const paidByPartner = new Map<string, { amount: number; lastDate: string | null }>()
  for (const p of input.payouts) {
    const cur = paidByPartner.get(p.partnerId) ?? { amount: 0, lastDate: null }
    cur.amount += p.amount
    if (!cur.lastDate || p.paidDate > cur.lastDate) cur.lastDate = p.paidDate
    paidByPartner.set(p.partnerId, cur)
  }

  const partners: PartnerCollection[] = input.partners.map((p) => {
    const mine = venues.filter((v) => v.partnerId === p.partnerId)
    const billed = mine.reduce((s, v) => s + v.billed, 0)
    const received = mine.reduce((s, v) => s + v.received, 0)
    const receivedCount = mine.filter((v) => v.isFullyReceived).length
    const paidInfo = paidByPartner.get(p.partnerId)
    const paid = paidInfo?.amount ?? 0

    return {
      partnerId: p.partnerId,
      partnerName: p.partnerName,
      venueCount: mine.length,
      receivedCount,
      billed,
      received,
      outstanding: mine.reduce((sum, row) => sum + row.outstanding, 0),
      // 담당이 0곳이면 false — 빈 조건을 "전원 완료"로 보면 매달 헛 알림이 뜬다
      allReceived: mine.length > 0 && receivedCount === mine.length,
      netPay: p.netPay,
      paid,
      unpaid: p.netPay - paid,
      paidDate: paidInfo?.lastDate ?? null,
    }
  })

  const totals: CollectionTotals = {
    billed: venues.reduce((s, v) => s + v.billed, 0),
    received: venues.reduce((s, v) => s + v.received, 0),
    adjusted: venues.reduce((s, v) => s + v.adjusted, 0),
    outstanding: 0,
    netPay: partners.reduce((s, p) => s + p.netPay, 0),
    paid: partners.reduce((s, p) => s + p.paid, 0),
    unpaid: 0,
  }
  totals.outstanding = totals.billed - totals.received - totals.adjusted
  totals.unpaid = totals.netPay - totals.paid

  return {
    venues,
    partners,
    totals,
    // 지급할 것이 남아 있고 담당 유치원이 전원 완납된 영업자
    readyToPay: partners.filter((p) => p.allReceived && p.unpaid > 0),
  }
}

import type { SettlementSource } from '../parse/types'
import type { ClosingVenueRow } from './closing'

export interface SupplierPrincipal {
  source: SettlementSource
  amount: number
}

export interface SupplierAdjustmentRecord {
  source: SettlementSource
  amount: number
  status: 'draft' | 'approved' | 'cancelled'
}

export interface SupplierPaymentRecord {
  source: SettlementSource
  paidDate: string
  amount: number
}

export interface SupplierPayableRow {
  source: SettlementSource
  principal: number
  adjustment: number
  payable: number
  paid: number
  outstanding: number
  paymentCount: number
  lastPaidDate: string | null
}

export interface SupplierPayableSummary {
  rows: SupplierPayableRow[]
  totals: Omit<SupplierPayableRow, 'source' | 'lastPaidDate'>
}

/** 정산제외 원천도 공급자에게는 지급하지만 외부 사입·계산서 조정 합성행은 제외한다. */
export function calculateSupplierPrincipals(
  venues: readonly ClosingVenueRow[]
): SupplierPrincipal[] {
  return (['cj', 'shinsegae'] as const).map((source) => ({
    source,
    amount: venues
      .filter(
        (venue) =>
          venue.source === source &&
          !venue.restaurantCode.startsWith('manual:') &&
          venue.restaurantCode !== 'invoice-override'
      )
      .reduce((sum, venue) => sum + venue.cost.total, 0),
  }))
}

export function buildSupplierPayableSummary(input: {
  principals: readonly SupplierPrincipal[]
  adjustments: readonly SupplierAdjustmentRecord[]
  payments: readonly SupplierPaymentRecord[]
}): SupplierPayableSummary {
  const rows: SupplierPayableRow[] = (['cj', 'shinsegae'] as const).map((source) => {
    const principal = input.principals
      .filter((row) => row.source === source)
      .reduce((sum, row) => sum + row.amount, 0)
    const adjustment = input.adjustments
      .filter((row) => row.source === source && row.status === 'approved')
      .reduce((sum, row) => sum + row.amount, 0)
    const payments = input.payments.filter((row) => row.source === source)
    const paid = payments.reduce((sum, row) => sum + row.amount, 0)
    const payable = principal + adjustment
    return {
      source,
      principal,
      adjustment,
      payable,
      paid,
      outstanding: payable - paid,
      paymentCount: payments.length,
      lastPaidDate: payments.reduce<string | null>(
        (latest, row) => (!latest || row.paidDate > latest ? row.paidDate : latest),
        null
      ),
    }
  })

  return {
    rows,
    totals: {
      principal: rows.reduce((sum, row) => sum + row.principal, 0),
      adjustment: rows.reduce((sum, row) => sum + row.adjustment, 0),
      payable: rows.reduce((sum, row) => sum + row.payable, 0),
      paid: rows.reduce((sum, row) => sum + row.paid, 0),
      outstanding: rows.reduce((sum, row) => sum + row.outstanding, 0),
      paymentCount: rows.reduce((sum, row) => sum + row.paymentCount, 0),
    },
  }
}

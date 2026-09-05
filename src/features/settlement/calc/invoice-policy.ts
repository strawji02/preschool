import type { InvoiceRow, InvoiceTaxKind } from '../report/invoice-sheet'
import type { SettlementSource } from '../parse/types'

export type InvoiceOverrideStatus = 'draft' | 'approved' | 'cancelled'

export const DEFAULT_INVOICE_OVERRIDE_REASON = '유치원 요청'

export interface InvoiceOverrideDraft {
  taxKind: InvoiceTaxKind
  itemName: string
  originalSupply: number
  originalVat: number
  finalSupply: number
  finalVat: number
  reason: string
}

/** 단건·일괄 승인 요청이 똑같은 금액 검증을 사용한다. */
export function validateInvoiceOverrideDraft(input: InvoiceOverrideDraft): string | null {
  const values = [input.originalSupply, input.originalVat, input.finalSupply, input.finalVat]
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return '공급가·부가세는 0 이상의 원 단위 정수로 입력해 주세요.'
  }
  if (input.taxKind === 'exempt' && (input.originalVat !== 0 || input.finalVat !== 0)) {
    return '면세 계산서에는 부가세를 입력할 수 없습니다.'
  }
  if (!input.itemName.trim() || !input.reason.trim()) {
    return '품목명과 조정 사유를 입력해 주세요.'
  }
  return null
}

/** CJ 1016 인천 복자유치원에만 허용하는 계산서 원단위 조정. */
export interface InvoiceOverride {
  id: string
  period: string
  source: SettlementSource
  businessCode: string
  taxKind: InvoiceTaxKind
  itemName: string
  originalSupply: number
  originalVat: number
  finalSupply: number
  finalVat: number
  reason: string
  status: InvoiceOverrideStatus
}

export interface ApplyInvoiceOverridesResult {
  rows: InvoiceRow[]
  applied: string[]
  problems: string[]
}

const ALLOWED_VENUE_KEY = 'cj:1016'

/**
 * 원천 계산서 행을 복사한 뒤 승인된 예외만 적용한다.
 * 저장 당시 원본과 현재 원본이 다르면 오래된 조정을 조용히 재사용하지 않는다.
 */
export function applyInvoiceOverrides(
  sourceRows: readonly InvoiceRow[],
  overrides: readonly InvoiceOverride[]
): ApplyInvoiceOverridesResult {
  const rows = sourceRows.map((row) => ({ ...row, venueKeys: [...(row.venueKeys ?? [])] }))
  const applied: string[] = []
  const problems: string[] = []

  for (const override of overrides) {
    if (override.status !== 'approved') continue
    if (`${override.source}:${override.businessCode}` !== ALLOWED_VENUE_KEY) {
      problems.push(`${override.id}: 원단위 조정은 CJ 사업장코드 1016만 허용됩니다.`)
      continue
    }
    if (!override.reason.trim()) {
      problems.push(`${override.id}: 조정 사유가 없습니다.`)
      continue
    }

    const row = rows.find(
      (candidate) =>
        candidate.taxKind === override.taxKind &&
        candidate.itemName === override.itemName &&
        candidate.allowVenueOverride !== false &&
        candidate.venueKeys?.includes(ALLOWED_VENUE_KEY)
    )
    if (!row) {
      problems.push(`${override.id}: 적용할 CJ 1016 계산서 품목을 찾지 못했습니다.`)
      continue
    }
    if ((row.venueKeys ?? []).some((key) => key !== ALLOWED_VENUE_KEY)) {
      problems.push(`${override.id}: 다른 사업장과 합쳐진 계산서에는 조정을 적용할 수 없습니다.`)
      continue
    }
    if (row.supply !== override.originalSupply || row.vat !== override.originalVat) {
      problems.push(
        `${override.id}: 저장 후 원본 금액이 변경되었습니다. 현재 원본을 확인하고 다시 승인해 주세요.`
      )
      continue
    }
    if (
      !Number.isSafeInteger(override.finalSupply) ||
      !Number.isSafeInteger(override.finalVat) ||
      override.finalSupply < 0 ||
      override.finalVat < 0 ||
      (override.taxKind === 'exempt' && override.finalVat !== 0)
    ) {
      problems.push(`${override.id}: 최종 공급가·부가세가 올바르지 않습니다.`)
      continue
    }

    row.supply = override.finalSupply
    row.vat = override.finalVat
    applied.push(override.id)
  }

  return { rows, applied, problems }
}

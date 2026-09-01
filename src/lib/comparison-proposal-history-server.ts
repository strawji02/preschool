import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildStatementSnapshot,
  normalizeKindergartenKey,
  normalizeKindergartenName,
  type EstimateConfidence,
  type ProposalAmountSnapshot,
  type StatementItemInput,
} from '@/lib/comparison-proposal-history'

export type ProposalIssueFormat = 'pptx' | 'pdf_print' | 'historical_estimate'

const AMOUNT_KEYS: Array<keyof ProposalAmountSnapshot> = [
  'monthlyExistingAmount',
  'monthlyProposedAmount',
  'monthlySavings',
  'annualExistingAmount',
  'annualProposedAmount',
  'annualSavings',
  'savingsPercent',
  'supplyRate',
  'totalExtrasAnnual',
]

interface SessionRow {
  id: string
  name: string
  kindergarten_name: string | null
  supplier: string | null
  price_book_period: string | null
}

interface AuditItemRow {
  extracted_name: string | null
  extracted_spec: string | null
  extracted_origin: string | null
  extracted_unit: string | null
  extracted_quantity: number | string | null
  extracted_unit_price: number | string | null
  extracted_supply_amount: number | string | null
  extracted_tax_amount: number | string | null
  extracted_total_price: number | string | null
  source: { supplier_name?: string | null } | Array<{ supplier_name?: string | null }> | null
}

export interface RecordProposalVersionInput {
  sessionId: string
  kindergartenName?: string | null
  targetPeriod?: string | null
  issueFormat: ProposalIssueFormat
  idempotencyKey: string
  amountSnapshot: ProposalAmountSnapshot
  changeReasons?: string[]
  issuedBy?: string | null
  issuedAt?: string
  isEstimated?: boolean
  estimateConfidence?: EstimateConfidence | null
  estimateBasis?: string[]
}

export interface RecordedProposalVersion {
  versionId: string
  proposalId: string
  versionNo: number
  statementChanged: boolean | null
  proposalAmountChanged: boolean | null
  duplicate: boolean
}

function sourceSupplier(source: AuditItemRow['source']): string {
  if (Array.isArray(source)) return String(source[0]?.supplier_name ?? '')
  return String(source?.supplier_name ?? '')
}

export function normalizeAmountSnapshot(value: unknown): ProposalAmountSnapshot {
  if (!value || typeof value !== 'object') throw new Error('제안금액 스냅샷이 필요합니다.')
  const raw = value as Record<string, unknown>
  const result = {} as ProposalAmountSnapshot
  for (const key of AMOUNT_KEYS) {
    const number = Number(raw[key])
    if (!Number.isFinite(number)) throw new Error(`제안금액 ${key} 값이 올바르지 않습니다.`)
    result[key] = number
  }
  return result
}

export async function loadTrustedStatementSnapshot(sessionId: string) {
  const db = createAdminClient()
  const { data: session, error: sessionError } = await db
    .from('audit_sessions')
    .select('id, name, kindergarten_name, supplier, price_book_period')
    .eq('id', sessionId)
    .maybeSingle()
  if (sessionError) throw sessionError
  if (!session) throw new Error('비교 세션을 찾을 수 없습니다.')

  const { data: items, error: itemsError } = await db
    .from('audit_items')
    .select('extracted_name, extracted_spec, extracted_origin, extracted_unit, extracted_quantity, extracted_unit_price, extracted_supply_amount, extracted_tax_amount, extracted_total_price, source:comparison_sources!source_id(supplier_name)')
    .eq('session_id', sessionId)
  if (itemsError) throw itemsError

  const statementItems: StatementItemInput[] = ((items ?? []) as AuditItemRow[]).map((item) => ({
    supplier: sourceSupplier(item.source) || String(session.supplier ?? ''),
    name: item.extracted_name,
    spec: item.extracted_spec,
    origin: item.extracted_origin,
    unit: item.extracted_unit,
    quantity: Number(item.extracted_quantity ?? 0),
    unitPrice: Number(item.extracted_unit_price ?? 0),
    supplyAmount: Number(item.extracted_supply_amount ?? 0),
    taxAmount: Number(item.extracted_tax_amount ?? 0),
    totalPrice: item.extracted_total_price == null
      ? Number(item.extracted_unit_price ?? 0) * Number(item.extracted_quantity ?? 0)
      : Number(item.extracted_total_price),
  }))

  return {
    session: session as SessionRow,
    statement: buildStatementSnapshot(statementItems),
  }
}

export async function recordProposalVersion(
  input: RecordProposalVersionInput,
): Promise<RecordedProposalVersion> {
  if (!/^[0-9a-f-]{36}$/i.test(input.sessionId)) throw new Error('세션 ID가 올바르지 않습니다.')
  if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 200) {
    throw new Error('발행 요청 키가 올바르지 않습니다.')
  }
  if (!['pptx', 'pdf_print', 'historical_estimate'].includes(input.issueFormat)) {
    throw new Error('지원하지 않는 제안서 형식입니다.')
  }

  const amountSnapshot = normalizeAmountSnapshot(input.amountSnapshot)
  const { session, statement } = await loadTrustedStatementSnapshot(input.sessionId)
  const rawName = input.kindergartenName?.trim() || session.kindergarten_name || session.name
  const kindergartenName = normalizeKindergartenName(rawName)
  const kindergartenKey = normalizeKindergartenKey(rawName)
  const targetPeriod = input.targetPeriod?.trim() || session.price_book_period || ''
  const isEstimated = input.isEstimated === true
  if (isEstimated !== (input.issueFormat === 'historical_estimate')) {
    throw new Error('과거 추정 발행 형식과 추정 상태가 일치하지 않습니다.')
  }
  if (isEstimated && !input.estimateConfidence) throw new Error('과거 추정 신뢰도가 필요합니다.')

  const db = createAdminClient()
  const { data, error } = await db.rpc('record_comparison_proposal_version', {
    p_session_id: input.sessionId,
    p_kindergarten_name: kindergartenName,
    p_kindergarten_key: kindergartenKey,
    p_target_period: targetPeriod,
    p_issue_format: input.issueFormat,
    p_idempotency_key: input.idempotencyKey,
    p_statement_hash: statement.hash,
    p_statement_snapshot: statement,
    p_amount_snapshot: amountSnapshot,
    p_change_reasons: (input.changeReasons ?? []).map((reason) => reason.trim()).filter(Boolean).slice(0, 20),
    p_is_estimated: isEstimated,
    p_estimate_confidence: isEstimated ? input.estimateConfidence : null,
    p_estimate_basis: isEstimated ? (input.estimateBasis ?? []) : [],
    p_issued_by: input.issuedBy ?? null,
    p_issued_at: input.issuedAt ?? new Date().toISOString(),
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('제안서 발행 이력을 저장하지 못했습니다.')
  return {
    versionId: String(row.version_id),
    proposalId: String(row.proposal_id),
    versionNo: Number(row.version_no),
    statementChanged: row.statement_changed == null ? null : Boolean(row.statement_changed),
    proposalAmountChanged: row.proposal_amount_changed == null ? null : Boolean(row.proposal_amount_changed),
    duplicate: Boolean(row.duplicate),
  }
}

export async function getProposalHistory(sessionId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('comparison_proposal_versions')
    .select('id, version_no, issue_format, statement_changed, proposal_amount_changed, statement_diff, amount_diff, change_reasons, is_estimated, estimate_confidence, estimate_basis, issued_at')
    .eq('session_id', sessionId)
    .order('version_no', { ascending: false })
  if (error) throw error
  return data ?? []
}

export function monthBoundsKst(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('월은 YYYY-MM 형식이어야 합니다.')
  const [year, monthNumber] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, -9))
  const end = new Date(Date.UTC(year, monthNumber, 1, -9))
  return { start: start.toISOString(), end: end.toISOString() }
}

export async function getMonthlyProposalVersions(month: string) {
  const { start, end } = monthBoundsKst(month)
  const db = createAdminClient()
  const { data, error } = await db
    .from('comparison_proposal_versions')
    .select('id, session_id, version_no, issue_format, statement_changed, proposal_amount_changed, statement_diff, amount_diff, amount_snapshot, change_reasons, is_estimated, estimate_confidence, estimate_basis, issued_at, proposal:comparison_proposals!proposal_id(kindergarten_id, kindergarten_name_snapshot, target_period)')
    .gte('issued_at', start)
    .lt('issued_at', end)
    .order('issued_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

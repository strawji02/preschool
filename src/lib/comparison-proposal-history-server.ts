import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildOfficialProposalDashboard,
  buildStatementSnapshot,
  normalizeKindergartenKey,
  normalizeKindergartenName,
  type EstimateConfidence,
  type OfficialProposalVersionInput,
  type ProposalDashboardChangeType,
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
  rawVersionNo: number
  versionNo: number
  statementChanged: boolean | null
  proposalAmountChanged: boolean | null
  duplicate: boolean
}

export interface ProposalDashboardQuery {
  month: string
  search?: string
  changeType?: ProposalDashboardChangeType
  issuerId?: string
  page?: number
  pageSize?: number
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
  const rawVersionNo = Number(row.version_no)
  let officialVersionNo = rawVersionNo
  if (!isEstimated) {
    const officialStartAt = await getProposalDashboardOfficialStartAt()
    const { count, error: countError } = await db
      .from('comparison_proposal_versions')
      .select('*', { count: 'exact', head: true })
      .eq('proposal_id', String(row.proposal_id))
      .eq('is_estimated', false)
      .gte('issued_at', officialStartAt)
    if (countError) throw countError
    officialVersionNo = count ?? 1
  }
  return {
    versionId: String(row.version_id),
    proposalId: String(row.proposal_id),
    rawVersionNo,
    versionNo: officialVersionNo,
    statementChanged: row.statement_changed == null ? null : Boolean(row.statement_changed),
    proposalAmountChanged: row.proposal_amount_changed == null ? null : Boolean(row.proposal_amount_changed),
    duplicate: Boolean(row.duplicate),
  }
}

export async function getProposalHistory(sessionId: string) {
  const db = createAdminClient()
  const officialStartAt = await getProposalDashboardOfficialStartAt()
  const { data, error } = await db
    .from('comparison_proposal_versions')
    .select('id, version_no, issue_format, statement_changed, proposal_amount_changed, statement_diff, amount_diff, amount_snapshot, change_reasons, issued_by, issued_at')
    .eq('session_id', sessionId)
    .eq('is_estimated', false)
    .gte('issued_at', officialStartAt)
    .order('version_no', { ascending: false })
  if (error) throw error
  const ordered = [...(data ?? [])].sort((a, b) => Number(a.version_no) - Number(b.version_no))
  const profiles = await loadIssuerProfiles(ordered.map((row) => row.issued_by as string | null))
  return ordered.map((row, index) => ({
    id: row.id,
    rawVersionNo: Number(row.version_no),
    versionNo: index + 1,
    issueFormat: row.issue_format,
    statementChanged: index === 0 ? null : row.statement_changed,
    proposalAmountChanged: index === 0 ? null : row.proposal_amount_changed,
    statementDiff: index === 0 ? {} : row.statement_diff,
    amountDiff: index === 0 ? {} : row.amount_diff,
    amountSnapshot: row.amount_snapshot,
    changeReasons: row.change_reasons,
    issuedAt: row.issued_at,
    issuer: profiles.get(String(row.issued_by ?? '')) ?? null,
  })).reverse()
}

export function monthBoundsKst(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('월은 YYYY-MM 형식이어야 합니다.')
  const [year, monthNumber] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, -9))
  const end = new Date(Date.UTC(year, monthNumber, 1, -9))
  return { start: start.toISOString(), end: end.toISOString() }
}

interface IssuerProfile {
  id: string
  name: string
  email: string
}

function asObject(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asObject(value[0])
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asNumberRecord(value: unknown): Record<string, number> {
  const object = asObject(value)
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, Number(item ?? 0)]))
}

async function loadIssuerProfiles(ids: Array<string | null>): Promise<Map<string, IssuerProfile>> {
  const wanted = new Set(ids.filter((id): id is string => !!id))
  const result = new Map<string, IssuerProfile>()
  if (wanted.size === 0) return result
  const db = createAdminClient()
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) {
    console.warn('[comparison-proposal-dashboard-users]', error.message)
    return result
  }
  for (const user of data.users) {
    if (!wanted.has(user.id)) continue
    const metadata = user.user_metadata ?? {}
    result.set(user.id, {
      id: user.id,
      name: String(metadata.full_name ?? metadata.name ?? user.email ?? '담당자'),
      email: user.email ?? '',
    })
  }
  return result
}

export async function getProposalDashboardOfficialStartAt(): Promise<string> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('comparison_proposal_dashboard_settings')
    .select('official_start_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  if (!data?.official_start_at) throw new Error('제안서 웹 현황판 공식 시작일이 설정되지 않았습니다.')
  return String(data.official_start_at)
}

async function loadOfficialProposalRows(end: string, officialStartAt: string) {
  const db = createAdminClient()
  const rows: unknown[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('comparison_proposal_versions')
      .select('id, proposal_id, session_id, version_no, issue_format, statement_changed, proposal_amount_changed, statement_diff, amount_diff, amount_snapshot, change_reasons, is_estimated, issued_by, issued_at, proposal:comparison_proposals!proposal_id(kindergarten_id, kindergarten_name_snapshot, target_period)')
      .eq('is_estimated', false)
      .gte('issued_at', officialStartAt)
      .lt('issued_at', end)
      .order('issued_at', { ascending: true })
      .order('version_no', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < pageSize) break
  }
  return rows
}

function normalizeDashboardRow(
  raw: unknown,
  profiles: Map<string, IssuerProfile>,
): OfficialProposalVersionInput {
  const row = asObject(raw)
  const proposal = asObject(row.proposal)
  const issuerId = row.issued_by == null ? null : String(row.issued_by)
  const issuer = issuerId ? profiles.get(issuerId) : null
  return {
    id: String(row.id ?? ''),
    proposalId: String(row.proposal_id ?? ''),
    sessionId: String(row.session_id ?? ''),
    kindergartenId: String(proposal.kindergarten_id ?? ''),
    kindergartenName: String(proposal.kindergarten_name_snapshot ?? '미확인'),
    targetPeriod: String(proposal.target_period ?? ''),
    rawVersionNo: Number(row.version_no ?? 0),
    issueFormat: String(row.issue_format ?? ''),
    statementChanged: row.statement_changed == null ? null : Boolean(row.statement_changed),
    proposalAmountChanged: row.proposal_amount_changed == null ? null : Boolean(row.proposal_amount_changed),
    statementDiff: asNumberRecord(row.statement_diff),
    amountDiff: asNumberRecord(row.amount_diff),
    amountSnapshot: normalizeAmountSnapshot(row.amount_snapshot),
    changeReasons: Array.isArray(row.change_reasons) ? row.change_reasons.map(String) : [],
    isEstimated: Boolean(row.is_estimated),
    issuedAt: String(row.issued_at ?? ''),
    issuerId,
    issuerName: issuer?.name ?? (issuerId ? '담당자' : '시스템'),
    issuerEmail: issuer?.email ?? '',
  }
}

export async function getProposalDashboard(query: ProposalDashboardQuery) {
  const { start, end } = monthBoundsKst(query.month)
  const officialStartAt = await getProposalDashboardOfficialStartAt()
  const rawRows = await loadOfficialProposalRows(end, officialStartAt)
  const ids = rawRows.map((raw) => {
    const row = asObject(raw)
    return row.issued_by == null ? null : String(row.issued_by)
  })
  const profiles = await loadIssuerProfiles(ids)
  const rows = rawRows.map((row) => normalizeDashboardRow(row, profiles))
  const result = buildOfficialProposalDashboard(rows, {
    officialStartAt,
    monthStart: start,
    monthEnd: end,
    search: query.search,
    changeType: query.changeType,
    issuerId: query.issuerId,
    page: query.page,
    pageSize: query.pageSize,
  })
  const issuerMap = new Map<string, IssuerProfile>()
  for (const row of rows) {
    const issuedAt = Date.parse(row.issuedAt)
    if (issuedAt < Date.parse(start) || issuedAt >= Date.parse(end) || !row.issuerId) continue
    issuerMap.set(row.issuerId, {
      id: row.issuerId,
      name: row.issuerName,
      email: row.issuerEmail,
    })
  }
  return {
    ...result,
    officialStartAt,
    month: query.month,
    issuers: [...issuerMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }
}

import { createHash } from 'node:crypto'

export interface StatementItemInput {
  supplier?: string | null
  name?: string | null
  spec?: string | null
  origin?: string | null
  unit?: string | null
  quantity?: number | null
  unitPrice?: number | null
  supplyAmount?: number | null
  taxAmount?: number | null
  totalPrice?: number | null
  sourceFileName?: string | null
}

export interface CanonicalStatementLine {
  supplier: string
  name: string
  spec: string
  origin: string
  unit: string
  quantity: number
  unitPrice: number
  supplyAmount: number
  taxAmount: number
  totalPrice: number
  identityKey: string
  lineKey: string
}

export interface StatementSnapshot {
  hash: string
  totalAmount: number
  itemCount: number
  lines: CanonicalStatementLine[]
}

export interface ProposalAmountSnapshot {
  monthlyExistingAmount: number
  monthlyProposedAmount: number
  monthlySavings: number
  annualExistingAmount: number
  annualProposedAmount: number
  annualSavings: number
  savingsPercent: number
  supplyRate: number
  totalExtrasAnnual: number
}

export interface StatementDiff {
  addedCount: number
  removedCount: number
  modifiedCount: number
  previousTotal: number
  currentTotal: number
  totalDelta: number
}

export interface ProposalAmountDiff {
  monthlyExistingAmount: number
  monthlyProposedAmount: number
  monthlySavings: number
  annualExistingAmount: number
  annualProposedAmount: number
  annualSavings: number
  savingsPercent: number
  supplyRate: number
  totalExtrasAnnual: number
}

export interface ProposalVersionForAggregation {
  kindergartenId: string
  versionNo: number
  isEstimated: boolean
  statementChanged: boolean | null
  proposalAmountChanged: boolean | null
}

export interface ProposalMonthSummary {
  totalVersions: number
  newProposalCount: number
  reissueCount: number
  bothChangedCount: number
  statementOnlyChangedCount: number
  amountOnlyChangedCount: number
  neitherChangedCount: number
  estimatedCount: number
  kindergartenCount: number
}

export type ProposalDashboardChangeType =
  | 'all'
  | 'new'
  | 'reissue'
  | 'both'
  | 'statement_only'
  | 'amount_only'
  | 'neither'

export interface OfficialProposalVersionInput {
  id: string
  proposalId: string
  sessionId: string
  kindergartenId: string
  kindergartenName: string
  targetPeriod: string
  rawVersionNo: number
  issueFormat: string
  statementChanged: boolean | null
  proposalAmountChanged: boolean | null
  statementDiff: Record<string, number>
  amountDiff: Record<string, number>
  amountSnapshot: ProposalAmountSnapshot
  changeReasons: string[]
  isEstimated: boolean
  issuedAt: string
  issuerId: string | null
  issuerName: string
  issuerEmail: string
}

export interface OfficialProposalDashboardRow extends OfficialProposalVersionInput {
  officialVersionNo: number
}

export interface OfficialProposalDashboardOptions {
  officialStartAt: string
  monthStart: string
  monthEnd: string
  search?: string
  changeType?: ProposalDashboardChangeType
  issuerId?: string
  page?: number
  pageSize?: number
}

function textKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function finite(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildStatementSnapshot(items: StatementItemInput[]): StatementSnapshot {
  const lines = items.map((item): CanonicalStatementLine => {
    const supplier = textKey(item.supplier)
    const name = textKey(item.name)
    const spec = textKey(item.spec)
    const origin = textKey(item.origin)
    const unit = textKey(item.unit)
    const quantity = finite(item.quantity)
    const unitPrice = finite(item.unitPrice)
    const supplyAmount = finite(item.supplyAmount)
    const taxAmount = finite(item.taxAmount)
    const totalPrice = finite(item.totalPrice || unitPrice * quantity)
    const identityKey = [supplier, name, spec, origin, unit].join('\u001f')
    const lineKey = [identityKey, quantity, unitPrice, supplyAmount, taxAmount, totalPrice].join('\u001f')
    return {
      supplier,
      name,
      spec,
      origin,
      unit,
      quantity,
      unitPrice,
      supplyAmount,
      taxAmount,
      totalPrice,
      identityKey,
      lineKey,
    }
  }).sort((a, b) => a.lineKey.localeCompare(b.lineKey, 'ko'))

  return {
    hash: hashJson(lines.map((line) => ({
      supplier: line.supplier,
      name: line.name,
      spec: line.spec,
      origin: line.origin,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      supplyAmount: line.supplyAmount,
      taxAmount: line.taxAmount,
      totalPrice: line.totalPrice,
    }))),
    totalAmount: lines.reduce((sum, line) => sum + line.totalPrice, 0),
    itemCount: lines.length,
    lines,
  }
}

function countByLine(lines: CanonicalStatementLine[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()
  for (const line of lines) {
    const bucket = result.get(line.identityKey) ?? new Map<string, number>()
    bucket.set(line.lineKey, (bucket.get(line.lineKey) ?? 0) + 1)
    result.set(line.identityKey, bucket)
  }
  return result
}

function remainingCount(bucket: Map<string, number>): number {
  let count = 0
  for (const value of bucket.values()) count += value
  return count
}

export function diffStatementSnapshots(previous: StatementSnapshot, current: StatementSnapshot): StatementDiff {
  const previousByIdentity = countByLine(previous.lines)
  const currentByIdentity = countByLine(current.lines)
  let addedCount = 0
  let removedCount = 0
  let modifiedCount = 0

  const identities = new Set([...previousByIdentity.keys(), ...currentByIdentity.keys()])
  for (const identity of identities) {
    const before = new Map(previousByIdentity.get(identity) ?? [])
    const after = new Map(currentByIdentity.get(identity) ?? [])
    for (const lineKey of new Set([...before.keys(), ...after.keys()])) {
      const shared = Math.min(before.get(lineKey) ?? 0, after.get(lineKey) ?? 0)
      if (shared > 0) {
        before.set(lineKey, (before.get(lineKey) ?? 0) - shared)
        after.set(lineKey, (after.get(lineKey) ?? 0) - shared)
      }
    }
    const beforeRemaining = remainingCount(before)
    const afterRemaining = remainingCount(after)
    const modified = Math.min(beforeRemaining, afterRemaining)
    modifiedCount += modified
    removedCount += beforeRemaining - modified
    addedCount += afterRemaining - modified
  }

  return {
    addedCount,
    removedCount,
    modifiedCount,
    previousTotal: previous.totalAmount,
    currentTotal: current.totalAmount,
    totalDelta: current.totalAmount - previous.totalAmount,
  }
}

export function diffAmountSnapshots(
  previous: ProposalAmountSnapshot,
  current: ProposalAmountSnapshot,
): ProposalAmountDiff {
  return {
    monthlyExistingAmount: current.monthlyExistingAmount - previous.monthlyExistingAmount,
    monthlyProposedAmount: current.monthlyProposedAmount - previous.monthlyProposedAmount,
    monthlySavings: current.monthlySavings - previous.monthlySavings,
    annualExistingAmount: current.annualExistingAmount - previous.annualExistingAmount,
    annualProposedAmount: current.annualProposedAmount - previous.annualProposedAmount,
    annualSavings: current.annualSavings - previous.annualSavings,
    savingsPercent: current.savingsPercent - previous.savingsPercent,
    supplyRate: current.supplyRate - previous.supplyRate,
    totalExtrasAnnual: current.totalExtrasAnnual - previous.totalExtrasAnnual,
  }
}

export function compareProposalSnapshots(
  previous: { statement: StatementSnapshot; amount: ProposalAmountSnapshot },
  current: { statement: StatementSnapshot; amount: ProposalAmountSnapshot },
) {
  const statementDiff = diffStatementSnapshots(previous.statement, current.statement)
  const amountDiff = diffAmountSnapshots(previous.amount, current.amount)
  return {
    statementChanged: previous.statement.hash !== current.statement.hash,
    proposalAmountChanged: previous.amount.monthlyProposedAmount !== current.amount.monthlyProposedAmount,
    statementDiff,
    amountDiff,
  }
}

export function aggregateProposalMonth(rows: ProposalVersionForAggregation[]): ProposalMonthSummary {
  const reissues = rows.filter((row) => row.versionNo > 1)
  return {
    totalVersions: rows.length,
    newProposalCount: rows.filter((row) => row.versionNo === 1).length,
    reissueCount: reissues.length,
    bothChangedCount: reissues.filter((row) => row.statementChanged === true && row.proposalAmountChanged === true).length,
    statementOnlyChangedCount: reissues.filter((row) => row.statementChanged === true && row.proposalAmountChanged === false).length,
    amountOnlyChangedCount: reissues.filter((row) => row.statementChanged === false && row.proposalAmountChanged === true).length,
    neitherChangedCount: reissues.filter((row) => row.statementChanged === false && row.proposalAmountChanged === false).length,
    estimatedCount: rows.filter((row) => row.isEstimated).length,
    kindergartenCount: new Set(rows.map((row) => row.kindergartenId)).size,
  }
}

function isDashboardChangeTypeMatch(
  row: OfficialProposalDashboardRow,
  changeType: ProposalDashboardChangeType,
): boolean {
  if (changeType === 'all') return true
  if (changeType === 'new') return row.officialVersionNo === 1
  if (changeType === 'reissue') return row.officialVersionNo > 1
  if (row.officialVersionNo === 1) return false
  if (changeType === 'both') return row.statementChanged === true && row.proposalAmountChanged === true
  if (changeType === 'statement_only') return row.statementChanged === true && row.proposalAmountChanged === false
  if (changeType === 'amount_only') return row.statementChanged === false && row.proposalAmountChanged === true
  return row.statementChanged === false && row.proposalAmountChanged === false
}

/**
 * 웹 현황판 공식 집계.
 *
 * 과거 추정 및 공식 시작일 이전 버전은 번호 계산에서도 제외한다. 따라서 과거
 * 추정본 때문에 DB 원시 버전이 v2 이상이어도 첫 공식 발행은 공식 v1이 된다.
 */
export function buildOfficialProposalDashboard(
  inputRows: OfficialProposalVersionInput[],
  options: OfficialProposalDashboardOptions,
) {
  const officialStart = Date.parse(options.officialStartAt)
  const monthStart = Date.parse(options.monthStart)
  const monthEnd = Date.parse(options.monthEnd)
  if (![officialStart, monthStart, monthEnd].every(Number.isFinite) || monthStart >= monthEnd) {
    throw new Error('공식 집계일 또는 조회 월 범위가 올바르지 않습니다.')
  }

  const officialRows = inputRows
    .filter((row) => {
      const issuedAt = Date.parse(row.issuedAt)
      return !row.isEstimated && Number.isFinite(issuedAt) && issuedAt >= officialStart && issuedAt < monthEnd
    })
    .sort((a, b) => {
      const time = Date.parse(a.issuedAt) - Date.parse(b.issuedAt)
      return time || a.rawVersionNo - b.rawVersionNo || a.id.localeCompare(b.id)
    })

  const sequenceByProposal = new Map<string, number>()
  const sequenced: OfficialProposalDashboardRow[] = officialRows.map((row) => {
    const officialVersionNo = (sequenceByProposal.get(row.proposalId) ?? 0) + 1
    sequenceByProposal.set(row.proposalId, officialVersionNo)
    if (officialVersionNo === 1) {
      return {
        ...row,
        officialVersionNo,
        statementChanged: null,
        proposalAmountChanged: null,
        statementDiff: {},
        amountDiff: {},
      }
    }
    return { ...row, officialVersionNo }
  })

  const search = textKey(options.search)
  const changeType = options.changeType ?? 'all'
  const issuerId = options.issuerId?.trim() ?? ''
  const filtered = sequenced.filter((row) => {
    const issuedAt = Date.parse(row.issuedAt)
    if (issuedAt < monthStart || issuedAt >= monthEnd) return false
    if (search && !textKey(row.kindergartenName).includes(search)) return false
    if (issuerId && row.issuerId !== issuerId) return false
    return isDashboardChangeTypeMatch(row, changeType)
  })

  const summary = aggregateProposalMonth(filtered.map((row) => ({
    kindergartenId: row.kindergartenId,
    versionNo: row.officialVersionNo,
    isEstimated: false,
    statementChanged: row.statementChanged,
    proposalAmountChanged: row.proposalAmountChanged,
  })))
  const ordered = [...filtered].sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt))
  const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 20)))
  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1))
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize))
  const page = Math.min(requestedPage, pageCount)
  const start = (page - 1) * pageSize

  return {
    summary,
    rows: ordered.slice(start, start + pageSize),
    total: ordered.length,
    page,
    pageSize,
    pageCount,
  }
}

export type EstimateConfidence = 'high' | 'medium' | 'low'

export function classifyHistoricalProposal(input: {
  currentStep?: string | null
  proposalExtras?: Record<string, unknown> | null
}): { confidence: EstimateConfidence; basis: string[] } | null {
  const hasReportStep = input.currentStep === 'report' || input.currentStep === 'completed'
  const hasExtras = !!input.proposalExtras && Object.keys(input.proposalExtras).length > 0
  if (hasReportStep && hasExtras) return { confidence: 'high', basis: ['report_step', 'proposal_extras'] }
  if (hasReportStep) return { confidence: 'medium', basis: ['report_step'] }
  if (hasExtras) return { confidence: 'low', basis: ['proposal_extras'] }
  return null
}

export function normalizeKindergartenName(value: string): string {
  let name = value.normalize('NFKC').trim()
  name = name.replace(/유\)/g, '유치원')
  name = name.replace(/(?:19|20)?\d{2}\s*년\s*\d{1,2}\s*월/g, ' ')
  name = name.replace(/\d{1,2}\s*월/g, ' ')
  name = name.replace(/(?:신세계(?:푸드)?|cj(?:프레쉬웨이)?|푸디스트|푸드머스)/gi, ' ')
  name = name.replace(/(?:거래명세표|거래명세서|주문내역서|청구서류|제안서|비교|원본)/g, ' ')
  name = name.replace(/[()[\]{}]/g, ' ')
  name = name.replace(/[_\-/]+/g, ' ')
  name = name.replace(/\s+/g, ' ').trim()
  return name || value.trim()
}

export function normalizeKindergartenKey(value: string): string {
  return normalizeKindergartenName(value).toLowerCase().replace(/\s+/g, '')
}

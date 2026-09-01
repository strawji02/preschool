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

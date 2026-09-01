import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import {
  buildStatementSnapshot,
  classifyHistoricalProposal,
  normalizeKindergartenKey,
  normalizeKindergartenName,
  type ProposalAmountSnapshot,
  type StatementItemInput,
} from '../src/lib/comparison-proposal-history'
import { estimateSsgTotal } from '../src/lib/unit-conversion'

config({ path: '.env.local' })

const apply = process.argv.includes('--apply')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) throw new Error('.env.local의 Supabase 환경변수가 필요합니다.')
const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

interface SessionRow {
  id: string
  name: string
  kindergarten_name: string | null
  supplier: string | null
  current_step: string | null
  proposal_extras: Record<string, unknown> | null
  price_book_period: string | null
  updated_at: string
}

interface HistoricalItem {
  session_id: string
  extracted_name: string | null
  extracted_spec: string | null
  extracted_origin: string | null
  extracted_unit: string | null
  extracted_quantity: number | string | null
  extracted_unit_price: number | string | null
  extracted_supply_amount: number | string | null
  extracted_tax_amount: number | string | null
  extracted_total_price: number | string | null
  standard_price: number | string | null
  match_status: string | null
  is_excluded: boolean | null
  adjusted_quantity: number | string | null
  adjusted_unit_weight_g: number | string | null
  source: { supplier_name?: string | null } | Array<{ supplier_name?: string | null }> | null
  matched_product: {
    supplier?: string | null
    spec_quantity?: number | string | null
    spec_unit?: string | null
    ppu?: number | string | null
    tax_type?: string | null
  } | Array<{
    supplier?: string | null
    spec_quantity?: number | string | null
    spec_unit?: string | null
    ppu?: number | string | null
    tax_type?: string | null
  }> | null
}

function relation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

function extrasAnnual(extras: Record<string, unknown>): number {
  const children = Math.max(0, Number(extras.children_count ?? 100))
  const items = Array.isArray(extras.items) ? extras.items : []
  let total = 0
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    if (item.checked !== true) continue
    const count = Math.max(0, Number(item.count ?? 0))
    const unitPrice = Math.max(0, Number(item.unit_price ?? 0))
    const multiplier = Math.max(0, Number(item.multiplier ?? 1))
    let perRound: number
    if (item.key === 'coffee' || item.algo === 'coffee_truck') {
      perRound = children <= 50
        ? 530_000
        : Math.ceil((Math.ceil(children * (multiplier || 2)) * (unitPrice || 3500) + 168_000) / 100_000) * 100_000
    } else {
      perRound = unitPrice * (item.per_child === false ? 1 : children) * multiplier
    }
    total += perRound * count
  }
  return total
}

function amountSnapshot(items: HistoricalItem[], extras: Record<string, unknown>): ProposalAmountSnapshot {
  const supplyRateRaw = Number(extras.supply_rate ?? 1.25)
  const supplyRate = Number.isFinite(supplyRateRaw) && supplyRateRaw > 0 ? supplyRateRaw : 1.25
  let monthlyExistingAmount = 0
  let monthlyProposedAmount = 0
  for (const item of items) {
    const product = relation(item.matched_product)
    const confirmed = item.match_status === 'auto_matched' || item.match_status === 'manual_matched'
    if (!confirmed || item.is_excluded === true || product?.supplier !== 'SHINSEGAE') continue
    const quantity = Number(item.extracted_quantity ?? 0)
    const existing = Math.round(item.extracted_total_price == null
      ? Number(item.extracted_unit_price ?? 0) * quantity
      : Number(item.extracted_total_price))
    const proposed = Math.round(estimateSsgTotal({
      extracted_quantity: quantity,
      adjusted_quantity: item.adjusted_quantity == null ? undefined : Number(item.adjusted_quantity),
      adjusted_unit_weight_g: item.adjusted_unit_weight_g == null ? undefined : Number(item.adjusted_unit_weight_g),
      ssg_match: {
        standard_price: Number(item.standard_price ?? 0),
        spec_quantity: product.spec_quantity == null ? null : Number(product.spec_quantity),
        spec_unit: product.spec_unit,
        ppu: product.ppu == null ? null : Number(product.ppu),
        tax_type: product.tax_type ?? undefined,
      },
    }) * supplyRate)
    monthlyExistingAmount += existing
    monthlyProposedAmount += proposed
  }
  const monthlySavings = monthlyExistingAmount - monthlyProposedAmount
  return {
    monthlyExistingAmount,
    monthlyProposedAmount,
    monthlySavings,
    annualExistingAmount: monthlyExistingAmount * 12,
    annualProposedAmount: monthlyProposedAmount * 12,
    annualSavings: monthlySavings * 12,
    savingsPercent: monthlyExistingAmount > 0 ? (monthlySavings / monthlyExistingAmount) * 100 : 0,
    supplyRate,
    totalExtrasAnnual: extrasAnnual(extras),
  }
}

async function loadAllItems(sessionIds: string[]): Promise<HistoricalItem[]> {
  const result: HistoricalItem[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('audit_items')
      .select('session_id, extracted_name, extracted_spec, extracted_origin, extracted_unit, extracted_quantity, extracted_unit_price, extracted_supply_amount, extracted_tax_amount, extracted_total_price, standard_price, match_status, is_excluded, adjusted_quantity, adjusted_unit_weight_g, source:comparison_sources!source_id(supplier_name), matched_product:products!matched_product_id(supplier, spec_quantity, spec_unit, ppu, tax_type)')
      .in('session_id', sessionIds)
      .range(from, from + pageSize - 1)
    if (error) throw error
    const page = (data ?? []) as HistoricalItem[]
    result.push(...page)
    if (page.length < pageSize) break
  }
  return result
}

async function main() {
  const { data, error } = await db
    .from('audit_sessions')
    .select('id, name, kindergarten_name, supplier, current_step, proposal_extras, price_book_period, updated_at')
    .order('updated_at', { ascending: true })
  if (error) throw error
  const candidates = ((data ?? []) as SessionRow[]).flatMap((session) => {
    const classification = classifyHistoricalProposal({
      currentStep: session.current_step,
      proposalExtras: session.proposal_extras,
    })
    return classification ? [{ session, classification }] : []
  })
  if (candidates.length === 0) {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates: 0, inserted: 0 }))
    return
  }
  const items = await loadAllItems(candidates.map(({ session }) => session.id))
  const bySession = new Map<string, HistoricalItem[]>()
  for (const item of items) {
    const bucket = bySession.get(item.session_id) ?? []
    bucket.push(item)
    bySession.set(item.session_id, bucket)
  }

  let inserted = 0
  let duplicate = 0
  const confidence = { high: 0, medium: 0, low: 0 }
  const months: Record<string, number> = {}
  for (const { session, classification } of candidates) {
    confidence[classification.confidence]++
    const month = session.updated_at.slice(0, 7)
    months[month] = (months[month] ?? 0) + 1
    if (!apply) continue

    const sessionItems = bySession.get(session.id) ?? []
    const extras = session.proposal_extras ?? {}
    const rawName = String(extras.proposed_to ?? session.kindergarten_name ?? session.name)
    const statementItems: StatementItemInput[] = sessionItems.map((item) => {
      const source = relation(item.source)
      const quantity = Number(item.extracted_quantity ?? 0)
      return {
        supplier: source?.supplier_name || session.supplier || '',
        name: item.extracted_name,
        spec: item.extracted_spec,
        origin: item.extracted_origin,
        unit: item.extracted_unit,
        quantity,
        unitPrice: Number(item.extracted_unit_price ?? 0),
        supplyAmount: Number(item.extracted_supply_amount ?? 0),
        taxAmount: Number(item.extracted_tax_amount ?? 0),
        totalPrice: item.extracted_total_price == null
          ? Number(item.extracted_unit_price ?? 0) * quantity
          : Number(item.extracted_total_price),
      }
    })
    const statement = buildStatementSnapshot(statementItems)
    const basis = [...classification.basis, 'current_session_snapshot', 'amount_reconstructed']
    const { data: rpcData, error: rpcError } = await db.rpc('record_comparison_proposal_version', {
      p_session_id: session.id,
      p_kindergarten_name: normalizeKindergartenName(rawName),
      p_kindergarten_key: normalizeKindergartenKey(rawName),
      p_target_period: String(extras.based_on_period ?? session.price_book_period ?? ''),
      p_issue_format: 'historical_estimate',
      p_idempotency_key: `historical:${session.id}`,
      p_statement_hash: statement.hash,
      p_statement_snapshot: statement,
      p_amount_snapshot: amountSnapshot(sessionItems, extras),
      p_change_reasons: ['과거 활동 근거 기반 최초 추정'],
      p_is_estimated: true,
      p_estimate_confidence: classification.confidence,
      p_estimate_basis: basis,
      p_issued_by: null,
      p_issued_at: session.updated_at,
    })
    if (rpcError) throw rpcError
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (row?.duplicate) duplicate++
    else inserted++
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    candidates: candidates.length,
    inserted,
    duplicate,
    confidence,
    months,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

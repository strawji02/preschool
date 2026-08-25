import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { withPeriodPrices } from '@/features/shared/price-book'
import {
  chooseLearnedDecision,
  normalizeComparisonMatchKey,
  type LearnedDecisionEvidence,
  type LearnedDecisionScope,
} from '@/lib/comparison-match-learning'
import type { ExtractedItem, SupplierMatch } from '@/types/audit'

interface MatchMemoryRow {
  source_supplier_key: string
  name_key: string
  spec_key: string
  origin_key: string
  unit_key: string
  product_id: string
  confirmation_count: number
}

interface SessionDecisionRow {
  extracted_name: string
  extracted_spec: string | null
  extracted_origin: string | null
  extracted_unit: string | null
  matched_product_id: string
}

export interface LearnedComparisonRecommendation {
  candidate: SupplierMatch
  source: 'session_exact' | 'history_supplier' | 'history_global'
  evidenceCount: number
}

function signature(item: Pick<ExtractedItem, 'name' | 'spec' | 'origin' | 'unit'>): string {
  return [item.name, item.spec, item.origin, item.unit]
    .map(normalizeComparisonMatchKey)
    .join('|')
}

function memorySignature(row: MatchMemoryRow): string {
  return [row.name_key, row.spec_key, row.origin_key, row.unit_key].join('|')
}

function sessionSignature(row: SessionDecisionRow): string {
  return [row.extracted_name, row.extracted_spec, row.extracted_origin, row.extracted_unit]
    .map(normalizeComparisonMatchKey)
    .join('|')
}

function sourceLabel(scope: LearnedDecisionScope): LearnedComparisonRecommendation['source'] {
  if (scope === 'session') return 'session_exact'
  return scope === 'supplier' ? 'history_supplier' : 'history_global'
}

/**
 * 한 분석 배치의 품목을 한 번에 조회한다. 기존 매칭 검색이 품목별로 수행되더라도
 * 학습 기억은 배치당 2회(현재 세션 + 과거 집계)만 읽는다.
 */
export async function loadLearnedComparisonRecommendations(input: {
  supabase: SupabaseClient
  sessionId: string
  sourceSupplierName: string
  items: readonly ExtractedItem[]
  priceBookPeriod?: string | null
}): Promise<Array<LearnedComparisonRecommendation | null>> {
  const { supabase, sessionId, items, priceBookPeriod } = input
  if (items.length === 0) return []

  const nameKeys = [...new Set(items.map((item) => normalizeComparisonMatchKey(item.name)).filter(Boolean))]
  const supplierKey = normalizeComparisonMatchKey(input.sourceSupplierName)

  const [sessionResult, memoryResult] = await Promise.all([
    supabase
      .from('audit_items')
      .select('extracted_name, extracted_spec, extracted_origin, extracted_unit, matched_product_id')
      .eq('session_id', sessionId)
      .eq('match_status', 'manual_matched')
      .not('matched_product_id', 'is', null),
    supabase
      .from('comparison_match_memory')
      .select('source_supplier_key, name_key, spec_key, origin_key, unit_key, product_id, confirmation_count')
      .in('name_key', nameKeys)
      .in('source_supplier_key', supplierKey ? [supplierKey, '*'] : ['*']),
  ])

  // 마이그레이션 직후가 아닌 개발 환경에서도 기존 알고리즘은 계속 동작해야 한다.
  const sessionRows = (sessionResult.data ?? []) as SessionDecisionRow[]
  const memoryRows = (memoryResult.data ?? []) as MatchMemoryRow[]

  const sessionBySignature = new Map<string, Map<string, number>>()
  for (const row of sessionRows) {
    const key = sessionSignature(row)
    const counts = sessionBySignature.get(key) ?? new Map<string, number>()
    counts.set(row.matched_product_id, (counts.get(row.matched_product_id) ?? 0) + 1)
    sessionBySignature.set(key, counts)
  }

  const memoryBySignature = new Map<string, MatchMemoryRow[]>()
  for (const row of memoryRows) {
    const key = memorySignature(row)
    const rows = memoryBySignature.get(key) ?? []
    rows.push(row)
    memoryBySignature.set(key, rows)
  }

  const selections = items.map((item) => {
    const key = signature(item)
    const evidence: LearnedDecisionEvidence[] = []
    for (const [productId, confirmations] of sessionBySignature.get(key) ?? []) {
      evidence.push({ productId, confirmations, scope: 'session' })
    }
    for (const row of memoryBySignature.get(key) ?? []) {
      evidence.push({
        productId: row.product_id,
        confirmations: Number(row.confirmation_count),
        scope: row.source_supplier_key === supplierKey && supplierKey ? 'supplier' : 'global',
      })
    }
    return chooseLearnedDecision(evidence)
  })

  const productIds = [...new Set(selections.flatMap((selected) => selected ? [selected.productId] : []))]
  if (productIds.length === 0) return items.map(() => null)

  const { data: products, error: productError } = await supabase
    .from('products')
    .select(
      'id, product_name, standard_price, product_code, spec_quantity, spec_unit, unit_normalized, tax_type, category, origin, origin_detail, spec_raw, unit_raw, subcategory, storage_temp, supplier, is_active, is_food',
    )
    .in('id', productIds)
    .eq('supplier', 'SHINSEGAE')

  if (productError) throw new Error(`학습 매핑 상품 조회 실패: ${productError.message}`)

  const active = (products ?? []).filter((row) => row.is_active !== false && row.is_food !== false)
  const priced = await withPeriodPrices(
    active.map((row) => ({ ...row, standard_price: Number(row.standard_price ?? 0) })),
    priceBookPeriod,
  )
  const productById = new Map(priced.map((row) => [row.id as string, row]))

  return selections.map((selected) => {
    if (!selected) return null
    const product = productById.get(selected.productId)
    if (!product) return null
    return {
      source: sourceLabel(selected.scope),
      evidenceCount: selected.confirmations,
      candidate: {
        id: product.id as string,
        product_name: product.product_name ?? '',
        standard_price: Number(product.standard_price ?? 0),
        match_score: 1,
        product_code: product.product_code ?? undefined,
        spec_quantity: product.spec_quantity ?? undefined,
        spec_unit: product.spec_unit ?? undefined,
        unit_normalized: product.unit_normalized ?? undefined,
        tax_type: product.tax_type ?? undefined,
        category: product.category ?? undefined,
        origin: product.origin ?? undefined,
        origin_detail: product.origin_detail ?? undefined,
        spec_raw: product.spec_raw ?? undefined,
        unit_raw: product.unit_raw ?? undefined,
        subcategory: product.subcategory ?? undefined,
        storage_temp: product.storage_temp ?? undefined,
        priceBookMissing: product.priceBookMissing,
      },
    }
  })
}

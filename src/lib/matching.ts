import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchResult, MatchCandidate, Supplier, SupplierMatch, SavingsResult, MatchStatus } from '@/types/audit'
import { preprocessKoreanFoodName, dualNormalize } from '@/lib/preprocessing'

// Matching thresholds
const AUTO_MATCH_THRESHOLD = 0.8
const PENDING_THRESHOLD = 0.3

// Search mode
type SearchMode = 'trigram' | 'hybrid' | 'bm25'
const SEARCH_MODE: SearchMode = process.env.NEXT_PUBLIC_SEARCH_MODE as SearchMode || 'hybrid'

interface RpcResult {
  id: string
  product_name: string
  standard_price: number
  unit_normalized: string
  spec_quantity: number | null
  spec_unit: string | null
  supplier: string
  match_score: number
  ppu: number | null
  standard_unit: string | null
}

/**
 * 품목명 정규화 - 노이즈 제거로 매칭 정확도 향상
 *
 * Phase 1 개선: 한국어 특화 전처리 적용
 * - 조사 제거 (은/는/이/가)
 * - 맞춤법 통일 (초콜렛→초콜릿)
 * - 기존 로직 유지
 */
export function normalizeItemName(name: string): string {
  // Phase 1: 한국어 특화 전처리 사용
  return preprocessKoreanFoodName(name, {
    removeParticles: true,
    normalizeSpelling: true,
    normalizeBrands: false,
    removeNumbers: true,
    removeSpecialChars: true,
  })
}

// 전체 DB 검색 (Phase 1: Hybrid Search 지원)
export async function findMatches(
  itemName: string,
  supabase: SupabaseClient,
  searchMode: SearchMode = SEARCH_MODE
): Promise<MatchResult> {
  try {
    // Dual Normalization: BM25용 vs Semantic용
    const { forKeyword, forSemantic } = dualNormalize(itemName)
    console.log(`  [Matching] Mode: ${searchMode}`)
    console.log(`  [Matching] Raw: "${itemName}"`)
    console.log(`  [Matching] Keyword: "${forKeyword}" | Semantic: "${forSemantic}"`)

    let candidates: RpcResult[] = []
    let error: any = null

    if (searchMode === 'hybrid') {
      // Phase 1: Hybrid Search (BM25 + Trigram with RRF)
      const result = await supabase.rpc('search_products_hybrid', {
        search_term_raw: itemName,
        search_term_clean: forKeyword, // BM25용
        limit_count: 5,
        bm25_weight: 0.5, // 50% BM25
        semantic_weight: 0.5, // 50% Semantic
      })
      candidates = result.data as RpcResult[]
      error = result.error
    } else if (searchMode === 'bm25') {
      // BM25 only (키워드 검색)
      const result = await supabase.rpc('search_products_bm25', {
        search_term: forKeyword,
        limit_count: 5,
      })
      candidates = result.data as RpcResult[]
      error = result.error
    } else {
      // Legacy: Trigram only (기존 방식)
      const result = await supabase.rpc('search_products_fuzzy', {
        search_term_raw: itemName,
        search_term_clean: forSemantic,
        limit_count: 5,
      })
      candidates = result.data as RpcResult[]
      error = result.error
    }

    if (error) {
      console.error('RPC error:', error.message)
      return { status: 'unmatched' }
    }

    if (!candidates || candidates.length === 0) {
      return { status: 'unmatched' }
    }

    const matchCandidates: MatchCandidate[] = candidates.map((c) => ({
      id: c.id,
      product_name: c.product_name,
      standard_price: c.standard_price,
      unit_normalized: c.unit_normalized,
      spec_quantity: c.spec_quantity ?? undefined,
      spec_unit: c.spec_unit ?? undefined,
      supplier: c.supplier as Supplier,
      match_score: c.match_score,
      ppu: c.ppu ?? undefined,
      standard_unit: c.standard_unit ?? undefined,
    }))

    const topScore = matchCandidates[0].match_score

    // Tier 1: Auto-match (> 0.8)
    if (topScore > AUTO_MATCH_THRESHOLD) {
      return {
        status: 'auto_matched',
        best_match: matchCandidates[0],
        candidates: matchCandidates.slice(1),
      }
    }

    // Tier 2: Pending (0.3 ~ 0.8)
    if (topScore >= PENDING_THRESHOLD) {
      return {
        status: 'pending',
        candidates: matchCandidates,
      }
    }

    // Tier 3: Unmatched (< 0.3)
    return { status: 'unmatched' }
  } catch (error) {
    console.error('Matching error:', error)
    return { status: 'unmatched' }
  }
}

// Calculate loss amount (savings potential)
export function calculateLoss(
  extractedUnitPrice: number,
  standardPrice: number,
  quantity: number
): number {
  const priceDiff = extractedUnitPrice - standardPrice
  if (priceDiff <= 0) return 0
  return priceDiff * quantity
}

// ========================================
// Side-by-Side Comparison Functions
// ========================================

interface ComparisonMatchResult {
  cj_match?: SupplierMatch      // Top 1 (자동 선택)
  ssg_match?: SupplierMatch     // Top 1 (자동 선택)
  cj_candidates: SupplierMatch[]  // Top 5 후보
  ssg_candidates: SupplierMatch[] // Top 5 후보
  status: MatchStatus
}

/**
 * 공급사별 병렬 매칭 - CJ와 SSG 각각 Top 5 후보 검색
 * Phase 1: Hybrid Search 지원
 */
export async function findComparisonMatches(
  itemName: string,
  supabase: SupabaseClient,
  searchMode: SearchMode = SEARCH_MODE
): Promise<ComparisonMatchResult> {
  try {
    const { forKeyword, forSemantic } = dualNormalize(itemName)
    console.log(`  [Comparison] Mode: ${searchMode}`)
    console.log(`  [Comparison] Raw: "${itemName}"`)
    console.log(`  [Comparison] Keyword: "${forKeyword}" | Semantic: "${forSemantic}"`)

    // 병렬 실행: CJ와 SSG 동시 검색 (Top 5)
    let cjResult: any
    let ssgResult: any

    if (searchMode === 'hybrid') {
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_hybrid', {
          search_term_raw: itemName,
          search_term_clean: forKeyword,
          limit_count: 5,
          supplier_filter: 'CJ',
          bm25_weight: 0.5,
          semantic_weight: 0.5,
        }),
        supabase.rpc('search_products_hybrid', {
          search_term_raw: itemName,
          search_term_clean: forKeyword,
          limit_count: 5,
          supplier_filter: 'SHINSEGAE',
          bm25_weight: 0.5,
          semantic_weight: 0.5,
        }),
      ])
    } else if (searchMode === 'bm25') {
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_bm25', {
          search_term: forKeyword,
          limit_count: 5,
          supplier_filter: 'CJ',
        }),
        supabase.rpc('search_products_bm25', {
          search_term: forKeyword,
          limit_count: 5,
          supplier_filter: 'SHINSEGAE',
        }),
      ])
    } else {
      // Legacy: Trigram
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_fuzzy', {
          search_term_raw: itemName,
          search_term_clean: forSemantic,
          limit_count: 5,
          supplier_filter: 'CJ',
        }),
        supabase.rpc('search_products_fuzzy', {
          search_term_raw: itemName,
          search_term_clean: forSemantic,
          limit_count: 5,
          supplier_filter: 'SHINSEGAE',
        }),
      ])
    }

    // 결과 매핑 - 전체 후보 배열 생성
    const cjData = cjResult.data as RpcResult[] | null
    const ssgData = ssgResult.data as RpcResult[] | null

    const cj_candidates: SupplierMatch[] = (cjData || []).map(item => ({
      id: item.id,
      product_name: item.product_name,
      standard_price: item.standard_price,
      match_score: item.match_score,
      unit_normalized: item.unit_normalized,
    }))

    const ssg_candidates: SupplierMatch[] = (ssgData || []).map(item => ({
      id: item.id,
      product_name: item.product_name,
      standard_price: item.standard_price,
      match_score: item.match_score,
      unit_normalized: item.unit_normalized,
    }))

    // Top 1 = 자동 선택
    const cj_match = cj_candidates[0]
    const ssg_match = ssg_candidates[0]

    // 상태 결정: 둘 중 하나라도 고득점이면 auto_matched
    const topScore = Math.max(
      cj_match?.match_score ?? 0,
      ssg_match?.match_score ?? 0
    )

    let status: MatchStatus = 'unmatched'
    if (topScore > AUTO_MATCH_THRESHOLD) {
      status = 'auto_matched'
    } else if (topScore >= PENDING_THRESHOLD) {
      status = 'pending'
    }

    return { cj_match, ssg_match, cj_candidates, ssg_candidates, status }
  } catch (error) {
    console.error('Comparison matching error:', error)
    return { cj_candidates: [], ssg_candidates: [], status: 'unmatched' }
  }
}

/**
 * Side-by-Side 절감액 계산
 */
export function calculateComparisonSavings(
  unitPrice: number,
  quantity: number,
  cjPrice?: number,
  ssgPrice?: number
): SavingsResult {
  // 절감액 = (내 단가 - 공급사 단가) * 수량
  // 음수면 0으로 처리 (손해 안 보는 경우)
  const cjSavings = cjPrice !== undefined
    ? Math.max(0, (unitPrice - cjPrice) * quantity)
    : 0

  const ssgSavings = ssgPrice !== undefined
    ? Math.max(0, (unitPrice - ssgPrice) * quantity)
    : 0

  const maxSavings = Math.max(cjSavings, ssgSavings)

  // 최대 절감 공급사 결정
  let best_supplier: 'CJ' | 'SHINSEGAE' | undefined
  if (maxSavings > 0) {
    if (cjSavings >= ssgSavings && cjSavings > 0) {
      best_supplier = 'CJ'
    } else if (ssgSavings > 0) {
      best_supplier = 'SHINSEGAE'
    }
  }

  return {
    cj: cjSavings,
    ssg: ssgSavings,
    max: maxSavings,
    best_supplier,
  }
}

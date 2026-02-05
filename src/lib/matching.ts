import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchResult, MatchCandidate, Supplier, SupplierMatch, SavingsResult, MatchStatus } from '@/types/audit'

// Matching thresholds
const AUTO_MATCH_THRESHOLD = 0.8
const PENDING_THRESHOLD = 0.3

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
 * 규칙:
 * 1. 괄호/대괄호 내용 제거: "[K]바라깻잎(1kg_국산)" → "바라깻잎"
 * 2. 숫자+단위 패턴 제거: "200g", "1kg", "1Kg" 등
 * 3. 특수문자 제거 (한글, 영문만 유지)
 * 4. 앞뒤 공백 제거
 */
export function normalizeItemName(name: string): string {
  return name
    // 1. 괄호 내용 제거: (...) 또는 [...]
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    // 2. 숫자+단위 패턴 제거 (1kg, 200g, 500ml 등)
    .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box)/gi, '')
    // 3. 남은 숫자 제거
    .replace(/\d+/g, '')
    // 4. 특수문자 제거 (한글, 영문, 공백만 유지)
    .replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
    // 5. 연속 공백 정리 및 trim
    .replace(/\s+/g, ' ')
    .trim()
}

// 전체 DB 검색 (Dual Search: Raw + Normalized)
export async function findMatches(
  itemName: string,
  supabase: SupabaseClient
): Promise<MatchResult> {
  try {
    // Dual Search: 원본과 정규화 둘 다 사용
    const normalizedName = normalizeItemName(itemName)
    console.log(`  [Matching] Raw: "${itemName}" | Clean: "${normalizedName}"`)

    const { data: candidates, error } = await supabase.rpc('search_products_fuzzy', {
      search_term_raw: itemName,       // 원본 (규격 포함)
      search_term_clean: normalizedName, // 정규화 (노이즈 제거)
      limit_count: 5,
    })

    if (error) {
      console.error('RPC error:', error.message)
      return { status: 'unmatched' }
    }

    if (!candidates || candidates.length === 0) {
      return { status: 'unmatched' }
    }

    const matchCandidates: MatchCandidate[] = (candidates as RpcResult[]).map((c) => ({
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
 */
export async function findComparisonMatches(
  itemName: string,
  supabase: SupabaseClient
): Promise<ComparisonMatchResult> {
  try {
    const normalizedName = normalizeItemName(itemName)
    console.log(`  [Comparison] Raw: "${itemName}" | Clean: "${normalizedName}"`)

    // 병렬 실행: CJ와 SSG 동시 검색 (Top 5)
    const [cjResult, ssgResult] = await Promise.all([
      supabase.rpc('search_products_fuzzy', {
        search_term_raw: itemName,
        search_term_clean: normalizedName,
        limit_count: 5,  // Top 5 후보
        supplier_filter: 'CJ',
      }),
      supabase.rpc('search_products_fuzzy', {
        search_term_raw: itemName,
        search_term_clean: normalizedName,
        limit_count: 5,  // Top 5 후보
        supplier_filter: 'SHINSEGAE',
      }),
    ])

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

import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchResult, MatchCandidate, Supplier } from '@/types/audit'

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
}

/**
 * 품목명 정규화 - 노이즈 제거로 매칭 정확도 향상
 *
 * 규칙:
 * 1. 괄호/대괄호 내용 제거: "얼갈이배추(계약재배)" → "얼갈이배추"
 * 2. 특수문자 제거 (한글, 영문, 숫자, 공백만 유지)
 * 3. 앞뒤 공백 제거
 */
export function normalizeItemName(name: string): string {
  return name
    // 1. 괄호 내용 제거: (...) 또는 [...]
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    // 2. 특수문자 제거 (한글, 영문, 숫자, 공백만 유지)
    .replace(/[^\uAC00-\uD7A3a-zA-Z0-9\s]/g, '')
    // 3. 연속 공백 정리 및 trim
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

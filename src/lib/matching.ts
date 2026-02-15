import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchResult, MatchCandidate, Supplier, SupplierMatch, SavingsResult, MatchStatus, ExtractedItem } from '@/types/audit'
import { preprocessKoreanFoodName, dualNormalize } from '@/lib/preprocessing'
import { generateEmbedding } from '@/lib/embedding'
import { matchWithFunnel } from '@/lib/funnel/funnel-matcher'
import type { InvoiceItem } from '@/lib/funnel/excel-parser'
import type { DBProduct } from '@/lib/funnel/price-cluster'

// Matching thresholds
const AUTO_MATCH_THRESHOLD = 0.8
const PENDING_THRESHOLD = 0.3

// Search mode
type SearchMode = 'trigram' | 'hybrid' | 'bm25' | 'semantic'
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
  similarity?: number // For semantic search (search_products_vector)
  ppu: number | null
  standard_unit: string | null
  tax_type: string | null
  category: string | null
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

    if (searchMode === 'semantic') {
      // Phase 2: Semantic Search (Vector Similarity)
      try {
        const embedding = await generateEmbedding(itemName)
        const result = await supabase.rpc('search_products_vector', {
          query_embedding: embedding,
          limit_count: 5,
          similarity_threshold: 0.3,
        })
        candidates = (result.data as RpcResult[] || []).map(c => ({
          ...c,
          match_score: c.similarity ?? 0, // Convert similarity to match_score
        }))
        error = result.error
      } catch (embedError) {
        console.error('Embedding generation failed:', embedError)
        error = embedError
      }
    } else if (searchMode === 'hybrid') {
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
// Funnel Algorithm Integration
// ========================================

/**
 * ExtractedItem을 InvoiceItem으로 변환
 */
function extractedItemToInvoiceItem(
  item: ExtractedItem,
  rowNumber: number = 1
): InvoiceItem {
  return {
    rowNumber,
    itemName: item.name,
    spec: item.spec || '',
    quantity: item.quantity,
    unitPrice: item.unit_price,
    amount: item.total_price || item.unit_price * item.quantity,
  }
}

/**
 * RpcResult를 DBProduct로 변환
 */
function rpcResultToDBProduct(result: RpcResult): DBProduct {
  return {
    id: result.id,
    name: result.product_name,
    spec: result.unit_normalized,
    price: result.standard_price,
    category: result.category || undefined,
    // 추가 정보
    supplier: result.supplier,
    match_score: result.match_score,
    tax_type: result.tax_type,
    spec_quantity: result.spec_quantity,
    spec_unit: result.spec_unit,
  }
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
 * Phase 2: Funnel Algorithm 적용 (가격 군집화 + 속성 소거법)
 */
export async function findComparisonMatches(
  itemName: string,
  supabase: SupabaseClient,
  searchMode: SearchMode = SEARCH_MODE,
  extractedItem?: ExtractedItem // 깔때기 알고리즘 적용 시 필요
): Promise<ComparisonMatchResult> {
  try {
    const { forKeyword, forSemantic } = dualNormalize(itemName)
    console.log(`  [Comparison] Mode: ${searchMode}`)
    console.log(`  [Comparison] Raw: "${itemName}"`)
    console.log(`  [Comparison] Keyword: "${forKeyword}" | Semantic: "${forSemantic}"`)

    // 병렬 실행: CJ와 SSG 동시 검색 (Top 10으로 증가 - 깔때기 필터링을 위해)
    const searchLimit = 10
    let cjResult: any
    let ssgResult: any

    if (searchMode === 'semantic') {
      // Phase 2: Semantic Search with supplier filter
      try {
        const embedding = await generateEmbedding(itemName)
        ;[cjResult, ssgResult] = await Promise.all([
          supabase.rpc('search_products_vector', {
            query_embedding: embedding,
            limit_count: searchLimit,
            supplier_filter: 'CJ',
            similarity_threshold: 0.3,
          }),
          supabase.rpc('search_products_vector', {
            query_embedding: embedding,
            limit_count: searchLimit,
            supplier_filter: 'SHINSEGAE',
            similarity_threshold: 0.3,
          }),
        ])
      } catch (embedError) {
        console.error('Embedding generation failed:', embedError)
        cjResult = { data: null, error: embedError }
        ssgResult = { data: null, error: embedError }
      }
    } else if (searchMode === 'hybrid') {
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_hybrid', {
          search_term_raw: itemName,
          search_term_clean: forKeyword,
          limit_count: searchLimit,
          supplier_filter: 'CJ',
          bm25_weight: 0.5,
          semantic_weight: 0.5,
        }),
        supabase.rpc('search_products_hybrid', {
          search_term_raw: itemName,
          search_term_clean: forKeyword,
          limit_count: searchLimit,
          supplier_filter: 'SHINSEGAE',
          bm25_weight: 0.5,
          semantic_weight: 0.5,
        }),
      ])
    } else if (searchMode === 'bm25') {
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_bm25', {
          search_term: forKeyword,
          limit_count: searchLimit,
          supplier_filter: 'CJ',
        }),
        supabase.rpc('search_products_bm25', {
          search_term: forKeyword,
          limit_count: searchLimit,
          supplier_filter: 'SHINSEGAE',
        }),
      ])
    } else {
      // Legacy: Trigram
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_fuzzy', {
          search_term_raw: itemName,
          search_term_clean: forSemantic,
          limit_count: searchLimit,
          supplier_filter: 'CJ',
        }),
        supabase.rpc('search_products_fuzzy', {
          search_term_raw: itemName,
          search_term_clean: forSemantic,
          limit_count: searchLimit,
          supplier_filter: 'SHINSEGAE',
        }),
      ])
    }

    // 결과 매핑 - DBProduct로 변환
    const cjData = cjResult.data as RpcResult[] | null
    const ssgData = ssgResult.data as RpcResult[] | null

    let cj_candidates: SupplierMatch[]
    let ssg_candidates: SupplierMatch[]

    // 깔때기 알고리즘 비활성화 - 상품명 관련성 무시 문제로 인해 비활성화
    // 문제: 깻잎 검색 시 "국내산명엽채"가 선택되는 등 엉뚱한 상품이 매칭됨
    // TODO: 상품명 유사도를 반영하도록 깔때기 알고리즘 개선 후 재활성화
    const FUNNEL_ENABLED = false  // 비활성화 - 원본 검색 결과 사용
    if (FUNNEL_ENABLED && extractedItem) {
      const invoiceItem = extractedItemToInvoiceItem(extractedItem)
      console.log(`  [Funnel] Applying funnel algorithm for: ${invoiceItem.itemName}`)
      console.log(`  [Funnel] Invoice item:`, JSON.stringify(invoiceItem))

      // CJ 후보에 대해 깔때기 적용 (에러 발생 시 fallback)
      if (cjData && cjData.length > 0) {
        try {
          const cjDBProducts = cjData.map(rpcResultToDBProduct)
          const cjFunnelResult = matchWithFunnel(invoiceItem, cjDBProducts)

          // primary (Top 3) + secondary에서 최대 5개까지
          const cjFiltered = [
            ...cjFunnelResult.primary,
            ...cjFunnelResult.secondary,
          ].slice(0, 5)

          cj_candidates = cjFiltered.map(product => ({
            id: product.id,
            product_name: product.name,
            standard_price: product.price,
            match_score: cjFunnelResult.scores.get(product.id) ?? 0,
            unit_normalized: product.spec || '',
            tax_type: product.tax_type as '과세' | '면세' | undefined,
            category: product.category,
            spec_quantity: product.spec_quantity ?? undefined,
            spec_unit: product.spec_unit ?? undefined,
            _funnelReasons: cjFunnelResult.reasons.get(product.id), // 감점 사유 (디버깅용)
          }))

          console.log(`  [Funnel] CJ: ${cjFunnelResult.primary.length} primary, ${cjFunnelResult.secondary.length} secondary`)
        } catch (funnelError) {
          console.error('  [Funnel] CJ funnel error, falling back to raw results:', funnelError)
          // Fallback: 깔때기 없이 원본 결과 사용
          cj_candidates = cjData.slice(0, 5).map(item => ({
            id: item.id,
            product_name: item.product_name,
            standard_price: item.standard_price,
            match_score: item.match_score,
            unit_normalized: item.unit_normalized,
            tax_type: item.tax_type as '과세' | '면세' | undefined,
            category: item.category ?? undefined,
            spec_quantity: item.spec_quantity ?? undefined,
            spec_unit: item.spec_unit ?? undefined,
          }))
        }
      } else {
        cj_candidates = []
      }

      // SSG 후보에 대해 깔때기 적용 (에러 발생 시 fallback)
      if (ssgData && ssgData.length > 0) {
        try {
          const ssgDBProducts = ssgData.map(rpcResultToDBProduct)
          const ssgFunnelResult = matchWithFunnel(invoiceItem, ssgDBProducts)

          const ssgFiltered = [
            ...ssgFunnelResult.primary,
            ...ssgFunnelResult.secondary,
          ].slice(0, 5)

          ssg_candidates = ssgFiltered.map(product => ({
            id: product.id,
            product_name: product.name,
            standard_price: product.price,
            match_score: ssgFunnelResult.scores.get(product.id) ?? 0,
            unit_normalized: product.spec || '',
            tax_type: product.tax_type as '과세' | '면세' | undefined,
            category: product.category,
            spec_quantity: product.spec_quantity ?? undefined,
            spec_unit: product.spec_unit ?? undefined,
            _funnelReasons: ssgFunnelResult.reasons.get(product.id),
          }))

          console.log(`  [Funnel] SSG: ${ssgFunnelResult.primary.length} primary, ${ssgFunnelResult.secondary.length} secondary`)
        } catch (funnelError) {
          console.error('  [Funnel] SSG funnel error, falling back to raw results:', funnelError)
          // Fallback: 깔때기 없이 원본 결과 사용
          ssg_candidates = ssgData.slice(0, 5).map(item => ({
            id: item.id,
            product_name: item.product_name,
            standard_price: item.standard_price,
            match_score: item.match_score,
            unit_normalized: item.unit_normalized,
            tax_type: item.tax_type as '과세' | '면세' | undefined,
            category: item.category ?? undefined,
            spec_quantity: item.spec_quantity ?? undefined,
            spec_unit: item.spec_unit ?? undefined,
          }))
        }
      } else {
        ssg_candidates = []
      }
    } else {
      // 깔때기 알고리즘 미적용 (기존 로직)
      cj_candidates = (cjData || []).slice(0, 5).map(item => ({
        id: item.id,
        product_name: item.product_name,
        standard_price: item.standard_price,
        match_score: searchMode === 'semantic' ? (item.similarity ?? 0) : item.match_score,
        unit_normalized: item.unit_normalized,
        tax_type: item.tax_type as '과세' | '면세' | undefined,
        category: item.category ?? undefined,
        spec_quantity: item.spec_quantity ?? undefined,
        spec_unit: item.spec_unit ?? undefined,
      }))

      ssg_candidates = (ssgData || []).slice(0, 5).map(item => ({
        id: item.id,
        product_name: item.product_name,
        standard_price: item.standard_price,
        match_score: searchMode === 'semantic' ? (item.similarity ?? 0) : item.match_score,
        unit_normalized: item.unit_normalized,
        tax_type: item.tax_type as '과세' | '면세' | undefined,
        category: item.category ?? undefined,
        spec_quantity: item.spec_quantity ?? undefined,
        spec_unit: item.spec_unit ?? undefined,
      }))
    }

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
 * Side-by-Side 절감액 계산 (VAT 정규화 적용)
 */
export function calculateComparisonSavings(
  unitPrice: number,
  quantity: number,
  cjPrice?: number,
  ssgPrice?: number,
  cjTaxType?: '과세' | '면세',
  ssgTaxType?: '과세' | '면세'
): SavingsResult {
  // VAT 정규화: 모든 가격을 VAT 포함 기준으로 통일
  // 과세 품목은 VAT 포함으로 정규화, 면세 품목은 그대로 사용
  const normalizedCjPrice = cjPrice !== undefined && cjTaxType
    ? cjTaxType === '과세' ? cjPrice * 1.1 : cjPrice
    : cjPrice

  const normalizedSsgPrice = ssgPrice !== undefined && ssgTaxType
    ? ssgTaxType === '과세' ? ssgPrice * 1.1 : ssgPrice
    : ssgPrice

  // 절감액 = (내 단가 - 공급사 단가) * 수량
  // 음수면 0으로 처리 (손해 안 보는 경우)
  const cjSavings = normalizedCjPrice !== undefined
    ? Math.max(0, (unitPrice - normalizedCjPrice) * quantity)
    : 0

  const ssgSavings = normalizedSsgPrice !== undefined
    ? Math.max(0, (unitPrice - normalizedSsgPrice) * quantity)
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

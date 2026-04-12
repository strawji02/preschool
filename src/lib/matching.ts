import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchResult, MatchCandidate, Supplier, SupplierMatch, SavingsResult, MatchStatus, ExtractedItem } from '@/types/audit'
import { preprocessKoreanFoodName, dualNormalize, splitCompoundWord, cleanInput, extractCoreKeyword, extractSearchHints, splitBrandCompound } from '@/lib/preprocessing'
import { expandWithSynonyms } from '@/lib/synonyms'
import { generateEmbedding } from '@/lib/embedding'
import { matchWithFunnel } from '@/lib/funnel/funnel-matcher'
import type { InvoiceItem } from '@/lib/funnel/excel-parser'
import type { DBProduct } from '@/lib/funnel/price-cluster'

// Matching thresholds
const AUTO_MATCH_THRESHOLD = 0.8
const PENDING_THRESHOLD = 0.3

// ========================================
// Domain-Specific Matching Rules
// ========================================

/**
 * 정육(축산) 카테고리 판별
 */
function isMeatItem(name: string): boolean {
  return /돈|돼지|소고기|우육|닭|계육|정육|등심|안심|삼겹|목살|갈비|사태|전지|후지|민찌|다짐/.test(name)
}

/**
 * 농산물 카테고리 판별
 */
function isProduceItem(name: string): boolean {
  return /양파|감자|당근|배추|무|파|고추|마늘|깻잎|시금치|오이|호박|가지|콩나물|브로콜리|상추/.test(name)
}

/**
 * 냉장/냉동 상태 추출
 */
function extractStorageType(name: string): '냉장' | '냉동' | null {
  if (name.includes('냉장')) return '냉장'
  if (name.includes('냉동')) return '냉동'
  return null
}

/**
 * 계란 등급 매칭: 왕란 없으면 → 특란, "특" 없으면 → "상"
 */
function getEggGradeSubstitutes(name: string): string[] {
  if (name.includes('왕란')) return ['왕란', '특란']
  if (name.includes('특란')) return ['특란', '왕란']
  if (name.includes('특')) return ['특', '상']
  if (name.includes('상')) return ['상', '특']
  return []
}

/**
 * 스파게티소스 기본값 규칙: 무수식어 → 토마토 스파게티소스
 */
function expandSauceQuery(name: string): string[] {
  if (/스파게티소스|스파게티\s*소스/.test(name) && !/토마토|크림|로제|볼로네즈|미트/.test(name)) {
    return ['토마토스파게티소스', '토마토 스파게티소스', name]
  }
  return [name]
}

/**
 * 후보 목록에 대해 도메인별 재순위 적용
 *
 * - 정육: 냉장/냉동 일치 우선, 이후 부위 매칭
 * - 농산물: 같은 원산지(국내산)일 때 중량 근접성
 * - 계란: 등급 대체 (왕란→특란, 특→상)
 * - 스파게티소스: 무수식어 → 토마토 기본
 * - 브랜드 다를 때: 저가 우선
 */
function reRankCandidates<T extends { product_name: string; standard_price: number; match_score: number }>(
  itemName: string,
  candidates: T[],
  manufacturerHint?: string | null
): T[] {
  if (candidates.length <= 1) return candidates

  const scored = candidates.map(c => ({
    candidate: c,
    bonus: 0,
  }))

  // Rule 0: 제조사/브랜드 힌트 일치 보너스 (규격에서 추출한 브랜드)
  if (manufacturerHint) {
    for (const s of scored) {
      if (s.candidate.product_name.includes(manufacturerHint)) {
        s.bonus += 0.08 // 제조사 일치 보너스
      }
    }
  }

  // Rule 1: 정육 - 냉장/냉동 일치 우선
  if (isMeatItem(itemName)) {
    const storageType = extractStorageType(itemName)
    if (storageType) {
      for (const s of scored) {
        const candidateStorage = extractStorageType(s.candidate.product_name)
        if (candidateStorage === storageType) {
          s.bonus += 0.10 // 냉장/냉동 일치 보너스 (강화)
        } else if (candidateStorage !== null && candidateStorage !== storageType) {
          s.bonus -= 0.08 // 냉장/냉동 불일치 페널티 (강화)
        }
      }
    }
  }

  // Rule 2: 농산물 - 같은 원산지 시 중량 근접 우선 (점수가 비슷한 경우)
  // (중량 정보가 product_name에 포함된 경우에만 적용)
  if (isProduceItem(itemName)) {
    const isItemDomestic = itemName.includes('국내산') || itemName.includes('국산')
    if (isItemDomestic) {
      for (const s of scored) {
        if (s.candidate.product_name.includes('국내산') || s.candidate.product_name.includes('국산')) {
          s.bonus += 0.02
        }
      }
    }
  }

  // Rule 3: 계란 등급 대체
  const eggGrades = getEggGradeSubstitutes(itemName)
  if (eggGrades.length > 0) {
    for (const s of scored) {
      const pname = s.candidate.product_name
      // 첫 번째 등급(정확 매치)에 더 높은 보너스
      if (pname.includes(eggGrades[0])) {
        s.bonus += 0.04
      } else if (eggGrades[1] && pname.includes(eggGrades[1])) {
        s.bonus += 0.02 // 대체 등급
      }
    }
  }

  // Rule 4: 브랜드 다를 때 저가 우선 (점수가 비슷한 후보들 사이에서)
  // 상위 후보들의 점수가 0.05 이내로 비슷하면 저가 우선
  const topScore = scored[0]?.candidate.match_score ?? 0
  const similarScored = scored.filter(s =>
    Math.abs(s.candidate.match_score - topScore) <= 0.05
  )
  if (similarScored.length > 1) {
    const minPrice = Math.min(...similarScored.map(s => s.candidate.standard_price))
    for (const s of similarScored) {
      if (s.candidate.standard_price === minPrice) {
        s.bonus += 0.01
      }
    }
  }

  // 보너스 적용 후 재정렬
  scored.sort((a, b) => {
    const scoreA = a.candidate.match_score + a.bonus
    const scoreB = b.candidate.match_score + b.bonus
    return scoreB - scoreA
  })

  return scored.map(s => ({
    ...s.candidate,
    match_score: Math.min(1, s.candidate.match_score + s.bonus),
  }))
}

/**
 * 복합어 분리 + 동의어 확장 + 서브브랜드 분리
 * 입력 키워드를 복합어 분리 후 각 부분의 동의어를 모두 합쳐서 반환
 * 서브브랜드(비비고, 프레스코 등)도 분리하여 본체 상품명 추출
 */
function expandWithCompoundSplitting(keyword: string): string[] {
  const tokens = keyword.split(/\s+/).filter(Boolean)
  const allTerms = new Set<string>()

  for (const token of tokens) {
    // 1. 서브브랜드 분리 시도 (비비고물만두 → 비비고 + 물만두)
    const { parts: brandParts, manufacturer } = splitBrandCompound(token)
    if (manufacturer && brandParts.length > 1) {
      // 서브브랜드가 발견되면 본체와 제조사 추가
      allTerms.add(brandParts[1]) // 본체 (물만두)
      allTerms.add(manufacturer) // 제조사 (CJ제일제당)
      // 본체에 대해서도 동의어 확장
      const expanded = expandWithSynonyms(brandParts[1])
      for (const term of expanded) {
        allTerms.add(term)
      }
    }

    // 2. 기존 접두사 복합어 분리 (냉장돈후지 → 냉장 + 돈후지)
    const parts = splitCompoundWord(token)
    for (const part of parts) {
      const expanded = expandWithSynonyms(part)
      for (const term of expanded) {
        allTerms.add(term)
      }
    }
    // 원본 토큰도 포함
    allTerms.add(token)
  }

  return Array.from(allTerms)
}

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
    const { forKeyword, forSemantic, coreKeyword } = dualNormalize(itemName)

    // Synonym expansion for better recall
    const synonymTerms = expandWithCompoundSplitting(forKeyword)
    const expandedKeyword = synonymTerms.length > 1
      ? synonymTerms.slice(0, 3).join(' ')
      : forKeyword

    // Sauce default rule
    const sauceExpanded = expandSauceQuery(itemName)
    const searchRaw = sauceExpanded.length > 1 ? sauceExpanded[0] : cleanInput(itemName).primary

    console.log(`  [Matching] Mode: ${searchMode}`)
    console.log(`  [Matching] Raw: "${itemName}"`)
    console.log(`  [Matching] Keyword: "${forKeyword}" | Core: "${coreKeyword}" | Expanded: "${expandedKeyword}" | Semantic: "${forSemantic}"`)

    let candidates: RpcResult[] = []
    let error: any = null

    if (searchMode === 'semantic') {
      // Phase 2: Semantic Search (Vector Similarity)
      try {
        const embedding = await generateEmbedding(searchRaw)
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
        search_term_raw: searchRaw,
        search_term_clean: expandedKeyword, // Synonym-expanded for better trigram recall
        limit_count: 5,
        bm25_weight: 0.5, // 50% BM25
        semantic_weight: 0.5, // 50% Semantic
      })
      candidates = result.data as RpcResult[]
      error = result.error
    } else if (searchMode === 'bm25') {
      // BM25 only (키워드 검색)
      const result = await supabase.rpc('search_products_bm25', {
        search_term: expandedKeyword,
        limit_count: 5,
      })
      candidates = result.data as RpcResult[]
      error = result.error
    } else {
      // Legacy: Trigram only (기존 방식)
      const result = await supabase.rpc('search_products_fuzzy', {
        search_term_raw: searchRaw,
        search_term_clean: expandedKeyword,
        limit_count: 5,
      })
      candidates = result.data as RpcResult[]
      error = result.error
    }

    if (error) {
      console.error('RPC error:', error.message)
      return { status: 'unmatched' }
    }

    // Fallback search: 결과 없거나 낮은 점수일 때 코어 키워드로 재검색
    const topCandidateScore = candidates?.[0]?.match_score ?? 0
    const needsFallback = (!candidates || candidates.length === 0 || topCandidateScore < 0.3)
      && coreKeyword !== forKeyword && coreKeyword.length >= 2

    if (needsFallback) {
      console.log(`  [Matching] Fallback: trying core keyword "${coreKeyword}"`)
      const coreExpanded = expandWithCompoundSplitting(coreKeyword)
      const coreExpandedKeyword = coreExpanded.length > 1
        ? coreExpanded.slice(0, 3).join(' ')
        : coreKeyword

      let fallbackResult: any = null

      if (searchMode === 'hybrid') {
        fallbackResult = await supabase.rpc('search_products_hybrid', {
          search_term_raw: coreKeyword,
          search_term_clean: coreExpandedKeyword,
          limit_count: 5,
          bm25_weight: 0.5,
          semantic_weight: 0.5,
        })
      } else if (searchMode === 'bm25') {
        fallbackResult = await supabase.rpc('search_products_bm25', {
          search_term: coreExpandedKeyword,
          limit_count: 5,
        })
      } else if (searchMode !== 'semantic') {
        fallbackResult = await supabase.rpc('search_products_fuzzy', {
          search_term_raw: coreKeyword,
          search_term_clean: coreExpandedKeyword,
          limit_count: 5,
        })
      }

      if (fallbackResult?.data && fallbackResult.data.length > 0) {
        console.log(`  [Matching] Fallback found ${fallbackResult.data.length} candidates`)
        // Merge: prefer original if it had results, otherwise use fallback
        if (!candidates || candidates.length === 0) {
          candidates = fallbackResult.data as RpcResult[]
        } else {
          // Combine and deduplicate, keeping higher scores
          const seen = new Set(candidates.map((c: RpcResult) => c.id))
          for (const fc of fallbackResult.data as RpcResult[]) {
            if (!seen.has(fc.id)) {
              candidates.push(fc)
              seen.add(fc.id)
            }
          }
        }
      }
    }

    if (!candidates || candidates.length === 0) {
      return { status: 'unmatched' }
    }

    let matchCandidates: MatchCandidate[] = candidates.map((c) => ({
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

    // Domain-specific re-ranking
    matchCandidates = reRankCandidates(itemName, matchCandidates)

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
    const { forKeyword, forSemantic, coreKeyword } = dualNormalize(itemName)

    // Synonym-expanded search terms for better recall
    const synonymTerms = expandWithCompoundSplitting(forKeyword)
    // Sauce default rule: 스파게티소스 → 토마토 스파게티소스
    const expandedTerms = expandSauceQuery(itemName)

    // 규격에서 브랜드 추출 + 서브브랜드 분리로 검색 힌트 생성
    const specStr = extractedItem?.spec || ''
    const { searchTerms: brandHints, manufacturer } = extractSearchHints(itemName, specStr)

    // Build expanded search term (join top synonyms for broader search)
    // 브랜드 힌트가 있으면 검색 키워드에 추가 (예: '스파게티 오뚜기', '물만두 CJ제일제당')
    let expandedKeyword = synonymTerms.length > 1
      ? synonymTerms.slice(0, 3).join(' ')
      : forKeyword

    if (brandHints.length > 0) {
      // 브랜드 힌트를 검색 키워드에 결합
      const brandTerms = brandHints.filter(h => !expandedKeyword.includes(h))
      if (brandTerms.length > 0) {
        expandedKeyword = `${expandedKeyword} ${brandTerms.join(' ')}`
      }
    }

    console.log(`  [Comparison] Mode: ${searchMode}`)
    console.log(`  [Comparison] Raw: "${itemName}" | Spec: "${specStr}"`)
    console.log(`  [Comparison] Keyword: "${forKeyword}" | Core: "${coreKeyword}" | Expanded: "${expandedKeyword}" | Semantic: "${forSemantic}"`)
    if (manufacturer) {
      console.log(`  [Comparison] Brand hints: manufacturer="${manufacturer}", hints=[${brandHints.join(', ')}]`)
    }

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
      // Use expanded keyword (with synonyms) for better trigram recall
      // and cleaned itemName for BM25 (token overlap)
      const sauceExpandedH = expandSauceQuery(itemName)
      const cleanedPrimary = cleanInput(itemName).primary
      const searchRawH: string = sauceExpandedH.length > 1 ? sauceExpandedH[0] : cleanedPrimary

      ;[cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_hybrid', {
          search_term_raw: searchRawH,
          search_term_clean: expandedKeyword,
          limit_count: searchLimit,
          supplier_filter: 'CJ',
          bm25_weight: 0.5,
          semantic_weight: 0.5,
        }),
        supabase.rpc('search_products_hybrid', {
          search_term_raw: searchRawH,
          search_term_clean: expandedKeyword,
          limit_count: searchLimit,
          supplier_filter: 'SHINSEGAE',
          bm25_weight: 0.5,
          semantic_weight: 0.5,
        }),
      ])
    } else if (searchMode === 'bm25') {
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_bm25', {
          search_term: expandedKeyword,
          limit_count: searchLimit,
          supplier_filter: 'CJ',
        }),
        supabase.rpc('search_products_bm25', {
          search_term: expandedKeyword,
          limit_count: searchLimit,
          supplier_filter: 'SHINSEGAE',
        }),
      ])
    } else {
      // Legacy: Trigram - use expanded keyword for better recall
      [cjResult, ssgResult] = await Promise.all([
        supabase.rpc('search_products_fuzzy', {
          search_term_raw: itemName,
          search_term_clean: expandedKeyword,
          limit_count: searchLimit,
          supplier_filter: 'CJ',
        }),
        supabase.rpc('search_products_fuzzy', {
          search_term_raw: itemName,
          search_term_clean: expandedKeyword,
          limit_count: searchLimit,
          supplier_filter: 'SHINSEGAE',
        }),
      ])
    }

    // 결과 매핑 - DBProduct로 변환
    let cjData = cjResult.data as RpcResult[] | null
    let ssgData = ssgResult.data as RpcResult[] | null

    // Fallback search: 결과 없거나 낮은 점수일 때 코어 키워드로 재검색
    const cjTopScore = cjData?.[0]?.match_score ?? 0
    const ssgTopScore = ssgData?.[0]?.match_score ?? 0
    const needsFallback = (cjTopScore < 0.3 && ssgTopScore < 0.3)
      && coreKeyword !== forKeyword && coreKeyword.length >= 2

    if (needsFallback) {
      console.log(`  [Comparison] Fallback: trying core keyword "${coreKeyword}"`)
      const coreExpanded = expandWithCompoundSplitting(coreKeyword)
      const coreExpandedKeyword = coreExpanded.length > 1
        ? coreExpanded.slice(0, 3).join(' ')
        : coreKeyword

      let fbCjResult: any
      let fbSsgResult: any

      if (searchMode === 'hybrid') {
        ;[fbCjResult, fbSsgResult] = await Promise.all([
          supabase.rpc('search_products_hybrid', {
            search_term_raw: coreKeyword,
            search_term_clean: coreExpandedKeyword,
            limit_count: searchLimit,
            supplier_filter: 'CJ',
            bm25_weight: 0.5,
            semantic_weight: 0.5,
          }),
          supabase.rpc('search_products_hybrid', {
            search_term_raw: coreKeyword,
            search_term_clean: coreExpandedKeyword,
            limit_count: searchLimit,
            supplier_filter: 'SHINSEGAE',
            bm25_weight: 0.5,
            semantic_weight: 0.5,
          }),
        ])
      } else if (searchMode === 'bm25') {
        ;[fbCjResult, fbSsgResult] = await Promise.all([
          supabase.rpc('search_products_bm25', {
            search_term: coreExpandedKeyword,
            limit_count: searchLimit,
            supplier_filter: 'CJ',
          }),
          supabase.rpc('search_products_bm25', {
            search_term: coreExpandedKeyword,
            limit_count: searchLimit,
            supplier_filter: 'SHINSEGAE',
          }),
        ])
      } else if (searchMode !== 'semantic') {
        ;[fbCjResult, fbSsgResult] = await Promise.all([
          supabase.rpc('search_products_fuzzy', {
            search_term_raw: coreKeyword,
            search_term_clean: coreExpandedKeyword,
            limit_count: searchLimit,
            supplier_filter: 'CJ',
          }),
          supabase.rpc('search_products_fuzzy', {
            search_term_raw: coreKeyword,
            search_term_clean: coreExpandedKeyword,
            limit_count: searchLimit,
            supplier_filter: 'SHINSEGAE',
          }),
        ])
      }

      // Merge fallback results
      if (fbCjResult?.data?.length) {
        if (!cjData || cjData.length === 0) {
          cjData = fbCjResult.data
        } else {
          const seen = new Set(cjData.map((c: RpcResult) => c.id))
          for (const fc of fbCjResult.data as RpcResult[]) {
            if (!seen.has(fc.id)) { cjData.push(fc); seen.add(fc.id) }
          }
        }
      }
      if (fbSsgResult?.data?.length) {
        if (!ssgData || ssgData.length === 0) {
          ssgData = fbSsgResult.data
        } else {
          const seen = new Set(ssgData.map((c: RpcResult) => c.id))
          for (const fc of fbSsgResult.data as RpcResult[]) {
            if (!seen.has(fc.id)) { ssgData.push(fc); seen.add(fc.id) }
          }
        }
      }

      console.log(`  [Comparison] After fallback: CJ=${cjData?.length ?? 0}, SSG=${ssgData?.length ?? 0}`)
    }

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

    // Domain-specific re-ranking
    cj_candidates = reRankCandidates(itemName, cj_candidates, manufacturer)
    ssg_candidates = reRankCandidates(itemName, ssg_candidates, manufacturer)

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

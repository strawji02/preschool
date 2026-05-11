import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchResult, MatchCandidate, Supplier, SupplierMatch, SavingsResult, MatchStatus, ExtractedItem } from '@/types/audit'
import { preprocessKoreanFoodName, dualNormalize, splitCompoundWord, cleanInput, extractCoreKeyword, extractSearchHints, splitBrandCompound } from '@/lib/preprocessing'
import { cleanProductQuery, extractIdentifiers } from '@/lib/token-match'
import { expandWithSynonyms, expandBrandEquivalents } from '@/lib/synonyms'
import { generateEmbedding } from '@/lib/embedding'
import { matchWithFunnel } from '@/lib/funnel/funnel-matcher'
import type { InvoiceItem } from '@/lib/funnel/excel-parser'
import type { DBProduct } from '@/lib/funnel/price-cluster'
import { getTokenMatchRatio, MIN_VALID_MATCH_RATIO, normalizeOrigin, recoverOrigin } from '@/lib/token-match'

// Matching thresholds (legacy — used by findMatches; superseded by token-based validation in findComparisonMatches)
const AUTO_MATCH_THRESHOLD = 0.8
const PENDING_THRESHOLD = 0.3

// findComparisonMatches용 현실적 임계값 (hybrid score 분포: 0.005~0.05)
// 토큰 매칭 비율과 함께 사용하여 의미있는 매칭만 채택
const COMPARISON_MIN_SCORE = 0.005
const COMPARISON_AUTO_RATIO = 0.7    // 토큰 70%+ 매칭 → auto_matched
const COMPARISON_PENDING_RATIO = 0.4 // 토큰 40%+ 매칭 → pending

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

// ========================================
// 후보 오매칭 필터 (Susan 검수 피드백 반영)
// ========================================

/**
 * 단어 경계를 고려한 매칭
 * - 3글자 이상 키워드: substring 매칭 허용
 * - 1-2글자 키워드: 단어 시작(앞에 한글 없음) 또는 끝(뒤에 한글 없음)에서만 매칭
 *   예: "무" → "세척무"(O, suffix), "무 국내산"(O, prefix), "무항생제"(X, middle)
 */
function hasWordMatch(text: string, keyword: string): boolean {
  if (!text.includes(keyword)) return false
  if (keyword.length >= 3) return true

  const isHangul = (c: string) => c >= '가' && c <= '힣'
  let searchFrom = 0
  while (true) {
    const idx = text.indexOf(keyword, searchFrom)
    if (idx < 0) return false
    const before = idx > 0 ? text[idx - 1] : ''
    const after = idx + keyword.length < text.length ? text[idx + keyword.length] : ''
    const hasHangulBefore = isHangul(before)
    const hasHangulAfter = isHangul(after)
    // 앞뒤 모두 한글이면 복합어 중간 → 다음 위치 탐색
    if (hasHangulBefore && hasHangulAfter) {
      searchFrom = idx + 1
      continue
    }
    return true
  }
}

/**
 * 후보에서 "브랜드만 일치하고 핵심어는 하나도 안 맞는" 것들을 제외
 *
 * Susan 검수 피드백 사례:
 * - "스팸캔(CJ,1.81KG/EA)" → "CJ크레잇 프로틴바"가 1위로 올라오는 문제
 * - "카레분,순한맛(오뚜기,100G/EA)" → "오뚜기밥"이 1위로 올라오는 문제
 * - "비비고물만두(CJ)" → "CJ크레잇 프로틴바"가 1위로 올라오는 문제
 *
 * 로직:
 * - 품목명에서 추출한 비-브랜드 핵심어(coreKeywords)가 있다면,
 *   후보의 product_name에 core 중 최소 1개는 포함되어야 함
 * - 짧은 핵심어(1-2글자)는 단어 경계 체크 (hasWordMatch)
 *
 * @param candidates RPC 결과 후보 목록
 * @param coreKeywords 품목명에서 추출한 핵심어 (브랜드 제외)
 * @returns 필터를 통과한 후보들. 통과한 후보가 너무 적으면 원본 반환 (recall 안전장치)
 */
function filterCandidatesByCoreKeyword<T extends { product_name: string }>(
  candidates: T[],
  coreKeywords: string[]
): T[] {
  if (candidates.length === 0) return candidates
  if (coreKeywords.length === 0) return candidates

  const filtered = candidates.filter(c => {
    const name = c.product_name
    // 핵심어 중 최소 1개가 단어경계 매칭되어야 통과
    return coreKeywords.some(kw => hasWordMatch(name, kw))
  })

  // 필터 후 2개 이상이면 적용, 아니면 원본 유지 (recall 안전장치)
  if (filtered.length >= 2) {
    return filtered
  }
  // 1개라도 통과한 후보가 있으면 그것 + 원본 Top 일부 복원
  if (filtered.length === 1) {
    const others = candidates.filter(c => !filtered.includes(c)).slice(0, 2)
    return [...filtered, ...others]
  }
  return candidates
}

/**
 * 품목명에서 브랜드를 제외한 핵심어 배열 추출
 *
 * 예시:
 * - "카레분,순한맛" + 제조사="오뚜기" → ["카레분", "카레", "순한맛"] (오뚜기 제거)
 * - "스팸캔,DC" + 제조사="CJ" → ["스팸캔", "스팸"] (CJ, DC 제거)
 * - "비비고물만두" → ["물만두", "만두"] (비비고 제거)
 */
function extractCoreKeywordsForFilter(
  itemName: string,
  manufacturer: string | null
): string[] {
  const { primary } = cleanInput(itemName)
  const { parts } = splitBrandCompound(primary)
  const body = parts.length > 1 ? parts[1] : parts[0]

  const core = extractCoreKeyword(body)
  const coreSet = new Set<string>()
  coreSet.add(body)
  if (core && core !== body) coreSet.add(core)

  // 동의어도 추가 (스팸캔 → 스팸, 카레분 → 카레 등 표준 용어 확장)
  for (const kw of Array.from(coreSet)) {
    for (const syn of expandWithSynonyms(kw)) {
      coreSet.add(syn)
    }
  }

  // 브랜드/제조사는 핵심어가 아니므로 제외
  const brandsToRemove = new Set<string>()
  if (manufacturer) {
    for (const b of expandBrandEquivalents(manufacturer)) {
      brandsToRemove.add(b)
    }
  }

  return Array.from(coreSet).filter(kw => {
    if (kw.length < 2) return false
    if (brandsToRemove.has(kw)) return false
    return true
  })
}

// ========================================
// 도메인 재순위
// ========================================

/**
 * 규격 문자열에서 g 단위로 환산한 총 중량 추출
 * 예: "1KG" → 1000, "500G" → 500, "180G*10EA" → 1800, "100ml" → 100
 * 반환: g 단위 총량, 파싱 실패 시 null
 */
function parseSpecToGrams(spec: string | null | undefined, spec_quantity?: number | null, spec_unit?: string | null): number | null {
  // 우선 spec_quantity + spec_unit 구조화 데이터가 있으면 그것 사용
  if (spec_quantity != null && spec_unit) {
    const u = spec_unit.toUpperCase()
    if (u === 'KG' || u === 'L') return spec_quantity * 1000
    if (u === 'G' || u === 'ML') return spec_quantity
  }
  if (!spec) return null

  const normalized = spec.toUpperCase()
  // 패턴: 숫자+단위, 패키지 곱셈(예: 180G*10EA)
  const packMatch = normalized.match(/(\d+\.?\d*)\s*(KG|G|ML|L)\s*[*×]\s*(\d+)/)
  if (packMatch) {
    const qty = parseFloat(packMatch[1])
    const unit = packMatch[2]
    const pack = parseInt(packMatch[3])
    const multiplier = unit === 'KG' || unit === 'L' ? 1000 : 1
    return qty * multiplier * pack
  }
  const simpleMatch = normalized.match(/(\d+\.?\d*)\s*(KG|G|ML|L)/)
  if (simpleMatch) {
    const qty = parseFloat(simpleMatch[1])
    const unit = simpleMatch[2]
    const multiplier = unit === 'KG' || unit === 'L' ? 1000 : 1
    return qty * multiplier
  }
  return null
}

/**
 * 품목명에서 접두사+본체 분리 시도 + 동의어 정규화
 * 예: "(피제거)들깨가루" → ["피제거", "들깨가루"]
 *     "기피들깨가루" → ["기피", "들깨가루"]
 *     "순살돼지등뼈" → ["순살", "돼지등뼈"]
 */
function splitPrefixAndBody(name: string): { prefix: string | null; body: string } {
  // 괄호 내용 추출
  const bracketMatch = name.match(/\(([^)]+)\)(.+)/)
  if (bracketMatch) {
    return { prefix: bracketMatch[1].trim(), body: bracketMatch[2].trim() }
  }
  // 알려진 접두사 (동의어 그룹 기반)
  const KNOWN_PREFIXES = ['기피', '탈피', '거피', '껍질제거', '피제거', '순살', '냉장', '냉동', '전처리', '세척', '깐', '흙']
  for (const p of KNOWN_PREFIXES) {
    if (name.startsWith(p) && name.length > p.length) {
      return { prefix: p, body: name.slice(p.length) }
    }
  }
  return { prefix: null, body: name }
}

/**
 * 후보 목록에 대해 도메인별 재순위 적용 (Susan 피드백 반영, 2026-04-21)
 *
 * 기존 규칙:
 * - 정육: 냉장/냉동 일치 우선, 이후 부위 매칭
 * - 농산물: 같은 원산지(국내산)일 때 중량 근접성
 * - 계란: 등급 대체 (왕란→특란, 특→상)
 * - 스파게티소스: 무수식어 → 토마토 기본
 * - 브랜드 다를 때: 저가 우선
 *
 * 신규 규칙 (골든셋 5번 정답 1위 처리):
 * - 규격(용량) 근접도: 500G ↔ 500G +0.10, 근접 +0.05, 불일치 -0.05
 * - 단가 근접도: ≤10% +0.05, ≤30% +0.02, >100% -0.05
 * - 핵심어 접두사 동의어 일치: 피제거 ↔ 기피/탈피/거피 +0.08
 */
function reRankCandidates<T extends {
  product_name: string
  standard_price: number
  match_score: number
  spec_quantity?: number | null
  spec_unit?: string | null
  unit_normalized?: string | null
}>(
  itemName: string,
  candidates: T[],
  manufacturerHint?: string | null,
  invoiceUnitPrice?: number,
  invoiceSpec?: string
): T[] {
  if (candidates.length <= 1) return candidates

  const scored = candidates.map(c => ({
    candidate: c,
    bonus: 0,
  }))

  // Rule 0: 제조사/브랜드 힌트 일치 보너스
  if (manufacturerHint) {
    for (const s of scored) {
      if (s.candidate.product_name.includes(manufacturerHint)) {
        s.bonus += 0.08
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
          s.bonus += 0.10
        } else if (candidateStorage !== null && candidateStorage !== storageType) {
          s.bonus -= 0.08
        }
      }
    }
  }

  // Rule 2: 농산물 - 같은 원산지 시 보너스
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
      if (pname.includes(eggGrades[0])) {
        s.bonus += 0.04
      } else if (eggGrades[1] && pname.includes(eggGrades[1])) {
        s.bonus += 0.02
      }
    }
  }

  // Rule 5 (신규): 규격(용량) 근접도 보너스
  const invoiceGrams = parseSpecToGrams(invoiceSpec)
  if (invoiceGrams !== null && invoiceGrams > 0) {
    for (const s of scored) {
      const candGrams = parseSpecToGrams(
        s.candidate.unit_normalized,
        s.candidate.spec_quantity,
        s.candidate.spec_unit,
      )
      if (candGrams !== null && candGrams > 0) {
        const ratio = Math.min(invoiceGrams, candGrams) / Math.max(invoiceGrams, candGrams)
        if (ratio >= 0.95) {
          s.bonus += 0.10  // 완전 일치 (±5%)
        } else if (ratio >= 0.5) {
          s.bonus += 0.05  // 근접 (±100%)
        } else if (ratio < 0.25) {
          s.bonus -= 0.05  // 크게 불일치 (4배 이상)
        }
      }
    }
  }

  // Rule 6 (신규): 단가 근접도 보너스
  if (invoiceUnitPrice && invoiceUnitPrice > 0) {
    for (const s of scored) {
      const price = s.candidate.standard_price
      if (price > 0) {
        const diff = Math.abs(invoiceUnitPrice - price) / invoiceUnitPrice
        if (diff <= 0.10) {
          s.bonus += 0.05
        } else if (diff <= 0.30) {
          s.bonus += 0.02
        } else if (diff > 1.0) {
          s.bonus -= 0.05
        }
      }
    }
  }

  // Rule 7 (신규): 접두사 동의어 완전 일치 보너스
  // 예: 품목 "(피제거)들깨가루" → prefix="피제거", body="들깨가루"
  //     후보 "기피들깨가루" → prefix="기피", body="들깨가루"
  //     expandWithSynonyms("기피")가 "피제거" 포함하면 +0.08
  const itemSplit = splitPrefixAndBody(itemName.replace(/[()]/g, ''))
  if (itemSplit.prefix) {
    const prefixSynonyms = new Set(expandWithSynonyms(itemSplit.prefix))
    for (const s of scored) {
      const candSplit = splitPrefixAndBody(s.candidate.product_name)
      if (candSplit.prefix && prefixSynonyms.has(candSplit.prefix)) {
        // body도 유사하면 (body 포함 관계 확인)
        if (s.candidate.product_name.includes(itemSplit.body)) {
          s.bonus += 0.08
        }
      }
    }
  }

  // Rule 4: 브랜드 다를 때 저가 우선
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
 *
 * 반환 순서: 본체(product body) → 제조사 → 원본 → 접두사 동의어 (우선순위 순)
 */
function expandWithCompoundSplitting(keyword: string): string[] {
  const tokens = keyword.split(/\s+/).filter(Boolean)
  const primaryTerms: string[] = []   // 본체, 제조사 (높은 우선순위)
  const secondaryTerms: string[] = [] // 원본 토큰, 본체 동의어
  const tertiaryTerms: string[] = []  // 접두사 동의어 (낮은 우선순위)
  const seen = new Set<string>()

  const addTo = (list: string[], term: string) => {
    if (!seen.has(term)) { seen.add(term); list.push(term) }
  }

  for (const token of tokens) {
    // 1. 서브브랜드 분리 시도 (비비고물만두 → 비비고 + 물만두)
    const { parts: brandParts, manufacturer } = splitBrandCompound(token)
    if (manufacturer && brandParts.length > 1) {
      addTo(primaryTerms, brandParts[1]) // 본체 (물만두)
      addTo(primaryTerms, manufacturer) // 제조사 (CJ제일제당)
      const expanded = expandWithSynonyms(brandParts[1])
      for (const term of expanded) addTo(secondaryTerms, term)
    }

    // 2. 기존 접두사 복합어 분리 (냉장돈후지 → 냉장 + 돈후지, 전처리파인애플 → 전처리 + 파인애플)
    const parts = splitCompoundWord(token)
    if (parts.length > 1) {
      // parts[0] = 접두사, parts[1] = 본체
      addTo(primaryTerms, parts[1]) // 본체 우선
      const bodyExpanded = expandWithSynonyms(parts[1])
      for (const term of bodyExpanded) addTo(secondaryTerms, term)
      // 접두사 동의어는 낮은 우선순위
      const prefixExpanded = expandWithSynonyms(parts[0])
      for (const term of prefixExpanded) addTo(tertiaryTerms, term)
    } else {
      const expanded = expandWithSynonyms(token)
      for (const term of expanded) addTo(secondaryTerms, term)
    }
    // 원본 토큰도 포함
    addTo(secondaryTerms, token)
  }

  return [...primaryTerms, ...secondaryTerms, ...tertiaryTerms]
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
    const { forKeyword, forSemantic, coreKeyword, secondaryKeywords } = dualNormalize(itemName)

    // 서브브랜드 분리로 검색 힌트 생성
    const { searchTerms: brandHintsM, manufacturer: manufacturerM } = extractSearchHints(itemName)

    // Synonym expansion for better recall
    const synonymTerms = expandWithCompoundSplitting(forKeyword)
    if (secondaryKeywords.length > 0) {
      for (const kw of secondaryKeywords) {
        synonymTerms.push(kw)
      }
    }

    // Build expanded keyword (focused when brand splitting gives manufacturer)
    let expandedKeyword: string
    if (manufacturerM && brandHintsM.length > 0) {
      const keyTerms = [...brandHintsM]
      for (const kw of secondaryKeywords) {
        if (!keyTerms.includes(kw)) keyTerms.push(kw)
      }
      expandedKeyword = keyTerms.join(' ')
    } else {
      expandedKeyword = synonymTerms.length > 1
        ? synonymTerms.slice(0, 4).join(' ')
        : forKeyword
      // 부가 키워드(콤마 뒤: 스틱형 등)가 slice에서 잘렸을 수 있으므로 명시적으로 추가
      for (const kw of secondaryKeywords) {
        if (!expandedKeyword.includes(kw)) {
          expandedKeyword = `${expandedKeyword} ${kw}`
        }
      }
    }

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

    // Domain-specific re-ranking (제조사 힌트 전달하여 브랜드 부스트 적용)
    matchCandidates = reRankCandidates(itemName, matchCandidates, manufacturerM)

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
    const { forKeyword, forSemantic, coreKeyword, secondaryKeywords } = dualNormalize(itemName)

    // Synonym-expanded search terms for better recall
    const synonymTerms = expandWithCompoundSplitting(forKeyword)
    // 부가 키워드(콤마 뒤: 스틱형 등)도 검색에 포함
    if (secondaryKeywords.length > 0) {
      for (const kw of secondaryKeywords) {
        synonymTerms.push(kw)
      }
    }
    // Sauce default rule: 스파게티소스 → 토마토 스파게티소스
    const expandedTerms = expandSauceQuery(itemName)

    // 규격에서 브랜드 추출 + 서브브랜드 분리로 검색 힌트 생성
    const specStr = extractedItem?.spec || ''
    const { searchTerms: brandHints, manufacturer } = extractSearchHints(itemName, specStr)

    // Build expanded search term
    // 브랜드 분리가 된 경우: 본체 + 제조사를 핵심 검색어로 사용 (노이즈 최소화)
    // 예: 비비고물만두 → "물만두 CJ제일제당", 프레스코스파게티 → "스파게티 오뚜기"
    let expandedKeyword: string
    if (manufacturer && brandHints.length > 0) {
      // 브랜드 힌트(본체 + 제조사)를 중심으로 검색어 구성
      const keyTerms = [...brandHints]
      // 부가 키워드도 추가 (스틱형 등)
      for (const kw of secondaryKeywords) {
        if (!keyTerms.includes(kw)) keyTerms.push(kw)
      }
      expandedKeyword = keyTerms.join(' ')
    } else {
      expandedKeyword = synonymTerms.length > 1
        ? synonymTerms.slice(0, 4).join(' ')
        : forKeyword
      // 브랜드 힌트가 있으면 추가
      if (brandHints.length > 0) {
        const brandTerms = brandHints.filter(h => !expandedKeyword.includes(h))
        if (brandTerms.length > 0) {
          expandedKeyword = `${expandedKeyword} ${brandTerms.join(' ')}`
        }
      }
      // 부가 키워드(콤마 뒤: 스틱형 등)가 slice에서 잘렸을 수 있으므로 명시적으로 추가
      for (const kw of secondaryKeywords) {
        if (!expandedKeyword.includes(kw)) {
          expandedKeyword = `${expandedKeyword} ${kw}`
        }
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
      // 2026-05-10: cleanProductQuery로 spec/원산지 메타 사전 제거
      // (예: "세척당근(특품 200~280g/개 한국Wn※국내산)" → "세척당근")
      // 2026-05-10 (추가): spec에서 식별자 키워드(등급/인증/크기/원산지) 추출 후 결합
      // (예: name="이츠웰 신선한계란" + spec="1등급, 무항생제, 특란..."
      //  → "이츠웰 신선한계란 1등급 무항생제 특란 국내산"
      //  → OCR 변형(괄호 안에 등급)되어도 동일 매칭 결과)
      const identifiers = extractIdentifiers(`${itemName} ${specStr}`)
      const cleanedItemName = cleanProductQuery(itemName)
      const enrichedItemName = identifiers ? `${cleanedItemName} ${identifiers}` : cleanedItemName
      const sauceExpandedH = expandSauceQuery(enrichedItemName)
      const cleanedPrimary = cleanInput(enrichedItemName).primary
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

    // SHINSEGAE 단가 비교 시스템 (2026-05-04) — CJ 매칭 비활성화.
    // 검색 비용은 발생하지만 결과를 사용하지 않음 (다음 최적화에서 검색 자체 제거 예정).
    cjData = []

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

      // SHINSEGAE-only 모드: fallback 후에도 CJ는 비움 (2026-05-04)
      cjData = []
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
      // 깔때기 알고리즘 미적용 (기존 로직) - 원본 10개까지 유지하여 필터 후에도 Top 5 확보
      cj_candidates = (cjData || []).map(item => ({
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

      ssg_candidates = (ssgData || []).map(item => ({
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

    // 브랜드-only 오매칭 필터 (Susan 검수 피드백 반영)
    // 예: "스팸캔(CJ)" → "CJ 프로틴바" 차단, "카레분(오뚜기)" → "오뚜기밥" 차단
    const coreFilterKeywords = extractCoreKeywordsForFilter(itemName, manufacturer)
    if (coreFilterKeywords.length > 0) {
      const cjBefore = cj_candidates.length
      const ssgBefore = ssg_candidates.length
      cj_candidates = filterCandidatesByCoreKeyword(cj_candidates, coreFilterKeywords)
      ssg_candidates = filterCandidatesByCoreKeyword(ssg_candidates, coreFilterKeywords)
      if (cjBefore !== cj_candidates.length || ssgBefore !== ssg_candidates.length) {
        console.log(`  [CoreFilter] Filtered: CJ ${cjBefore}→${cj_candidates.length}, SSG ${ssgBefore}→${ssg_candidates.length} (core=[${coreFilterKeywords.slice(0, 5).join(',')}])`)
      }
    }

    // Domain-specific re-ranking (내 단가/규격 전달하여 근접도 보너스 적용)
    cj_candidates = reRankCandidates(
      itemName, cj_candidates, manufacturer,
      extractedItem?.unit_price, extractedItem?.spec,
    )
    ssg_candidates = reRankCandidates(
      itemName, ssg_candidates, manufacturer,
      extractedItem?.unit_price, extractedItem?.spec,
    )

    // Top 5로 최종 자르기
    cj_candidates = cj_candidates.slice(0, 5)
    ssg_candidates = ssg_candidates.slice(0, 5)

    // ── 후보 origin / spec_raw enrichment + 단종/비식자재 차단 (2026-05-04, 2026-05-11) ──
    // RPC가 origin/spec_raw/is_active/is_food 반환 안 함 → 별도 SELECT로 enrich + 차단.
    //  - is_active=false (단종): 매월 sync 후 단종된 후보가 RPC 결과에 남는 문제 차단
    //  - is_food=false (비식자재): 용기/조리도구/유니폼 등 거래명세표 무관 후보 차단
    //    NULL은 안전망으로 통과 (미분류 카테고리)
    const allCandIds = [...cj_candidates.map((c) => c.id), ...ssg_candidates.map((c) => c.id)].filter(Boolean)
    if (allCandIds.length > 0) {
      const { data: extras } = await supabase
        .from('products')
        .select('id, origin, origin_detail, spec_raw, unit_raw, storage_temp, product_code, subcategory, is_active, is_food')
        .in('id', allCandIds)
      if (extras && extras.length > 0) {
        const map = new Map<string, { origin?: string; origin_detail?: string; spec_raw?: string; unit_raw?: string; storage_temp?: string; product_code?: string; subcategory?: string }>()
        const blockedIds = new Set<string>()
        for (const e of extras) {
          if (e.is_active === false || e.is_food === false) {
            blockedIds.add(e.id as string)
            continue
          }
          map.set(e.id as string, {
            origin: e.origin as string | undefined,
            origin_detail: e.origin_detail as string | undefined,
            spec_raw: e.spec_raw as string | undefined,
            unit_raw: e.unit_raw as string | undefined,
            storage_temp: e.storage_temp as string | undefined,
            product_code: e.product_code as string | undefined,
            subcategory: e.subcategory as string | undefined,
          })
        }
        cj_candidates = cj_candidates
          .filter((c) => !blockedIds.has(c.id))
          .map((c) => ({ ...c, ...(map.get(c.id) ?? {}) }))
        ssg_candidates = ssg_candidates
          .filter((c) => !blockedIds.has(c.id))
          .map((c) => ({ ...c, ...(map.get(c.id) ?? {}) }))
      }
    }

    // ── 토큰 매칭 + 원산지 가중치 검증 (2026-05-04, 2026-05-11 origin 필드 우선) ──
    // hybrid score는 변별력 부족 (0.005~0.05). 토큰 + origin으로 의미있는 매칭 선택.
    // 콩나물 → 파인애플, 국내산 → 중국 같은 부적절 매칭 차단/후순위.
    //
    // origin 추출 우선순위 (graceful):
    //   1) extractedItem.origin (OCR이 별도 필드로 추출 — 가장 정확)
    //   2) recoverOrigin(name, spec) (fallback heuristic — spec/name 안 키워드 검색)
    //   3) normalizeOrigin(name + spec) (legacy — 마지막 안전망)
    let itemOrigin = 'UNKNOWN'
    if (extractedItem) {
      if (extractedItem.origin) {
        itemOrigin = normalizeOrigin(extractedItem.origin)
      }
      if (itemOrigin === 'UNKNOWN') {
        const recovered = recoverOrigin(extractedItem.name, extractedItem.spec)
        if (recovered) itemOrigin = normalizeOrigin(recovered)
      }
      if (itemOrigin === 'UNKNOWN') {
        itemOrigin = normalizeOrigin(`${extractedItem.name} ${extractedItem.spec ?? ''}`)
      }
    }

    // 검수 품목 tax_type — 면세 검수면 면세 후보 우선 (2026-05-11)
    const itemTaxType: '면세' | '과세' = (extractedItem?.tax_amount ?? 0) === 0 ? '면세' : '과세'

    // 토큰 + origin + tax_type 가중치로 후보 재정렬
    const reorderByOrigin = (cands: SupplierMatch[]): SupplierMatch[] => {
      return [...cands].sort((a, b) => {
        const aR = getTokenMatchRatio(itemName, a.product_name)
        const bR = getTokenMatchRatio(itemName, b.product_name)
        if (aR !== bR) return bR - aR
        // 토큰 동률 → origin 일치 우선 (item이 명확한 origin인 경우만)
        if (itemOrigin !== 'UNKNOWN') {
          // origin 컬럼 누락 시 product_name에서 추출
          const aMatch = normalizeOrigin(a.origin || a.product_name) === itemOrigin
          const bMatch = normalizeOrigin(b.origin || b.product_name) === itemOrigin
          if (aMatch !== bMatch) return aMatch ? -1 : 1
        }
        // tax_type 일치 우선 (면세 검수 → 면세 후보 우선, 2026-05-11)
        if (a.tax_type && b.tax_type && a.tax_type !== b.tax_type) {
          if (a.tax_type === itemTaxType) return -1
          if (b.tax_type === itemTaxType) return 1
        }
        return (b.match_score ?? 0) - (a.match_score ?? 0)
      })
    }
    cj_candidates = reorderByOrigin(cj_candidates)
    ssg_candidates = reorderByOrigin(ssg_candidates)

    const cj_top = cj_candidates[0]
    const ssg_top = ssg_candidates[0]
    const cjTokenRatio = cj_top ? getTokenMatchRatio(itemName, cj_top.product_name) : 0
    const ssgTokenRatio = ssg_top ? getTokenMatchRatio(itemName, ssg_top.product_name) : 0

    // 매칭 채택: 점수 + 토큰 비율 모두 통과
    const cjAccepted =
      !!cj_top &&
      (cj_top.match_score ?? 0) >= COMPARISON_MIN_SCORE &&
      cjTokenRatio >= MIN_VALID_MATCH_RATIO
    const ssgAccepted =
      !!ssg_top &&
      (ssg_top.match_score ?? 0) >= COMPARISON_MIN_SCORE &&
      ssgTokenRatio >= MIN_VALID_MATCH_RATIO

    const cj_match = cjAccepted ? cj_top : undefined
    const ssg_match = ssgAccepted ? ssg_top : undefined

    if (!cjAccepted && cj_top) {
      console.log(`  [TokenValidation] CJ 매칭 차단: "${itemName}" → "${cj_top.product_name}" (ratio=${cjTokenRatio.toFixed(2)})`)
    }
    if (!ssgAccepted && ssg_top) {
      console.log(`  [TokenValidation] SSG 매칭 차단: "${itemName}" → "${ssg_top.product_name}" (ratio=${ssgTokenRatio.toFixed(2)})`)
    }
    if (itemOrigin !== 'UNKNOWN' && ssg_match) {
      const matchOrigin = normalizeOrigin(ssg_match.origin)
      if (matchOrigin !== 'UNKNOWN' && matchOrigin !== itemOrigin) {
        console.log(`  [OriginMismatch] "${itemName}" (${itemOrigin}) → "${ssg_match.product_name}" (${matchOrigin}) — 동일 origin 후보 없어 채택`)
      }
    }

    // 상태 결정: 토큰 매칭 비율 기반
    const maxTokenRatio = Math.max(cjAccepted ? cjTokenRatio : 0, ssgAccepted ? ssgTokenRatio : 0)
    let status: MatchStatus = 'unmatched'
    if (cj_match || ssg_match) {
      if (maxTokenRatio >= COMPARISON_AUTO_RATIO) {
        status = 'auto_matched'
      } else if (maxTokenRatio >= COMPARISON_PENDING_RATIO) {
        status = 'pending'
      } else {
        // 토큰 0.3~0.4: 후보로는 표시되지만 자동 확정 안 함
        status = 'pending'
      }
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

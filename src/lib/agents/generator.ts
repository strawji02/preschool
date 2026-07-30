/**
 * Generator Agent
 *
 * Planner의 전략에 따라 실제 매칭을 수행합니다.
 * - exact: 품목명 정확 일치 → 신세계 DB 검색
 * - fuzzy: 동의어 확장 + Hybrid 검색 + 개선된 깔때기
 * - ai: LLM 기반 품목 해석 후 검색
 *
 * 깔때기 재활성화: 텍스트 유사도 40% 통합
 * - 최종점수 = 텍스트 40% + 가격 30% + 속성 30%
 * - 텍스트 유사도 30% 미만 → 후보 제외
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlannerOutput, MatchStrategy } from './planner'
import { expandWithSynonyms } from '@/lib/synonyms'
import { normalizeText } from '@/lib/preprocessing'
import { stringSimilarity } from 'string-similarity-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

export interface GeneratorInput {
  itemName: string
  spec?: string
  quantity?: number
  unitPrice?: number
  plan: PlannerOutput
}

export interface MatchCandidate {
  id: number
  product_name: string
  standard_price: number
  spec: string
  category?: string
  match_score: number
  text_similarity?: number  // 텍스트 유사도 (0-1)
  price_score?: number      // 가격 점수 (0-1)
  attribute_score?: number  // 속성 점수 (0-1)
  final_score?: number      // 최종 점수 (0-1)
  reasoning?: string        // 선정 이유
}

export interface GeneratorOutput {
  candidates: MatchCandidate[]
  top_match?: MatchCandidate
  strategy_used: MatchStrategy
  search_terms: string[]    // 실제 검색에 사용한 키워드들
}

// 로컬 DB 타입 (엑셀에서 로드한 신세계 DB)
export interface LocalProductDB {
  id: number
  category: string
  product_name: string
  spec: string
  standard_price: number
  origin?: string
  unit?: string
}

/**
 * Generator Agent 실행 (Supabase 모드)
 */
export async function generateMatches(
  input: GeneratorInput,
  supabase: SupabaseClient
): Promise<GeneratorOutput> {
  const { plan } = input

  console.log(`[Generator] Strategy: ${plan.strategy}, Category: ${plan.category}`)
  console.log(`[Generator] Keywords:`, plan.keywords)

  let candidates: MatchCandidate[] = []
  let search_terms: string[] = []

  switch (plan.strategy) {
    case 'exact':
      ({ candidates, search_terms } = await exactMatch(input, supabase))
      break
    case 'fuzzy':
      ({ candidates, search_terms } = await fuzzyMatch(input, supabase))
      break
    case 'ai':
      ({ candidates, search_terms } = await aiMatch(input, supabase))
      break
  }

  // 깔때기 알고리즘 적용: 텍스트 유사도 계산 및 최종 점수 산정
  candidates = applyFunnelScoring(input, candidates)

  // 텍스트 유사도 30% 미만 필터링
  candidates = candidates.filter(c => (c.text_similarity ?? 0) >= 0.3)

  // 최종 점수 기준 정렬
  candidates.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0))

  const top_match = candidates[0]

  return {
    candidates,
    top_match,
    strategy_used: plan.strategy,
    search_terms,
  }
}

/**
 * Generator Agent 실행 (로컬 모드 - 엑셀 DB 사용)
 */
export async function generateMatchesLocal(
  input: GeneratorInput,
  localDB: LocalProductDB[]
): Promise<GeneratorOutput> {
  const { plan } = input

  console.log(`[Generator:Local] Strategy: ${plan.strategy}, Category: ${plan.category}`)
  console.log(`[Generator:Local] Keywords:`, plan.keywords)

  let candidates: MatchCandidate[] = []
  let search_terms: string[] = []

  switch (plan.strategy) {
    case 'exact':
      ({ candidates, search_terms } = await exactMatchLocal(input, localDB))
      break
    case 'fuzzy':
      ({ candidates, search_terms } = await fuzzyMatchLocal(input, localDB))
      break
    case 'ai':
      ({ candidates, search_terms } = await aiMatchLocal(input, localDB))
      break
  }

  // 깔때기 알고리즘 적용
  candidates = applyFunnelScoring(input, candidates)

  // 텍스트 유사도 필터링 (fuzzy/ai는 완화)
  const minSimilarity = plan.strategy === 'exact' ? 0.3 : 0.15
  candidates = candidates.filter(c => (c.text_similarity ?? 0) >= minSimilarity)

  // 최종 점수 기준 정렬
  candidates.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0))

  // Top 10 제한
  candidates = candidates.slice(0, 10)

  const top_match = candidates[0]

  return {
    candidates,
    top_match,
    strategy_used: plan.strategy,
    search_terms,
  }
}

/**
 * Exact Match: 품목명 정확 일치
 */
async function exactMatch(
  input: GeneratorInput,
  supabase: SupabaseClient
): Promise<{ candidates: MatchCandidate[]; search_terms: string[] }> {
  const searchTerm = normalizeText(input.itemName)
  const search_terms = [searchTerm]

  console.log(`[Generator] Exact match: "${searchTerm}"`)

  // 신세계 DB에서 정확 일치 검색
  const { data, error } = await supabase
    .from('ssg_products')
    .select('*')
    .ilike('product_name', `%${searchTerm}%`)
    .limit(10)

  if (error || !data) {
    console.error('[Generator] Exact match error:', error)
    return { candidates: [], search_terms }
  }

  const candidates: MatchCandidate[] = data.map(item => ({
    id: item.id,
    product_name: item.product_name,
    standard_price: item.standard_price,
    spec: item.unit_normalized || '',
    category: item.category,
    match_score: 1.0, // 정확 일치
  }))

  return { candidates, search_terms }
}

/**
 * Fuzzy Match: 동의어 확장 + Hybrid 검색
 */
async function fuzzyMatch(
  input: GeneratorInput,
  supabase: SupabaseClient
): Promise<{ candidates: MatchCandidate[]; search_terms: string[] }> {
  const coreKeywords = input.plan.keywords.core || [input.itemName]

  // 동의어 확장
  const expandedTerms = coreKeywords.flatMap(kw => expandWithSynonyms(kw))
  const uniqueTerms = Array.from(new Set(expandedTerms))
  const search_terms = uniqueTerms

  console.log(`[Generator] Fuzzy match: ${uniqueTerms.join(', ')}`)

  // 각 검색어로 병렬 검색
  const searchPromises = uniqueTerms.map(async term => {
    const normalized = normalizeText(term)

    // BM25 기반 검색 (Hybrid의 키워드 부분)
    const { data } = await supabase
      .from('ssg_products')
      .select('*')
      .textSearch('product_name', normalized, {
        type: 'websearch',
        config: 'korean',
      })
      .limit(5)

    return data || []
  })

  const results = await Promise.all(searchPromises)
  const allCandidates = results.flat()

  // 중복 제거 (ID 기준)
  const uniqueCandidates = Array.from(
    new Map(allCandidates.map(item => [item.id, item])).values()
  )

  const candidates: MatchCandidate[] = uniqueCandidates.map(item => ({
    id: item.id,
    product_name: item.product_name,
    standard_price: item.standard_price,
    spec: item.unit_normalized || '',
    category: item.category,
    match_score: 0.8, // Fuzzy match
  }))

  return { candidates, search_terms }
}

/**
 * AI Match: LLM 기반 품목 해석 후 검색
 */
async function aiMatch(
  input: GeneratorInput,
  supabase: SupabaseClient
): Promise<{ candidates: MatchCandidate[]; search_terms: string[] }> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY

  if (!apiKey) {
    // Fallback to fuzzy
    console.warn('[Generator] No Gemini API key, falling back to fuzzy match')
    return fuzzyMatch(input, supabase)
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `당신은 식자재 전문가입니다. 다음 품목을 해석하여 검색 키워드를 추출하세요.

품목: "${input.itemName}"
규격: "${input.spec || 'N/A'}"

분석 항목:
1. 핵심 품목명 (브랜드, 가공상태 제외)
2. 검색 키워드 (2-5개)

JSON 형식으로 응답:
{
  "core": "핵심 품목명",
  "keywords": ["키워드1", "키워드2", "키워드3"]
}

예시:
입력: "오뚜기 카레 중간맛(피제거) 1kg"
출력: { "core": "카레", "keywords": ["카레", "카레가루", "카레분말"] }`

    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned) as { core: string; keywords: string[] }

    console.log(`[Generator] AI interpreted: ${parsed.core}, keywords: ${parsed.keywords.join(', ')}`)

    // AI가 추출한 키워드로 검색
    const searchPromises = parsed.keywords.map(async kw => {
      const normalized = normalizeText(kw)
      const { data } = await supabase
        .from('ssg_products')
        .select('*')
        .textSearch('product_name', normalized, {
          type: 'websearch',
          config: 'korean',
        })
        .limit(5)

      return data || []
    })

    const results = await Promise.all(searchPromises)
    const allCandidates = results.flat()

    const uniqueCandidates = Array.from(
      new Map(allCandidates.map(item => [item.id, item])).values()
    )

    const candidates: MatchCandidate[] = uniqueCandidates.map(item => ({
      id: item.id,
      product_name: item.product_name,
      standard_price: item.standard_price,
      spec: item.unit_normalized || '',
      category: item.category,
      match_score: 0.9, // AI match
    }))

    return { candidates, search_terms: parsed.keywords }
  } catch (error) {
    console.error('[Generator] AI match error:', error)
    // Fallback to fuzzy
    return fuzzyMatch(input, supabase)
  }
}

/**
 * 깔때기 알고리즘: 텍스트 유사도 40% + 가격 30% + 속성 30%
 * 개선: 원산지, 가공상태, 규격 속성 고려
 */
function applyFunnelScoring(
  input: GeneratorInput,
  candidates: MatchCandidate[]
): MatchCandidate[] {
  const invoiceItemName = normalizeText(input.itemName)
  const invoiceSpec = normalizeText(input.spec || '')
  const invoicePrice = input.unitPrice || 0

  return candidates.map(candidate => {
    // 1. 텍스트 유사도 (0-1)
    const candidateName = normalizeText(candidate.product_name)
    const text_similarity = stringSimilarity(invoiceItemName, candidateName)

    // 2. 가격 점수 (0-1) - 가격 범위 허용 범위 확대
    let price_score = 0
    if (invoicePrice > 0 && candidate.standard_price > 0) {
      const priceDiff = Math.abs(invoicePrice - candidate.standard_price) / invoicePrice
      // 가격 차이 50% 이내는 허용 (식자재는 시기별/규격별 변동이 큼)
      if (priceDiff < 0.5) {
        price_score = 1 - priceDiff
      } else {
        price_score = Math.max(0, 1 - priceDiff / 2)
      }
    } else {
      price_score = 0.5 // 가격 정보 없으면 중립
    }

    // 3. 속성 점수 (0-1) - 카테고리, 규격, 원산지 등 종합
    let attribute_score = 0.5 // 기본값

    // 3-1. 카테고리 일치
    let categoryScore = 0.5
    if (input.plan.category && candidate.category) {
      const categoryMatch = input.plan.category === candidate.category
      categoryScore = categoryMatch ? 1.0 : 0.3
    }

    // 3-2. 규격 유사도 (spec 필드가 있으면)
    let specScore = 0.5
    if (invoiceSpec && candidate.spec) {
      const candidateSpec = normalizeText(candidate.spec)
      // 규격에 숫자가 포함된 경우 유사도 체크
      const invoiceNumbers = invoiceSpec.match(/\d+/g)
      const candidateNumbers = candidateSpec.match(/\d+/g)

      if (invoiceNumbers && candidateNumbers) {
        // 숫자 일치도 체크 (단위 환산 고려)
        const numberMatch = invoiceNumbers.some(n => candidateNumbers.includes(n))
        specScore = numberMatch ? 0.8 : 0.3
      } else {
        // 텍스트 유사도
        specScore = stringSimilarity(invoiceSpec, candidateSpec)
      }
    }

    // 최종 속성 점수: 카테고리 60% + 규격 40%
    attribute_score = categoryScore * 0.6 + specScore * 0.4

    // 4. 최종 점수 = 텍스트 40% + 가격 30% + 속성 30%
    const final_score = text_similarity * 0.4 + price_score * 0.3 + attribute_score * 0.3

    return {
      ...candidate,
      text_similarity,
      price_score,
      attribute_score,
      final_score,
      reasoning: `텍스트:${(text_similarity * 100).toFixed(0)}%, 가격:${(price_score * 100).toFixed(0)}%, 속성:${(attribute_score * 100).toFixed(0)}%`,
    }
  })
}

/**
 * 로컬 Exact Match: 품목명 정확 일치
 */
async function exactMatchLocal(
  input: GeneratorInput,
  localDB: LocalProductDB[]
): Promise<{ candidates: MatchCandidate[]; search_terms: string[] }> {
  const searchTerm = normalizeText(input.itemName)
  const search_terms = [searchTerm]

  console.log(`[Generator:Local] Exact match: "${searchTerm}"`)

  const candidates: MatchCandidate[] = localDB
    .filter(item => {
      const productName = normalizeText(item.product_name)
      return productName.includes(searchTerm) || searchTerm.includes(productName)
    })
    .slice(0, 10)
    .map(item => ({
      id: item.id,
      product_name: item.product_name,
      standard_price: item.standard_price,
      spec: item.spec || '',
      category: item.category,
      match_score: 1.0,
    }))

  return { candidates, search_terms }
}

/**
 * 로컬 Fuzzy Match: 다단계 핵심어 추출 + 포함 검색 (완전 재작성)
 *
 * 핵심 개선:
 * 1. extractSearchKeywords로 다양한 핵심어 추출
 * 2. 각 핵심어로 DB 전체 검색 (includes 기반)
 * 3. 매칭 점수 합산 및 정렬
 */
async function fuzzyMatchLocal(
  input: GeneratorInput,
  localDB: LocalProductDB[]
): Promise<{ candidates: MatchCandidate[]; search_terms: string[] }> {
  const coreKeywords = input.plan.keywords.core || [input.itemName]

  // 다단계 핵심어 추출 (동의어 확장 포함)
  const allKeywords = new Set<string>()
  for (const kw of coreKeywords) {
    const extracted = extractSearchKeywords(kw)
    extracted.forEach(k => allKeywords.add(k))
  }

  const search_terms = Array.from(allKeywords)

  console.log(`[Generator:Local] Fuzzy match with ${search_terms.length} keywords:`, search_terms.slice(0, 10))

  // 각 핵심어로 DB 검색 (Map으로 중복 제거 및 최고 점수 유지)
  const matchResults = new Map<number, { item: LocalProductDB; bestKeyword: string; score: number }>()

  let totalChecks = 0
  let totalMatches = 0

  for (const keyword of search_terms) {
    const normalized = normalizeText(keyword)
    const normalizedNoSpace = normalized.replace(/\s+/g, '') // 공백 제거 버전

    for (const item of localDB) {
      totalChecks++
      const productName = normalizeText(item.product_name)
      const productNameNoSpace = productName.replace(/\s+/g, '') // 공백 제거 버전

      // 포함 검색 (공백 있는 버전과 없는 버전 모두 시도)
      if (productName.includes(normalized) || productNameNoSpace.includes(normalizedNoSpace)) {
        totalMatches++
        // 점수 계산
        let score = 0.7 // 기본 포함 점수

        // 정확 일치
        if (productName === normalized) {
          score = 1.0
        }
        // 품목명이 키워드로 시작
        else if (productName.startsWith(normalized)) {
          score = 0.9
        }
        // 키워드 길이가 긴 경우 (더 구체적)
        else if (normalized.length >= 4) {
          score = 0.8
        }

        // 기존 점수보다 높으면 업데이트
        const existing = matchResults.get(item.id)
        if (!existing || score > existing.score) {
          matchResults.set(item.id, { item, bestKeyword: keyword, score })
        }
      }
    }
  }

  // MatchCandidate 형식으로 변환
  const candidates: MatchCandidate[] = Array.from(matchResults.values()).map(({ item, bestKeyword, score }) => ({
    id: item.id,
    product_name: item.product_name,
    standard_price: item.standard_price,
    spec: item.spec || '',
    category: item.category,
    match_score: score,
    reasoning: `"${bestKeyword}" 매칭`,
  }))

  // 점수 순 정렬
  candidates.sort((a, b) => b.match_score - a.match_score)

  console.log(`[Generator:Local] Fuzzy search stats: ${totalChecks} checks, ${totalMatches} raw matches, ${candidates.length} unique candidates`)

  // Top 30 반환
  return { candidates: candidates.slice(0, 30), search_terms }
}

/**
 * 로컬 AI Match: LLM 기반 품목 해석 후 검색
 */
async function aiMatchLocal(
  input: GeneratorInput,
  localDB: LocalProductDB[]
): Promise<{ candidates: MatchCandidate[]; search_terms: string[] }> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY

  if (!apiKey) {
    console.warn('[Generator:Local] No Gemini API key, falling back to fuzzy')
    return fuzzyMatchLocal(input, localDB)
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `당신은 식자재 전문가입니다. 다음 품목을 해석하여 검색 키워드를 추출하세요.

품목: "${input.itemName}"
규격: "${input.spec || 'N/A'}"

분석 항목:
1. 핵심 품목명 (브랜드, 가공상태 제외)
2. 검색 키워드 (2-5개)

JSON 형식으로 응답:
{
  "core": "핵심 품목명",
  "keywords": ["키워드1", "키워드2", "키워드3"]
}

예시:
입력: "오뚜기 카레 중간맛(피제거) 1kg"
출력: { "core": "카레", "keywords": ["카레", "카레가루", "카레분말"] }`

    const result = await model.generateContent(prompt)
    const text = result.response.text()
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned) as { core: string; keywords: string[] }

    console.log(`[Generator:Local] AI interpreted: ${parsed.core}, keywords: ${parsed.keywords.join(', ')}`)

    // AI 키워드를 extractSearchKeywords로 처리 (공백 제거 + 동의어 확장)
    const expandedKeywords = new Set<string>()
    for (const kw of parsed.keywords) {
      const extracted = extractSearchKeywords(kw)
      extracted.forEach(k => expandedKeywords.add(k))
    }

    const search_terms = Array.from(expandedKeywords)
    console.log(`[Generator:Local] AI expanded keywords (${search_terms.length}):`, search_terms.slice(0, 10))

    // 확장된 키워드로 로컬 검색
    const matchResults = new Map<number, { item: LocalProductDB; bestKeyword: string; score: number }>()

    for (const keyword of search_terms) {
      const normalized = normalizeText(keyword)
      const normalizedNoSpace = normalized.replace(/\s+/g, '') // 공백 제거 버전

      for (const item of localDB) {
        const productName = normalizeText(item.product_name)
        const productNameNoSpace = productName.replace(/\s+/g, '') // 공백 제거 버전

        // 포함 검색 (공백 있는 버전과 없는 버전 모두 시도)
        if (productName.includes(normalized) || productNameNoSpace.includes(normalizedNoSpace)) {
          let score = 0.9 // AI 매칭 기본 점수

          // 정확 일치
          if (productName === normalized) {
            score = 1.0
          }
          // 품목명이 키워드로 시작
          else if (productName.startsWith(normalized)) {
            score = 0.95
          }

          // 기존 점수보다 높으면 업데이트
          const existing = matchResults.get(item.id)
          if (!existing || score > existing.score) {
            matchResults.set(item.id, { item, bestKeyword: keyword, score })
          }
        }
      }
    }

    const candidates: MatchCandidate[] = Array.from(matchResults.values()).map(({ item, bestKeyword, score }) => ({
      id: item.id,
      product_name: item.product_name,
      standard_price: item.standard_price,
      spec: item.spec || '',
      category: item.category,
      match_score: score,
      reasoning: `AI: "${bestKeyword}"`,
    }))

    candidates.sort((a, b) => b.match_score - a.match_score)

    return { candidates: candidates.slice(0, 20), search_terms }
  } catch (error) {
    console.error('[Generator:Local] AI match error:', error)
    return fuzzyMatchLocal(input, localDB)
  }
}

/**
 * 다단계 핵심어 추출 (완전 재작성)
 *
 * 핵심 아이디어:
 * 1. 원본 → 2. 쉼표 분리 → 3. 가공어 제거 → 4. 복합어 분리 → 5. 동의어 확장
 *
 * 예시:
 * - "가자미순살,가시제거99%,핀본작업" → ["가자미", "순살가자미"]
 * - "맛느타리버섯" → ["맛느타리", "느타리", "버섯", "느타리버섯"]
 * - "냉장돈민찌" → ["돈민찌", "민찌", "민찌육", "간고기"]
 * - "고구마돈가스" → ["고구마", "돈가스", "돈까스"]
 * - "무우" → ["무우", "무"]
 */
function extractSearchKeywords(itemName: string): string[] {
  const keywords = new Set<string>()

  // 1. 원본 정리: 괄호와 대괄호 제거
  let cleaned = itemName
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .trim()

  // 2. 쉼표로 분리
  const parts = cleaned.split(/[,，、]/).map(p => p.trim()).filter(p => p.length > 0)

  // 3. 가공 지시어/수식어 제거 패턴
  const REMOVE_PATTERNS = [
    // 가공 상태
    /순살/g, /가시제거\d*%?/g, /핀본작업?/g, /핀본/g,
    /스킨제거/g, /피제거/g, /시제거/g, /뼈제거/g,
    // 손질 방법
    /깍뚝썰기?/g, /깍뚝/g, /썰기/g, /컷팅/g,
    /손질/g, /전처리/g, /다듬기/g, /슬라이스/g,
    // 온도 상태
    /냉장/g, /냉동/g, /냉장돈/g, /냉동돈/g,
    // 숫자+특수문자
    /\d+%/g, /\d+g/gi, /\d+kg/gi, /\d+ml/gi,
    // 기타 수식어
    /특별사양?/g, /외식/g, /FD전용/g, /DC/g, /VB/g,
    /불고기용/g, /찌개용/g, /국거리용?/g, /튀김용/g, /카레용/g, /짜장용/g,
    /국내산/g, /수입산/g, /미국산/g, /호주산/g,
    /강원도/g, /제주/g, /고랭지/g,
    /간편/g, /손쉬운/g, /편리한/g,
    // 포장/용기 관련
    /캔$/g, /봉$/g, /팩$/g, /박스$/g,
    // 맛/숙성 관련
    /순한맛/g, /매운맛/g, /중간맛/g,
    /초숙/g, /중숙/g,
    // 형태 관련
    /스틱형/g, /볼형/g,
    // 시간 수식어
    /옛날/g, /부산/g,
    /기획절감형/g,
  ]

  // 4. 각 파트 처리
  for (let part of parts) {
    // 가공어 제거
    let core = part
    for (const pattern of REMOVE_PATTERNS) {
      core = core.replace(pattern, ' ')
    }
    core = core.replace(/\s+/g, '').trim()

    if (core.length >= 2) {
      keywords.add(core)

      // 복합어 분리 시도 (3글자 이상인 경우)
      if (core.length >= 3) {
        // "고구마돈가스" → ["고구마", "돈가스"]
        // "맛느타리버섯" → ["맛느타리", "느타리", "버섯"]
        const subParts = splitCompoundWord(core)
        subParts.forEach(sub => {
          if (sub.length >= 2) keywords.add(sub)
        })
      }
    }
  }

  // 5. 품목별 변환 규칙 (Susan님 검수 피드백 기반)
  const ITEM_TRANSFORMS: Record<string, string[]> = {
    '자른미역': ['미역', '건미역'],
    '통단무지': ['단무지'],
    '오이피클슬라이스': ['오이피클'],
    '생오이피클': ['오이피클'],
    '스팸캔': ['스팸'],
    '카레분': ['카레'],
    '볼어묵': ['어묵'],
    '돈민찌': ['다짐육', '돈다짐육'],
    '코올슬로우': ['코울슬로', '콘샐러드'],
    '코올슬로': ['코울슬로', '콘샐러드'],
  }

  for (const kw of [...keywords]) {
    for (const [pattern, transforms] of Object.entries(ITEM_TRANSFORMS)) {
      if (kw.includes(pattern)) {
        transforms.forEach(t => keywords.add(t))
      }
    }
  }

  // 6. 동의어 확장
  const expandedKeywords = new Set<string>()
  keywords.forEach(kw => {
    const normalized = normalizeText(kw)
    expandedKeywords.add(normalized)

    // 동의어 추가
    const synonyms = expandWithSynonyms(normalized)
    synonyms.forEach(syn => expandedKeywords.add(normalizeText(syn)))
  })

  return Array.from(expandedKeywords).filter(k => k.length >= 2)
}

/**
 * 복합어 분리 헬퍼
 *
 * 예시:
 * - "고구마돈가스" → ["고구마", "돈가스"]
 * - "맛느타리버섯" → ["맛느타리", "느타리", "버섯"]
 * - "마시는요구르트" → ["마시는", "요구르트"]
 */
function splitCompoundWord(word: string): string[] {
  const parts: string[] = []

  // 알려진 식자재 키워드 리스트
  const KNOWN_INGREDIENTS = [
    // 고기류
    '돈가스', '돈까스', '돈육', '돼지', '소고기', '닭고기', '영계',
    '등심', '안심', '삼겹', '목살', '후지', '전지', '민찌', '갈비',
    '등뼈', '사태',
    // 수산류
    '가자미', '고등어', '갈치', '명태', '오징어', '새우', '삼치',
    '느타리', '버섯', '표고', '팽이', '새송이',
    // 채소류
    '콩나물', '숙주', '무', '무우', '배추', '양파', '감자', '고구마', '당근',
    '시금치', '깻잎', '상추', '미나리', '부추', '대파', '쪽파',
    '브로콜리', '양배추', '오이', '피망', '가지', '호박',
    '치커리', '청경채', '알배기', '얼갈이',
    // 김치/장아찌
    '김치', '깍두기', '단무지', '피클', '오이지',
    // 가공식품
    '두부', '유부', '어묵', '맛살', '치즈', '요구르트', '우유',
    '라면', '국수', '떡', '만두', '빵', '과자',
    '스팸', '햄', '소시지', '너겟',
    // 양념/소스
    '카레', '춘장', '스파게티소스', '스프',
    // 건제품
    '미역', '당면', '김', '다시마', '멸치',
    // 과일
    '파인애플', '수박',
  ]

  // 앞에서부터 매칭 시도
  let remaining = word
  let lastPos = 0

  for (let i = 2; i <= remaining.length; i++) {
    const sub = remaining.substring(0, i)
    if (KNOWN_INGREDIENTS.includes(sub)) {
      parts.push(sub)
      remaining = remaining.substring(i)
      i = 1 // 리셋
      lastPos = 0
    }
  }

  // 남은 부분 추가
  if (remaining.length >= 2) {
    parts.push(remaining)
  }

  return parts.length > 0 ? parts : [word]
}

/**
 * [DEPRECATED] 이전 preprocessItemName 함수
 * extractSearchKeywords로 대체됨
 */
function preprocessItemName(itemName: string): string[] {
  return extractSearchKeywords(itemName)
}

/**
 * 키워드 기반 검색 (2글자 이상 명사)
 */
function searchByKeywords(
  keywords: string[],
  localDB: LocalProductDB[],
  excludeIds: Set<number>
): MatchCandidate[] {
  const matches: MatchCandidate[] = []

  // 2글자 이상 키워드만 사용
  const validKeywords = keywords.filter(kw => kw.length >= 2)

  for (const item of localDB) {
    if (excludeIds.has(item.id)) continue

    const productName = normalizeText(item.product_name)
    let matchCount = 0

    for (const kw of validKeywords) {
      if (productName.includes(kw)) {
        matchCount++
      }
    }

    // 키워드 50% 이상 매칭 시 후보 추가
    if (matchCount > 0 && matchCount / validKeywords.length >= 0.5) {
      matches.push({
        id: item.id,
        product_name: item.product_name,
        standard_price: item.standard_price,
        spec: item.spec || '',
        category: item.category,
        match_score: 0.6,
      })
    }
  }

  return matches.slice(0, 10)
}

/**
 * 배치 처리: 여러 품목 동시 매칭
 */
export async function generateMatchesBatch(
  inputs: GeneratorInput[],
  supabase: SupabaseClient
): Promise<GeneratorOutput[]> {
  const promises = inputs.map(input => generateMatches(input, supabase))
  return Promise.all(promises)
}

/**
 * 로컬 배치 처리
 */
export async function generateMatchesBatchLocal(
  inputs: GeneratorInput[],
  localDB: LocalProductDB[]
): Promise<GeneratorOutput[]> {
  const promises = inputs.map(input => generateMatchesLocal(input, localDB))
  return Promise.all(promises)
}

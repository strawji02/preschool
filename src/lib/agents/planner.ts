/**
 * Planner Agent
 *
 * 거래명세표 품목을 분석하여 매칭 전략을 수립합니다.
 * - 카테고리 추정 (농산/축산/수산/가공)
 * - 핵심 키워드 추출 (브랜드/원산지/가공상태 분리)
 * - 매칭 난이도 분류 (exact/fuzzy/ai)
 * - 매칭 전략 수립
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

export type Category = '농산' | '축산' | '수산' | '가공' | '기타'
export type MatchStrategy = 'exact' | 'fuzzy' | 'ai'

export interface PlannerInput {
  itemName: string
  spec?: string
  quantity?: number
  unitPrice?: number
}

export interface PlannerOutput {
  category: Category
  keywords: {
    core: string[]        // 핵심 품목명 (예: ["깻잎"])
    brand?: string[]      // 브랜드명 (예: ["오뚜기"])
    origin?: string[]     // 원산지 (예: ["국내산"])
    processing?: string[] // 가공상태 (예: ["피제거", "깍뚝썰기"])
  }
  strategy: MatchStrategy
  confidence: number      // 0-1, 전략 신뢰도
  reasoning: string       // 판단 근거
}

const PLANNER_PROMPT = `당신은 식자재 매칭 전문가입니다. 거래명세표의 품목을 분석하여 매칭 전략을 수립합니다.

입력 형식:
{
  "itemName": "품목명",
  "spec": "규격",
  "quantity": 수량,
  "unitPrice": 단가
}

분석 항목:
1. **카테고리 추정**: 농산/축산/수산/가공/기타 중 하나
   - 농산: 채소, 과일, 곡물
   - 축산: 돼지고기, 소고기, 닭고기, 계란
   - 수산: 생선, 해산물
   - 가공: 소스, 조미료, 가공육, 냉동식품
   - 기타: 분류 불가

2. **키워드 추출**:
   - core: 핵심 품목명 (예: 깻잎, 돼지고기, 고등어)
   - brand: 브랜드명 (예: 오뚜기, CJ, 대상, 샘표)
   - origin: 원산지 (예: 국내산, 수입산, 칠레산)
   - processing: 가공상태 (예: 피제거, 시제거, 깍뚝썰기, 냉동, 냉장)

3. **매칭 전략**:
   - exact: 품목명이 명확하고 표준화된 경우 (예: "쌀", "설탕")
   - fuzzy: 동의어나 유사 표현이 필요한 경우 (예: "돈전지" vs "앞다리살")
   - ai: 복잡한 해석이 필요한 경우 (예: "오뚜기 카레 중간맛 1kg(피제거)")

4. **신뢰도**: 0-1 사이 값 (높을수록 전략이 확실함)

5. **판단 근거**: 왜 이런 전략을 선택했는지 간단히 설명

JSON 형식으로 응답하세요:
{
  "category": "농산" | "축산" | "수산" | "가공" | "기타",
  "keywords": {
    "core": ["키워드1", "키워드2"],
    "brand": ["브랜드명"],
    "origin": ["원산지"],
    "processing": ["가공상태"]
  },
  "strategy": "exact" | "fuzzy" | "ai",
  "confidence": 0.9,
  "reasoning": "판단 근거"
}

예시:
입력: { "itemName": "깻잎", "spec": "100g", "unitPrice": 5000 }
출력: {
  "category": "농산",
  "keywords": {
    "core": ["깻잎", "깨잎"],
    "brand": [],
    "origin": [],
    "processing": []
  },
  "strategy": "fuzzy",
  "confidence": 0.9,
  "reasoning": "깻잎은 동의어(깨잎)가 존재하므로 fuzzy 전략 사용"
}

입력: { "itemName": "오뚜기 카레 중간맛(피제거)", "spec": "1kg", "unitPrice": 8000 }
출력: {
  "category": "가공",
  "keywords": {
    "core": ["카레"],
    "brand": ["오뚜기"],
    "origin": [],
    "processing": ["중간맛", "피제거"]
  },
  "strategy": "ai",
  "confidence": 0.8,
  "reasoning": "브랜드명과 가공상태가 복잡하게 섞여있어 AI 해석 필요"
}

이제 다음 품목을 분석하세요:`

/**
 * Planner Agent 실행
 */
export async function planMatching(
  input: PlannerInput
): Promise<PlannerOutput> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY

  if (!apiKey) {
    // Fallback: 규칙 기반 간단한 분류
    return fallbackPlan(input)
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const prompt = `${PLANNER_PROMPT}\n\n${JSON.stringify(input, null, 2)}`

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    // JSON 파싱
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned) as PlannerOutput

    return parsed
  } catch (error) {
    console.error('Planner Agent error:', error)
    return fallbackPlan(input)
  }
}

/**
 * Fallback: 규칙 기반 간단한 분류
 */
function fallbackPlan(input: PlannerInput): PlannerOutput {
  const name = input.itemName.toLowerCase()

  // 카테고리 추정
  let category: Category = '기타'
  if (/채소|과일|쌀|곡물|감자|양파|당근|배추|무|파|고추|마늘|깻잎|사과|배|바나나|딸기/.test(name)) {
    category = '농산'
  } else if (/돼지|소|닭|계란|달걀|육류|고기/.test(name)) {
    category = '축산'
  } else if (/생선|해산물|고등어|갈치|명태|오징어|새우|조기|참치/.test(name)) {
    category = '수산'
  } else if (/가공|소스|양념|장|기름|두부|어묵|햄|소시지/.test(name)) {
    category = '가공'
  }

  // 브랜드 추출
  const brands = ['오뚜기', 'CJ', '대상', '샘표', '청정원', '해찬들']
  const foundBrands = brands.filter(brand => name.includes(brand.toLowerCase()))

  // 원산지 추출
  const origins = ['국내산', '수입산', '미국산', '호주산', '칠레산']
  const foundOrigins = origins.filter(origin => name.includes(origin))

  // 가공상태 추출
  const processing = ['피제거', '시제거', '깍뚝썰기', '냉동', '냉장', '손질']
  const foundProcessing = processing.filter(proc => name.includes(proc))

  // 전략 결정
  let strategy: MatchStrategy = 'fuzzy'
  if (foundBrands.length > 0 || foundProcessing.length > 0) {
    strategy = 'ai'
  } else if (name.length < 5 && /^[가-힣]+$/.test(name)) {
    strategy = 'exact'
  }

  return {
    category,
    keywords: {
      core: [input.itemName],
      brand: foundBrands.length > 0 ? foundBrands : undefined,
      origin: foundOrigins.length > 0 ? foundOrigins : undefined,
      processing: foundProcessing.length > 0 ? foundProcessing : undefined,
    },
    strategy,
    confidence: 0.6,
    reasoning: 'Fallback rule-based classification',
  }
}

/**
 * 배치 처리: 여러 품목을 한번에 분석
 */
export async function planMatchingBatch(
  inputs: PlannerInput[]
): Promise<PlannerOutput[]> {
  // 병렬 처리로 성능 향상
  const promises = inputs.map(input => planMatching(input))
  return Promise.all(promises)
}

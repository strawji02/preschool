/**
 * Evaluator Agent
 *
 * Generator의 매칭 결과를 LLM으로 검증합니다.
 * - 품명 관련성 체크 (같은 식자재인지?)
 * - 규격 비교 가능성 체크
 * - 가격 합리성 체크
 * - 골든셋 few-shot 캘리브레이션 (향후)
 *
 * 판정: MATCH / MISMATCH / UNCERTAIN
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GeneratorOutput, MatchCandidate } from './generator'

export type EvaluationResult = 'MATCH' | 'MISMATCH' | 'UNCERTAIN'

export interface EvaluatorInput {
  itemName: string
  spec?: string
  unitPrice?: number
  generatorOutput: GeneratorOutput
}

export interface EvaluatorOutput {
  result: EvaluationResult
  confidence: number      // 0-1, 판정 신뢰도
  reasoning: string       // 판정 이유
  recommended_candidate?: MatchCandidate  // 추천 후보 (MATCH 또는 UNCERTAIN일 때)
  alternative_candidate?: MatchCandidate  // 대안 후보 (MISMATCH일 때)
}

const EVALUATOR_PROMPT = `당신은 식자재 매칭 검증 전문가입니다. 거래명세표의 품목과 DB 검색 결과를 비교하여 매칭이 올바른지 판정합니다.

입력 형식:
{
  "invoice": {
    "itemName": "품목명",
    "spec": "규격",
    "unitPrice": 단가
  },
  "candidate": {
    "product_name": "상품명",
    "spec": "규격",
    "standard_price": 가격,
    "match_score": 점수
  }
}

검증 항목:
1. **품명 관련성**: 같은 식자재인가?
   - MATCH: 깻잎 vs 깻잎, 돼지고기 vs 돼지고기
   - MISMATCH: 깻잎 vs 명엽채, 양파 vs 감자
   - UNCERTAIN: 카레 vs 카레가루 (형태는 다르지만 같은 범주)

2. **규격 비교 가능성**: 단위 환산이 가능한가?
   - 가능: 1kg vs 500g (무게 단위)
   - 불가능: 1kg vs 10개 (무게 vs 개수)

3. **가격 합리성**: 가격 차이가 합리적인가?
   - 합리적: 같은 품목에서 ±50% 이내
   - 의심: ±100% 초과 (재검토 필요)

판정 기준:
- **MATCH**: 품명 일치 + 규격 비교 가능 + 가격 합리적
- **MISMATCH**: 품명 불일치 (완전히 다른 품목)
- **UNCERTAIN**: 품명 유사하지만 확신 부족, 또는 가격 이상

JSON 형식으로 응답:
{
  "result": "MATCH" | "MISMATCH" | "UNCERTAIN",
  "confidence": 0.9,
  "reasoning": "판정 이유"
}

예시 1 - MATCH:
입력: {
  "invoice": { "itemName": "깻잎", "spec": "100g", "unitPrice": 5000 },
  "candidate": { "product_name": "깻잎", "spec": "100g", "standard_price": 4800 }
}
출력: {
  "result": "MATCH",
  "confidence": 0.95,
  "reasoning": "품명 일치, 규격 동일, 가격 차이 4% (합리적)"
}

예시 2 - MISMATCH:
입력: {
  "invoice": { "itemName": "깻잎", "spec": "100g", "unitPrice": 5000 },
  "candidate": { "product_name": "국내산명엽채", "spec": "1kg", "standard_price": 15000 }
}
출력: {
  "result": "MISMATCH",
  "confidence": 0.9,
  "reasoning": "깻잎과 명엽채는 다른 품목. 명엽채는 배추과 채소이며 깻잎(자소엽)과는 무관"
}

예시 3 - UNCERTAIN:
입력: {
  "invoice": { "itemName": "카레", "spec": "1kg", "unitPrice": 8000 },
  "candidate": { "product_name": "카레가루", "spec": "500g", "standard_price": 12000 }
}
출력: {
  "result": "UNCERTAIN",
  "confidence": 0.7,
  "reasoning": "카레와 카레가루는 같은 범주이나 규격(1kg vs 500g)과 가격이 애매함. 수동 검토 권장"
}

이제 다음 매칭을 평가하세요:`

/**
 * Evaluator Agent 실행
 */
export async function evaluateMatch(
  input: EvaluatorInput,
  apiKey?: string
): Promise<EvaluatorOutput> {
  // API 키 우선순위: 파라미터 > 환경변수
  const key = apiKey || process.env.GOOGLE_GEMINI_API_KEY

  if (!key) {
    // Fallback: 규칙 기반 간단한 평가
    console.warn('[Evaluator] No API key, using fallback')
    return fallbackEvaluate(input)
  }

  const candidate = input.generatorOutput.top_match

  if (!candidate) {
    return {
      result: 'MISMATCH',
      confidence: 1.0,
      reasoning: 'No matching candidate found',
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    const evalInput = {
      invoice: {
        itemName: input.itemName,
        spec: input.spec,
        unitPrice: input.unitPrice,
      },
      candidate: {
        product_name: candidate.product_name,
        spec: candidate.spec,
        standard_price: candidate.standard_price,
        match_score: candidate.final_score || candidate.match_score,
      },
    }

    const prompt = `${EVALUATOR_PROMPT}\n\n${JSON.stringify(evalInput, null, 2)}`

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    // JSON 파싱
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned) as {
      result: EvaluationResult
      confidence: number
      reasoning: string
    }

    // 추천 후보 설정
    let recommended_candidate: MatchCandidate | undefined
    let alternative_candidate: MatchCandidate | undefined

    if (parsed.result === 'MATCH' || parsed.result === 'UNCERTAIN') {
      recommended_candidate = candidate
    }

    if (parsed.result === 'MISMATCH' && input.generatorOutput.candidates.length > 1) {
      // 다음 후보 제안
      alternative_candidate = input.generatorOutput.candidates[1]
    }

    return {
      result: parsed.result,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      recommended_candidate,
      alternative_candidate,
    }
  } catch (error) {
    console.error('[Evaluator] Evaluation error:', error)
    return fallbackEvaluate(input)
  }
}

/**
 * Fallback: 규칙 기반 간단한 평가
 */
function fallbackEvaluate(input: EvaluatorInput): EvaluatorOutput {
  const candidate = input.generatorOutput.top_match

  if (!candidate) {
    return {
      result: 'MISMATCH',
      confidence: 1.0,
      reasoning: 'No candidate found',
    }
  }

  // 텍스트 유사도 기반 판정
  const textSim = candidate.text_similarity || 0
  const finalScore = candidate.final_score || candidate.match_score

  let result: EvaluationResult = 'UNCERTAIN'
  let confidence = 0.6

  if (textSim >= 0.7 && finalScore >= 0.6) {
    result = 'MATCH'
    confidence = 0.8
  } else if (textSim < 0.3) {
    result = 'MISMATCH'
    confidence = 0.7
  }

  return {
    result,
    confidence,
    reasoning: `Fallback evaluation: text_similarity=${(textSim * 100).toFixed(0)}%, final_score=${(finalScore * 100).toFixed(0)}%`,
    recommended_candidate: result !== 'MISMATCH' ? candidate : undefined,
    alternative_candidate:
      result === 'MISMATCH' && input.generatorOutput.candidates.length > 1
        ? input.generatorOutput.candidates[1]
        : undefined,
  }
}

/**
 * 배치 평가: 여러 매칭 결과를 동시에 평가 (비용 절감을 위해 배치 처리)
 * 10개씩 묶어서 처리하여 API 호출 최소화
 */
export async function evaluateMatchBatch(
  inputs: EvaluatorInput[],
  apiKey?: string,
  batchSize: number = 10
): Promise<EvaluatorOutput[]> {
  const key = apiKey || process.env.GOOGLE_GEMINI_API_KEY
  const results: EvaluatorOutput[] = []

  // 배치 단위로 처리
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize)
    const batchPromises = batch.map(input => evaluateMatch(input, key))
    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)

    // 로깅
    console.log(`[Evaluator] Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(inputs.length / batchSize)} completed`)
  }

  return results
}

/**
 * 평가 결과 요약
 */
export function summarizeEvaluations(evaluations: EvaluatorOutput[]): {
  matches: number
  mismatches: number
  uncertain: number
  matchRate: number
} {
  const matches = evaluations.filter(e => e.result === 'MATCH').length
  const mismatches = evaluations.filter(e => e.result === 'MISMATCH').length
  const uncertain = evaluations.filter(e => e.result === 'UNCERTAIN').length
  const total = evaluations.length
  const matchRate = total > 0 ? matches / total : 0

  return { matches, mismatches, uncertain, matchRate }
}

/**
 * 3-Agent Pipeline Integrator
 *
 * Planner → Generator → Evaluator 파이프라인을 통합합니다.
 * processItems(items) → 완전한 매칭 결과 반환
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { planMatching, planMatchingBatch, type PlannerInput, type PlannerOutput } from './planner'
import { generateMatches, generateMatchesBatch, type GeneratorInput, type GeneratorOutput, type MatchCandidate } from './generator'
import { evaluateMatch, evaluateMatchBatch, summarizeEvaluations, type EvaluatorInput, type EvaluatorOutput, type EvaluationResult } from './evaluator'

export interface PipelineItem {
  itemName: string
  spec?: string
  quantity?: number
  unitPrice?: number
  rowNumber?: number  // 원본 엑셀 행 번호
}

export interface PipelineResult {
  item: PipelineItem
  plan: PlannerOutput
  generation: GeneratorOutput
  evaluation: EvaluatorOutput
  status: 'matched' | 'uncertain' | 'failed'
  final_candidate?: MatchCandidate
}

export interface PipelineSummary {
  total: number
  matched: number
  uncertain: number
  failed: number
  matchRate: number
  avgConfidence: number
  executionTime: number
}

/**
 * 단일 품목 처리
 */
export async function processItem(
  item: PipelineItem,
  supabase: SupabaseClient
): Promise<PipelineResult> {
  const startTime = Date.now()

  try {
    // Step 1: Planner - 매칭 전략 수립
    console.log(`\n[Pipeline] Processing: ${item.itemName}`)
    const plannerInput: PlannerInput = {
      itemName: item.itemName,
      spec: item.spec,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    }
    const plan = await planMatching(plannerInput)
    console.log(`[Pipeline] Plan: ${plan.strategy} (${plan.category})`)

    // Step 2: Generator - 매칭 실행
    const generatorInput: GeneratorInput = {
      itemName: item.itemName,
      spec: item.spec,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      plan,
    }
    const generation = await generateMatches(generatorInput, supabase)
    console.log(`[Pipeline] Generated ${generation.candidates.length} candidates`)

    // Step 3: Evaluator - 결과 검증
    const evaluatorInput: EvaluatorInput = {
      itemName: item.itemName,
      spec: item.spec,
      unitPrice: item.unitPrice,
      generatorOutput: generation,
    }
    const evaluation = await evaluateMatch(evaluatorInput)
    console.log(`[Pipeline] Evaluation: ${evaluation.result} (confidence: ${(evaluation.confidence * 100).toFixed(0)}%)`)

    // 최종 상태 결정
    let status: 'matched' | 'uncertain' | 'failed' = 'failed'
    let final_candidate: MatchCandidate | undefined

    if (evaluation.result === 'MATCH') {
      status = 'matched'
      final_candidate = evaluation.recommended_candidate
    } else if (evaluation.result === 'UNCERTAIN') {
      status = 'uncertain'
      final_candidate = evaluation.recommended_candidate
    } else {
      // MISMATCH
      status = 'failed'
      final_candidate = evaluation.alternative_candidate  // 대안 후보 제시
    }

    const elapsed = Date.now() - startTime
    console.log(`[Pipeline] Completed in ${elapsed}ms: ${status}`)

    return {
      item,
      plan,
      generation,
      evaluation,
      status,
      final_candidate,
    }
  } catch (error) {
    console.error('[Pipeline] Error processing item:', error)

    // 에러 발생 시 fallback
    return {
      item,
      plan: {
        category: '기타',
        keywords: { core: [item.itemName] },
        strategy: 'fuzzy',
        confidence: 0,
        reasoning: 'Error occurred',
      },
      generation: {
        candidates: [],
        strategy_used: 'fuzzy',
        search_terms: [],
      },
      evaluation: {
        result: 'MISMATCH',
        confidence: 0,
        reasoning: error instanceof Error ? error.message : 'Unknown error',
      },
      status: 'failed',
    }
  }
}

/**
 * 배치 처리: 여러 품목 병렬 처리
 */
export async function processItems(
  items: PipelineItem[],
  supabase: SupabaseClient,
  options?: {
    parallel?: boolean      // 병렬 처리 여부 (기본: false, 순차 처리)
    batchSize?: number      // 배치 크기 (기본: 5)
    onProgress?: (processed: number, total: number) => void
  }
): Promise<{ results: PipelineResult[]; summary: PipelineSummary }> {
  const startTime = Date.now()
  const parallel = options?.parallel ?? false
  const batchSize = options?.batchSize ?? 5
  const onProgress = options?.onProgress

  console.log(`\n[Pipeline] Processing ${items.length} items (parallel: ${parallel})`)

  let results: PipelineResult[] = []

  if (parallel) {
    // 병렬 처리: 배치 단위로 나누어 처리
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      console.log(`[Pipeline] Batch ${Math.floor(i / batchSize) + 1}: Processing ${batch.length} items`)

      const batchResults = await Promise.all(
        batch.map(item => processItem(item, supabase))
      )

      results.push(...batchResults)

      if (onProgress) {
        onProgress(results.length, items.length)
      }
    }
  } else {
    // 순차 처리: 하나씩 처리
    for (let i = 0; i < items.length; i++) {
      const result = await processItem(items[i], supabase)
      results.push(result)

      if (onProgress) {
        onProgress(i + 1, items.length)
      }
    }
  }

  // 요약 통계
  const matched = results.filter(r => r.status === 'matched').length
  const uncertain = results.filter(r => r.status === 'uncertain').length
  const failed = results.filter(r => r.status === 'failed').length
  const matchRate = matched / items.length
  const avgConfidence =
    results.reduce((sum, r) => sum + r.evaluation.confidence, 0) / items.length
  const executionTime = Date.now() - startTime

  const summary: PipelineSummary = {
    total: items.length,
    matched,
    uncertain,
    failed,
    matchRate,
    avgConfidence,
    executionTime,
  }

  console.log(`\n[Pipeline] Summary:`)
  console.log(`  Total: ${summary.total}`)
  console.log(`  Matched: ${summary.matched} (${(summary.matchRate * 100).toFixed(1)}%)`)
  console.log(`  Uncertain: ${summary.uncertain}`)
  console.log(`  Failed: ${summary.failed}`)
  console.log(`  Avg Confidence: ${(summary.avgConfidence * 100).toFixed(1)}%`)
  console.log(`  Execution Time: ${(summary.executionTime / 1000).toFixed(1)}s`)

  return { results, summary }
}

/**
 * 로컬 매칭 모드: Supabase 대신 로컬 엑셀 파일 사용
 */
export async function processItemsLocal(
  items: PipelineItem[],
  localProducts: LocalProduct[],
  options?: {
    parallel?: boolean
    batchSize?: number
    onProgress?: (processed: number, total: number) => void
  }
): Promise<{ results: PipelineResult[]; summary: PipelineSummary }> {
  // TODO: 로컬 모드 구현
  throw new Error('Local mode not implemented yet')
}

export interface LocalProduct {
  id: number
  product_name: string
  standard_price: number
  unit_normalized: string
  category?: string
  spec_quantity?: number
  spec_unit?: string
}

/**
 * 3-Agent Pipeline Test Script
 *
 * 만안 명세표 (98품목)로 매칭 테스트를 실행합니다.
 */

import * as XLSX from 'xlsx'
import path from 'path'
import { processItems, type PipelineItem } from './pipeline'
import { loadLocalProducts, LocalSupabaseClient } from './local-matcher'

/**
 * 만안 명세표에서 품목 추출
 */
async function loadMananItems(filePath: string): Promise<PipelineItem[]> {
  try {
    const workbook = XLSX.readFile(filePath)
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(worksheet) as any[]

    const items: PipelineItem[] = data.map((row, index) => ({
      itemName: String(row['품목명'] || row['품명'] || ''),
      spec: String(row['규격'] || row['단위'] || ''),
      quantity: Number(row['수량'] || 0),
      unitPrice: Number(row['단가'] || 0),
      rowNumber: index + 1,
    }))

    // 빈 품목명 필터링
    return items.filter(item => item.itemName && item.itemName.trim() !== '')
  } catch (error) {
    console.error('[Test] Failed to load Manan items:', error)
    return []
  }
}

/**
 * 테스트 실행
 */
export async function runTest() {
  console.log('='.repeat(80))
  console.log('3-Agent Pipeline Test: Manan Invoice (98 items)')
  console.log('='.repeat(80))

  // 1. 신세계 DB 로드
  const ssgFilePath = path.join(
    process.cwd(),
    'test-data/extracted/키즈웰에듀푸드 단가_신세계푸드.xlsx'
  )
  console.log(`\n[Test] Loading SSG products from: ${ssgFilePath}`)
  const ssgProducts = await loadLocalProducts(ssgFilePath)
  console.log(`[Test] Loaded ${ssgProducts.length} SSG products`)

  // 2. 만안 명세표 로드
  const mananFilePath = path.join(
    process.cwd(),
    'test-data/extracted/거래명세서/8월 급식 거래명세서_만안.xlsx'
  )
  console.log(`\n[Test] Loading Manan items from: ${mananFilePath}`)
  const mananItems = await loadMananItems(mananFilePath)
  console.log(`[Test] Loaded ${mananItems.length} Manan items`)

  if (mananItems.length === 0) {
    console.error('[Test] No items loaded. Exiting.')
    return
  }

  // 3. Mock Supabase client 생성
  const mockSupabase = new LocalSupabaseClient(ssgProducts) as any

  // 4. 파이프라인 실행
  console.log('\n[Test] Starting pipeline processing...\n')
  const startTime = Date.now()

  const { results, summary } = await processItems(mananItems, mockSupabase, {
    parallel: false, // 순차 처리로 로그 확인
    batchSize: 5,
    onProgress: (processed, total) => {
      const percent = ((processed / total) * 100).toFixed(1)
      console.log(`[Progress] ${processed}/${total} (${percent}%)`)
    },
  })

  const endTime = Date.now()

  // 5. 결과 출력
  console.log('\n' + '='.repeat(80))
  console.log('TEST RESULTS')
  console.log('='.repeat(80))

  console.log(`\nTotal Items: ${summary.total}`)
  console.log(`Matched: ${summary.matched} (${(summary.matchRate * 100).toFixed(1)}%)`)
  console.log(`Uncertain: ${summary.uncertain}`)
  console.log(`Failed: ${summary.failed}`)
  console.log(`Avg Confidence: ${(summary.avgConfidence * 100).toFixed(1)}%`)
  console.log(`Execution Time: ${((endTime - startTime) / 1000).toFixed(1)}s`)

  // 6. 실패 케이스 분석
  console.log('\n' + '-'.repeat(80))
  console.log('FAILED CASES')
  console.log('-'.repeat(80))

  const failed = results.filter(r => r.status === 'failed')
  for (const result of failed.slice(0, 10)) {
    // 상위 10개만
    console.log(`\n[${result.item.rowNumber}] ${result.item.itemName}`)
    console.log(`  Strategy: ${result.plan.strategy}`)
    console.log(`  Evaluation: ${result.evaluation.result}`)
    console.log(`  Reasoning: ${result.evaluation.reasoning}`)
    if (result.evaluation.alternative_candidate) {
      console.log(
        `  Alternative: ${result.evaluation.alternative_candidate.product_name}`
      )
    }
  }

  // 7. 성공 케이스 샘플
  console.log('\n' + '-'.repeat(80))
  console.log('SUCCESS CASES (Sample)')
  console.log('-'.repeat(80))

  const matched = results.filter(r => r.status === 'matched')
  for (const result of matched.slice(0, 10)) {
    // 상위 10개만
    console.log(`\n[${result.item.rowNumber}] ${result.item.itemName}`)
    if (result.final_candidate) {
      console.log(`  Matched: ${result.final_candidate.product_name}`)
      console.log(
        `  Score: ${((result.final_candidate.final_score || result.final_candidate.match_score) * 100).toFixed(0)}%`
      )
      console.log(`  Confidence: ${(result.evaluation.confidence * 100).toFixed(0)}%`)
    }
  }

  // 8. 카테고리별 매칭률
  console.log('\n' + '-'.repeat(80))
  console.log('MATCHING RATE BY CATEGORY')
  console.log('-'.repeat(80))

  const categoryStats: Record<
    string,
    { total: number; matched: number; rate: number }
  > = {}

  for (const result of results) {
    const category = result.plan.category
    if (!categoryStats[category]) {
      categoryStats[category] = { total: 0, matched: 0, rate: 0 }
    }
    categoryStats[category].total++
    if (result.status === 'matched') {
      categoryStats[category].matched++
    }
  }

  for (const [category, stats] of Object.entries(categoryStats)) {
    stats.rate = stats.matched / stats.total
    console.log(
      `${category}: ${stats.matched}/${stats.total} (${(stats.rate * 100).toFixed(1)}%)`
    )
  }

  console.log('\n' + '='.repeat(80))

  return { results, summary, categoryStats }
}

// CLI 실행
if (require.main === module) {
  runTest()
    .then(() => {
      console.log('\n[Test] Completed successfully')
      process.exit(0)
    })
    .catch(error => {
      console.error('\n[Test] Failed:', error)
      process.exit(1)
    })
}

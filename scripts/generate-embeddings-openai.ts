#!/usr/bin/env tsx
/**
 * OpenAI API를 사용한 임베딩 생성 스크립트
 *
 * 모델: text-embedding-3-small (384 dimensions)
 * 예상 비용: ~$0.50 for 23,866 products
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const openaiKey = process.env.OPENAI_API_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

if (!openaiKey) {
  console.error('❌ Missing OPENAI_API_KEY in environment')
  console.error('   Add to .env.local: OPENAI_API_KEY=sk-...')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)
const openai = new OpenAI({ apiKey: openaiKey })

// 설정
const BATCH_SIZE = 100 // OpenAI 배치 사이즈 (tier 올라감)
const BATCH_DELAY_MS = 200 // 배치 간 딜레이 (0.2초)
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 384
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 3000 // Rate limit 재시도 딜레이

interface Product {
  id: string
  product_name: string
}

/**
 * OpenAI API로 임베딩 생성
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    })

    return response.data.map(item => item.embedding)
  } catch (error: any) {
    if (error?.status === 429) {
      throw new Error('Rate limit exceeded. Please wait and retry.')
    }
    throw error
  }
}

/**
 * 데이터베이스에 임베딩 저장 (배치)
 */
async function saveEmbeddings(products: Product[], embeddings: number[][]): Promise<void> {
  const updates = products.map((product, index) => ({
    id: product.id,
    embedding: `[${embeddings[index].join(',')}]`, // PostgreSQL vector 형식
  }))

  // 배치 업데이트 (upsert)
  for (const update of updates) {
    const { error } = await supabase
      .from('products')
      .update({ embedding: update.embedding })
      .eq('id', update.id)

    if (error) {
      throw new Error(`Failed to update product ${update.id}: ${error.message}`)
    }
  }
}

/**
 * 재시도 로직이 포함된 임베딩 생성
 */
async function generateWithRetry(texts: string[], retries = MAX_RETRIES): Promise<number[][]> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await generateEmbeddings(texts)
    } catch (error: any) {
      if (attempt === retries) {
        throw error
      }

      console.log(`   ⚠️  Attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt))
    }
  }

  throw new Error('Max retries exceeded')
}

/**
 * 진행률 표시
 */
function showProgress(current: number, total: number, startTime: number) {
  const percent = ((current / total) * 100).toFixed(1)
  const elapsed = (Date.now() - startTime) / 1000
  const rate = current / elapsed
  const remaining = (total - current) / rate

  const elapsedStr = elapsed < 60 ? `${elapsed.toFixed(0)}s` : `${(elapsed / 60).toFixed(1)}m`
  const remainingStr = remaining < 60 ? `${remaining.toFixed(0)}s` : `${(remaining / 60).toFixed(1)}m`

  process.stdout.write(
    `\r   진행: ${current}/${total} (${percent}%) | ` +
    `경과: ${elapsedStr} | 남은시간: ${remainingStr} | ` +
    `속도: ${rate.toFixed(1)}/s`
  )
}

/**
 * 비용 추정
 */
function estimateCost(totalProducts: number): void {
  const avgTokensPerProduct = 20 // 상품명 평균 토큰 수
  const totalTokens = totalProducts * avgTokensPerProduct
  const costPer1M = 0.02 // text-embedding-3-small: $0.02 per 1M tokens
  const estimatedCost = (totalTokens / 1_000_000) * costPer1M

  console.log('\n💰 비용 추정:')
  console.log(`   총 상품: ${totalProducts.toLocaleString()}개`)
  console.log(`   예상 토큰: ${totalTokens.toLocaleString()}`)
  console.log(`   예상 비용: $${estimatedCost.toFixed(2)} (약 ${(estimatedCost * 1300).toFixed(0)}원)`)
  console.log()
}

async function main() {
  console.log('\n🚀 OpenAI Embeddings 생성 시작\n')
  console.log('='.repeat(80))
  console.log()
  console.log(`📦 모델: ${EMBEDDING_MODEL}`)
  console.log(`📏 차원: ${EMBEDDING_DIMENSIONS}`)
  console.log(`🔢 배치 크기: ${BATCH_SIZE}`)
  console.log()

  try {
    // 1. 임베딩이 없는 상품 가져오기
    console.log('📊 임베딩이 없는 상품 조회 중...')

    const { data: products, error: fetchError } = await supabase
      .from('products')
      .select('id, product_name')
      .is('embedding', null)
      .order('id')
      .limit(30000) // Supabase 기본 1000개 → 전체 가져오기

    if (fetchError) {
      throw new Error(`Failed to fetch products: ${fetchError.message}`)
    }

    if (!products || products.length === 0) {
      console.log('\n✅ 모든 상품에 임베딩이 이미 생성되어 있습니다!')
      return
    }

    console.log(`   → ${products.length.toLocaleString()}개 상품 발견`)

    estimateCost(products.length)

    // 사용자 확인
    console.log('⚠️  계속 진행하시겠습니까? (Ctrl+C로 취소)')
    console.log()

    // 2. 배치 처리
    const totalBatches = Math.ceil(products.length / BATCH_SIZE)
    let processedCount = 0
    const startTime = Date.now()

    console.log('🔄 임베딩 생성 중...\n')

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE)
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1

      try {
        // 임베딩 생성
        const texts = batch.map(p => p.product_name)
        const embeddings = await generateWithRetry(texts)

        // 데이터베이스 저장
        await saveEmbeddings(batch, embeddings)

        processedCount += batch.length
        showProgress(processedCount, products.length, startTime)

        // Rate limit 방지를 위한 배치 간 딜레이
        if (i + BATCH_SIZE < products.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
        }

      } catch (error: any) {
        console.error(`\n\n❌ Batch ${batchNumber}/${totalBatches} 실패:`, error.message)
        console.error('   진행 상황 저장됨. 스크립트를 다시 실행하면 이어서 진행됩니다.')
        process.exit(1)
      }
    }

    const totalTime = (Date.now() - startTime) / 1000
    console.log('\n\n' + '='.repeat(80))
    console.log('\n✅ 임베딩 생성 완료!\n')
    console.log(`📊 처리 완료: ${processedCount.toLocaleString()}개`)
    console.log(`⏱️  소요 시간: ${totalTime < 60 ? totalTime.toFixed(0) + 's' : (totalTime / 60).toFixed(1) + 'm'}`)
    console.log(`⚡ 평균 속도: ${(processedCount / totalTime).toFixed(1)}/s`)
    console.log()

    // 3. 최종 통계 확인
    console.log('📈 최종 통계 조회 중...')
    const { data: stats } = await supabase.rpc('get_embedding_stats').single() as { data: { total_products: number; products_with_embedding: number; embedding_coverage_percent: number } | null }

    if (stats) {
      console.log(`   총 상품: ${stats.total_products}`)
      console.log(`   임베딩 생성: ${stats.products_with_embedding}`)
      console.log(`   커버리지: ${stats.embedding_coverage_percent}%`)
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n💡 다음 단계:')
    console.log('   1. 벡터 검색 테스트: npx tsx scripts/test-vector-search.ts')
    console.log('   2. Phase 1 vs Phase 2 비교 테스트')
    console.log()

  } catch (error: any) {
    console.error('\n❌ 오류 발생:', error.message)
    if (error.stack) {
      console.error('\n스택 트레이스:')
      console.error(error.stack)
    }
    process.exit(1)
  }
}

main().catch(error => {
  console.error('실행 오류:', error)
  process.exit(1)
})

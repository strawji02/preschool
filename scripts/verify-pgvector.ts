#!/usr/bin/env tsx
/**
 * pgvector 설정 검증 스크립트
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyPgvector() {
  console.log('\n🔍 pgvector 설정 검증\n')
  console.log('='.repeat(80))

  try {
    // 1. pgvector extension 확인
    console.log('\n📦 1. pgvector Extension 확인')
    const { data: extensions, error: extError } = await supabase.rpc('pg_extension_exists', {
      ext_name: 'vector'
    }).single()

    if (extError) {
      // Fallback: 다른 방법으로 확인
      console.log('   ⚠️  pg_extension_exists 함수 없음, 대체 방법 사용...')

      // embedding 컬럼 존재 여부로 간접 확인
      const { data: testData, error: testError } = await supabase
        .from('products')
        .select('embedding')
        .limit(1)

      if (testError) {
        if (testError.message.includes('column') && testError.message.includes('does not exist')) {
          console.log('   ❌ embedding 컬럼이 생성되지 않았습니다!')
          console.log('   → 마이그레이션이 제대로 적용되지 않았을 수 있습니다.')
          return
        }
        throw testError
      }

      console.log('   ✅ pgvector extension 활성화됨 (embedding 컬럼 확인)')
    } else {
      console.log('   ✅ pgvector extension 활성화됨')
    }

    // 2. 임베딩 통계 확인
    console.log('\n📊 2. Embedding 통계 확인')
    const { data: stats, error: statsError } = await supabase
      .rpc('get_embedding_stats')
      .single() as { data: { total_products: number; products_with_embedding: number; embedding_coverage_percent: number } | null; error: any }

    if (statsError) {
      console.error('   ❌ 통계 조회 실패:', statsError.message)
    } else if (stats) {
      console.log(`   총 상품 수: ${stats.total_products}개`)
      console.log(`   임베딩 생성: ${stats.products_with_embedding}개`)
      console.log(`   커버리지: ${stats.embedding_coverage_percent}%`)

      if (stats.products_with_embedding === 0) {
        console.log('\n   ⚠️  아직 임베딩이 생성되지 않았습니다.')
        console.log('   → 다음 단계: 임베딩 생성 스크립트 실행 필요')
      }
    }

    // 3. 벡터 검색 함수 존재 확인
    console.log('\n🔧 3. 벡터 검색 함수 확인')

    // search_products_vector 함수 테스트 (빈 임베딩으로)
    const { error: vectorFuncError } = await supabase
      .rpc('search_products_vector', {
        query_embedding: Array(384).fill(0),
        limit_count: 1
      })

    if (vectorFuncError) {
      console.log('   ❌ search_products_vector 함수 오류:', vectorFuncError.message)
    } else {
      console.log('   ✅ search_products_vector 함수 사용 가능')
    }

    // search_products_hybrid_v2 함수 테스트
    const { error: hybridFuncError } = await supabase
      .rpc('search_products_hybrid_v2', {
        search_term_raw: '테스트',
        search_term_clean: '테스트',
        query_embedding: null,  // 임베딩 없이도 작동해야 함
        limit_count: 1
      })

    if (hybridFuncError) {
      console.log('   ❌ search_products_hybrid_v2 함수 오류:', hybridFuncError.message)
    } else {
      console.log('   ✅ search_products_hybrid_v2 함수 사용 가능')
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ pgvector 설정 검증 완료!\n')

    if (stats && stats.products_with_embedding === 0) {
      console.log('📝 다음 단계:')
      console.log('   1. 임베딩 생성 스크립트 작성')
      console.log('   2. 23,866개 상품 임베딩 생성 (배치 처리)')
      console.log('   3. 벡터 검색 테스트')
      console.log()
    }

  } catch (error) {
    console.error('\n❌ 검증 실패:', error)
    process.exit(1)
  }
}

verifyPgvector().catch(error => {
  console.error('실행 오류:', error)
  process.exit(1)
})

#!/usr/bin/env ts-node
/**
 * Phase 1 매칭 정확도 테스트
 *
 * 목적: Trigram vs Hybrid Search 비교
 * 예상: 60% → 65-70% 정확도 향상
 */

import { createClient } from '@supabase/supabase-js'
import { preprocessKoreanFoodName, dualNormalize } from '../src/lib/preprocessing.js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'OK' : 'MISSING')
  console.error('ANON_KEY or SERVICE_KEY:', supabaseKey ? 'OK' : 'MISSING')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// 테스트 케이스: 실제 오매칭 사례 + 일반 케이스
const TEST_CASES = [
  // ========== 실제 오매칭 케이스 (거래명세서에서 발견) ==========
  {
    query: '프렌치버터롤오리지널모닝빵',
    expected_category: '빵',
    expected_keywords: ['빵', '프렌치', '버터', '롤', '모닝'],
    avoid_keywords: ['오렌지', '과일', '주스'],
    source: '9월 거래명세서_진아.xlsx (실제 오매칭: 빵→오렌지)',
  },
  {
    query: '포도쏙쏙주스',
    expected_category: '음료',
    expected_keywords: ['주스', '포도', '음료'],
    avoid_keywords: ['소스', 'A1', '스테이크'],
    source: '9월 거래명세서_진아.xlsx (실제 오매칭: 주스→소스)',
  },

  // ========== 일반 테스트 케이스 ==========
  {
    query: '평양식왕만두',
    expected_category: '만두',
    expected_keywords: ['만두', '왕만두', '평양'],
    avoid_keywords: ['양동이', '그릇', '용기'],
  },
  {
    query: '초콜렛케이크',
    expected_category: '케이크',
    expected_keywords: ['초콜릿', '케이크', '초코'],
    avoid_keywords: ['과자', '사탕'],
  },
  {
    query: '돼지고기삼겹살',
    expected_category: '고기',
    expected_keywords: ['돼지', '삼겹살', '고기'],
    avoid_keywords: ['소고기', '닭'],
  },
  {
    query: '깻잎바라',
    expected_category: '채소',
    expected_keywords: ['깻잎', '바라'],
    avoid_keywords: ['기름', '참기름'],
  },
  {
    query: '코카콜라',
    expected_category: '음료',
    expected_keywords: ['콜라', '코카'],
    avoid_keywords: ['사이다', '환타'],
  },
  {
    query: '양파1kg',
    expected_category: '채소',
    expected_keywords: ['양파'],
    avoid_keywords: ['마늘', '파'],
  },
  {
    query: '우유200ml',
    expected_category: '유제품',
    expected_keywords: ['우유'],
    avoid_keywords: ['치즈', '요거트'],
  },
  {
    query: '삼양라면',
    expected_category: '가공식품',
    expected_keywords: ['라면', '삼양'],
    avoid_keywords: ['우동', '국수'],
  },
]

interface SearchResult {
  id: string
  product_name: string
  match_score: number
  supplier: string
}

async function searchTrigram(query: string): Promise<SearchResult[]> {
  const { forSemantic } = dualNormalize(query)
  const { data, error } = await supabase.rpc('search_products_fuzzy', {
    search_term_raw: query,
    search_term_clean: forSemantic,
    limit_count: 5,
  })

  if (error) {
    console.error('Trigram search error:', error)
    return []
  }

  return (data || []) as SearchResult[]
}

async function searchHybrid(query: string): Promise<SearchResult[]> {
  const { forKeyword } = dualNormalize(query)
  const { data, error } = await supabase.rpc('search_products_hybrid', {
    search_term_raw: query,
    search_term_clean: forKeyword,
    limit_count: 5,
    bm25_weight: 0.5,
    semantic_weight: 0.5,
  })

  if (error) {
    console.error('Hybrid search error:', error)
    return []
  }

  return (data || []) as SearchResult[]
}

async function searchBM25(query: string): Promise<SearchResult[]> {
  const { forKeyword } = dualNormalize(query)
  const { data, error } = await supabase.rpc('search_products_bm25', {
    search_term: forKeyword,
    limit_count: 5,
  })

  if (error) {
    console.error('BM25 search error:', error)
    return []
  }

  return (data || []) as SearchResult[]
}

function evaluateResults(
  results: SearchResult[],
  testCase: typeof TEST_CASES[0]
): {
  score: number
  hasExpected: boolean
  hasAvoid: boolean
  topMatch: string
} {
  if (results.length === 0) {
    return { score: 0, hasExpected: false, hasAvoid: false, topMatch: 'N/A' }
  }

  const topResult = results[0]
  const topName = topResult.product_name.toLowerCase()

  // 예상 키워드 포함 여부
  const hasExpected = testCase.expected_keywords.some((kw) =>
    topName.includes(kw.toLowerCase())
  )

  // 회피 키워드 포함 여부 (나쁨)
  const hasAvoid = testCase.avoid_keywords.some((kw) =>
    topName.includes(kw.toLowerCase())
  )

  // 점수 계산
  let score = 0
  if (hasExpected && !hasAvoid) {
    score = 100 // 완벽
  } else if (hasExpected && hasAvoid) {
    score = 50 // 애매
  } else if (!hasExpected && !hasAvoid) {
    score = 30 // 관련 없음
  } else {
    score = 0 // 완전 오류
  }

  return { score, hasExpected, hasAvoid, topMatch: topResult.product_name }
}

async function runTests() {
  console.log('\n🧪 Phase 1 매칭 정확도 테스트\n')
  console.log('=' .repeat(80))

  const trigramScores: number[] = []
  const hybridScores: number[] = []
  const bm25Scores: number[] = []

  for (const testCase of TEST_CASES) {
    console.log(`\n📝 테스트: "${testCase.query}"`)
    console.log(`   예상 카테고리: ${testCase.expected_category}`)

    // 전처리 결과 표시
    const { forKeyword, forSemantic } = dualNormalize(testCase.query)
    console.log(`   전처리: Keyword="${forKeyword}" | Semantic="${forSemantic}"`)

    // 1. Trigram 검색
    const trigramResults = await searchTrigram(testCase.query)
    const trigramEval = evaluateResults(trigramResults, testCase)
    trigramScores.push(trigramEval.score)

    console.log(`\n   🔵 Trigram (기존):`)
    console.log(`      Top 1: ${trigramEval.topMatch}`)
    console.log(`      점수: ${trigramEval.score}/100`)
    console.log(`      ✅ 예상 키워드: ${trigramEval.hasExpected ? 'Yes' : 'No'}`)
    console.log(`      ❌ 회피 키워드: ${trigramEval.hasAvoid ? 'Yes' : 'No'}`)

    // 2. Hybrid 검색
    const hybridResults = await searchHybrid(testCase.query)
    const hybridEval = evaluateResults(hybridResults, testCase)
    hybridScores.push(hybridEval.score)

    console.log(`\n   🟢 Hybrid (Phase 1):`)
    console.log(`      Top 1: ${hybridEval.topMatch}`)
    console.log(`      점수: ${hybridEval.score}/100`)
    console.log(`      ✅ 예상 키워드: ${hybridEval.hasExpected ? 'Yes' : 'No'}`)
    console.log(`      ❌ 회피 키워드: ${hybridEval.hasAvoid ? 'Yes' : 'No'}`)

    // 3. BM25 검색
    const bm25Results = await searchBM25(testCase.query)
    const bm25Eval = evaluateResults(bm25Results, testCase)
    bm25Scores.push(bm25Eval.score)

    console.log(`\n   🟡 BM25 (키워드):`)
    console.log(`      Top 1: ${bm25Eval.topMatch}`)
    console.log(`      점수: ${bm25Eval.score}/100`)
    console.log(`      ✅ 예상 키워드: ${bm25Eval.hasExpected ? 'Yes' : 'No'}`)
    console.log(`      ❌ 회피 키워드: ${bm25Eval.hasAvoid ? 'Yes' : 'No'}`)

    // 개선 여부 표시
    const improvement = hybridEval.score - trigramEval.score
    if (improvement > 0) {
      console.log(`\n   ✨ 개선: +${improvement}점 (Hybrid가 더 좋음)`)
    } else if (improvement < 0) {
      console.log(`\n   ⚠️ 악화: ${improvement}점 (Trigram이 더 좋음)`)
    } else {
      console.log(`\n   ➖ 동일: 차이 없음`)
    }

    console.log('\n' + '-'.repeat(80))
  }

  // 종합 결과
  const trigramAvg = trigramScores.reduce((a, b) => a + b, 0) / trigramScores.length
  const hybridAvg = hybridScores.reduce((a, b) => a + b, 0) / hybridScores.length
  const bm25Avg = bm25Scores.reduce((a, b) => a + b, 0) / bm25Scores.length

  console.log('\n\n📊 종합 결과\n')
  console.log('=' .repeat(80))
  console.log(`\n총 테스트: ${TEST_CASES.length}개`)
  console.log(`\n🔵 Trigram (기존):  평균 ${trigramAvg.toFixed(1)}점`)
  console.log(`🟢 Hybrid (Phase 1): 평균 ${hybridAvg.toFixed(1)}점`)
  console.log(`🟡 BM25 (키워드):    평균 ${bm25Avg.toFixed(1)}점`)

  const improvement = hybridAvg - trigramAvg
  const improvementPercent = ((improvement / 100) * 100).toFixed(1)

  console.log(`\n✨ Phase 1 개선 효과: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}점 (${improvementPercent}%p)`)

  if (improvement > 0) {
    console.log(`   🎉 목표 달성! (목표: 5%p 향상)`)
  } else if (improvement === 0) {
    console.log(`   ➖ 개선 없음. 하이퍼파라미터 조정 필요.`)
  } else {
    console.log(`   ⚠️ 악화됨. Rollback 권장.`)
  }

  console.log('\n' + '='.repeat(80))

  // 권장 사항
  console.log('\n💡 권장 사항:\n')
  if (hybridAvg > trigramAvg && hybridAvg > bm25Avg) {
    console.log('   ✅ Hybrid Search 사용 권장 (최고 성능)')
    console.log('   📝 .env에 추가: NEXT_PUBLIC_SEARCH_MODE=hybrid')
  } else if (bm25Avg > hybridAvg && bm25Avg > trigramAvg) {
    console.log('   ✅ BM25 사용 권장 (키워드 매칭 강함)')
    console.log('   📝 .env에 추가: NEXT_PUBLIC_SEARCH_MODE=bm25')
  } else {
    console.log('   ✅ Trigram 유지 (기존 방식이 더 좋음)')
    console.log('   📝 .env에 추가: NEXT_PUBLIC_SEARCH_MODE=trigram')
  }

  console.log('\n')
}

// 실행
runTests().catch((error) => {
  console.error('테스트 실패:', error)
  process.exit(1)
})

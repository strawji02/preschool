import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 이전에 오매칭된 케이스들
const testCases = [
  '프렌치버터롤오리지널모닝빵',  // 이전에 "오렌지"로 매칭됨
  '우사태(한우)',               // 이전에 "돈사태"로 매칭됨
  '흙무',                       // 이전에 rank 5로 밀림
]

async function vectorSearch(query: string) {
  // 1. 쿼리 임베딩 생성
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
    dimensions: 384,
  })
  const embedding = response.data[0].embedding

  // 2. 벡터 검색
  const { data, error } = await supabase.rpc('vector_search', {
    query_embedding: embedding,
    match_count: 5,
    similarity_threshold: 0.3
  })

  return { data, error }
}

async function trigramSearch(query: string) {
  const { data, error } = await supabase.rpc('fuzzy_search', {
    search_term: query,
    similarity_threshold: 0.3,
    max_results: 5
  })
  return { data, error }
}

async function main() {
  console.log('🧪 벡터 검색 vs Trigram 비교 테스트\n')
  console.log('='.repeat(70))

  for (const query of testCases) {
    console.log(`\n🔍 검색어: "${query}"`)
    console.log('-'.repeat(70))

    // Trigram 검색
    console.log('\n📊 Trigram 결과:')
    const trigram = await trigramSearch(query)
    if (trigram.data?.slice(0, 3)) {
      trigram.data.slice(0, 3).forEach((r: any, i: number) => {
        console.log(`   ${i+1}. ${r.product_name} (${(r.similarity * 100).toFixed(1)}%)`)
      })
    } else {
      console.log('   결과 없음 또는 오류:', trigram.error?.message)
    }

    // 벡터 검색
    console.log('\n🧠 Vector 결과:')
    const vector = await vectorSearch(query)
    if (vector.data?.slice(0, 3)) {
      vector.data.slice(0, 3).forEach((r: any, i: number) => {
        console.log(`   ${i+1}. ${r.product_name} (${(r.similarity * 100).toFixed(1)}%)`)
      })
    } else {
      console.log('   결과 없음 또는 오류:', vector.error?.message)
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('✅ 테스트 완료')
}

main().catch(console.error)

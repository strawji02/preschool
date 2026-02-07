import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const testCases = [
  { query: '프렌치버터롤오리지널모닝빵', wrongMatch: '오렌지' },
  { query: '우사태(한우)', wrongMatch: '돈사태' },
  { query: '흙무', wrongMatch: null },
]

async function main() {
  console.log('🧪 Semantic Search 테스트 (Phase 2)\n')
  console.log('='.repeat(70))

  for (const tc of testCases) {
    console.log(`\n🔍 검색어: "${tc.query}"`)
    if (tc.wrongMatch) console.log(`   ⚠️  이전 오매칭: "${tc.wrongMatch}"`)
    console.log('-'.repeat(70))

    // 1. 쿼리 임베딩 생성
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: tc.query,
      dimensions: 384,
    })
    const embedding = response.data[0].embedding

    // 2. 벡터 검색 (올바른 함수명!)
    const { data, error } = await supabase.rpc('search_products_vector', {
      query_embedding: embedding,
      limit_count: 5,
      similarity_threshold: 0.2
    })

    if (error) {
      console.log(`   ❌ 오류: ${error.message}`)
    } else if (!data || data.length === 0) {
      console.log('   결과 없음 (임베딩된 상품 중 매칭되는 것 없음)')
    } else {
      console.log('   🧠 Semantic 검색 결과:')
      data.forEach((r: any, i: number) => {
        const isWrongMatch = tc.wrongMatch && r.product_name.includes(tc.wrongMatch)
        const icon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  '
        const warn = isWrongMatch ? ' ⚠️ 이전 오매칭!' : ''
        console.log(`   ${icon} ${i+1}. ${r.product_name} (${(r.similarity * 100).toFixed(1)}%)${warn}`)
      })
    }
  }

  console.log('\n' + '='.repeat(70))
}

main().catch(console.error)

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const testCases = [
  '프렌치버터롤오리지널모닝빵',
  '우사태(한우)',
  '흙무',
]

async function main() {
  console.log('🧪 Raw 벡터 검색 테스트\n')
  
  // 먼저 임베딩 있는 상품 수 확인
  const { count } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)
  
  console.log(`📊 임베딩이 있는 상품: ${count}개\n`)
  console.log('='.repeat(70))

  for (const query of testCases) {
    console.log(`\n🔍 검색어: "${query}"`)
    console.log('-'.repeat(70))

    // 1. 쿼리 임베딩 생성
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 384,
    })
    const embedding = response.data[0].embedding
    const embeddingStr = `[${embedding.join(',')}]`

    // 2. 코사인 유사도로 검색 (raw SQL)
    const { data, error } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          product_name,
          1 - (embedding <=> '${embeddingStr}'::vector) as similarity
        FROM products
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> '${embeddingStr}'::vector
        LIMIT 5
      `
    })

    if (error) {
      // exec_sql 없으면 직접 쿼리
      console.log('   직접 쿼리 시도...')
      
      // 간단히 pgvector 연산자 테스트
      const { data: sample, error: sampleErr } = await supabase
        .from('products')
        .select('id, product_name')
        .not('embedding', 'is', null)
        .limit(3)
      
      if (sample) {
        console.log('   임베딩 있는 샘플:')
        sample.forEach((p: any) => console.log(`     - ${p.product_name}`))
      }
    } else if (data) {
      data.forEach((r: any, i: number) => {
        console.log(`   ${i+1}. ${r.product_name} (${(r.similarity * 100).toFixed(1)}%)`)
      })
    }
  }
}

main().catch(console.error)

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// 2024.12월 간식 거래명세서_로사 품목들
const items = [
  "속이꽉찬 평양식왕만두",
  "일곱가지 신선야채 우리밀포자찜만두",
  "하선정 김밥용우엉조림,CJ",
  "사누끼우동면,천일",
  "우리콩유부슬라이스",
  "흰우유,서울우유",
  "국산콩나물",
  "부침가루,오뚜기",
  "바사삭순수튀김가루",
  "우유듬뿍굿모닝롤_파리바게뜨",
  "딸기잼,복음자리",
  "건소면,오뚜기",
  "삼립 꼬마호빵(단팥)",
  "사조살코기참치안심따개",
  "마요네즈(튜브),오뚜기",
  "자연은오렌지,웅진",
]

async function searchPhase1(term: string) {
  const { data } = await supabase.rpc('fuzzy_search', {
    search_term: term,
    similarity_threshold: 0.2,
    max_results: 1
  })
  return data?.[0] || null
}

async function searchPhase2(term: string) {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: term,
    dimensions: 384,
  })
  const embedding = response.data[0].embedding

  const { data } = await supabase.rpc('search_products_vector', {
    query_embedding: embedding,
    limit_count: 1,
    similarity_threshold: 0.2
  })
  return data?.[0] || null
}

async function main() {
  console.log('📊 Phase 1 (Trigram) vs Phase 2 (Semantic) 비교')
  console.log('📄 2024.12월 간식 거래명세서_로사.pdf\n')
  console.log('='.repeat(110))
  console.log('품목'.padEnd(28) + ' | P1점수 | P1 매칭'.padEnd(30) + ' | P2점수 | P2 매칭')
  console.log('-'.repeat(110))

  let p1Match = 0, p2Match = 0, p1Better = 0, p2Better = 0

  for (const item of items) {
    const [r1, r2] = await Promise.all([searchPhase1(item), searchPhase2(item)])
    
    const s1 = r1?.similarity || 0
    const s2 = r2?.similarity || 0
    const m1 = r1?.product_name?.substring(0, 26) || '-'
    const m2 = r2?.product_name?.substring(0, 26) || '-'
    
    if (s1 > 0.5) p1Match++
    if (s2 > 0.5) p2Match++
    if (s1 > s2) p1Better++
    if (s2 > s1) p2Better++

    const winner = s2 > s1 ? '🏆P2' : s1 > s2 ? '🥈P1' : '🤝'
    
    console.log(
      item.substring(0,26).padEnd(28) + ' | ' +
      (s1*100).toFixed(0).padStart(4) + '% | ' +
      m1.padEnd(28) + ' | ' +
      (s2*100).toFixed(0).padStart(4) + '% | ' +
      m2 + ' ' + winner
    )
  }

  console.log('='.repeat(110))
  console.log(`\n📈 결과:`)
  console.log(`   Phase 1 (Trigram): ${p1Match}/${items.length} 매칭 (>50%)`)
  console.log(`   Phase 2 (Semantic): ${p2Match}/${items.length} 매칭 (>50%)`)
  console.log(`   P1 승: ${p1Better} | P2 승: ${p2Better} | 동점: ${items.length - p1Better - p2Better}`)
}

main().catch(console.error)

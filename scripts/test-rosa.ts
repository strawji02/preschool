import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalize(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box)/gi, '')
    .replace(/\d+/g, '')
    .replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

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

async function main() {
  console.log('📄 2024.12월 간식 거래명세서_로사.pdf')
  console.log('='.repeat(95))
  
  let matched = 0, pending = 0, unmatched = 0
  
  console.log('\n원본                           | 점수 | DB 매칭                          | 상태')
  console.log('-'.repeat(95))
  
  for (const item of items) {
    const normalized = normalize(item)
    
    const { data } = await supabase.rpc('search_products_fuzzy', {
      search_term_raw: item,
      search_term_clean: normalized,
      limit_count: 3,
    })
    
    const score = data?.[0]?.match_score || 0
    const match = data?.[0]?.product_name || '-'
    
    let status = '❌'
    if (score > 0.8) { status = '✅'; matched++ }
    else if (score >= 0.3) { status = '🟡'; pending++ }
    else { unmatched++ }
    
    console.log(`${item.substring(0,30).padEnd(30)} | ${score.toFixed(2)} | ${match.substring(0,32).padEnd(32)} | ${status}`)
  }
  
  const total = matched + pending + unmatched
  console.log(`\n📊 ✅ ${matched} (${(matched/total*100).toFixed(0)}%) | 🟡 ${pending} (${(pending/total*100).toFixed(0)}%) | ❌ ${unmatched} (${(unmatched/total*100).toFixed(0)}%)`)
}

main()

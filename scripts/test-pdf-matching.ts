import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalizeItemName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\d+(\.\d+)?\s*(kg|g|ml|l|ea|개|팩|봉|box)/gi, '')
    .replace(/\d+/g, '')
    .replace(/[^\uAC00-\uD7A3a-zA-Z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 동행거래명세서에서 추출한 품목들
const items = [
  "깻잎(국내산)BOX",
  "브로콜리(국내산)",
  "건미역(국내산)",
  "우사태(한우/국내산)국거리용/A",
  "무항생제닭가슴살(국내산)체리부로",
  "꽈리고추(국내산)/특",
  "월계수잎(신영)",
  "(식자재왕)차조(중국산)EA/1KG",
  "요구르트(서울우유)",
  "사누끼우동면(천일)",
  "냉동유부슬라이스(신미)",
  "군만두/크레잇(씨제이)",
  "망고쥬스(델몬트)",
  "선동오징어(국내산)",
  "흙무(국내산)/상",
  "돈후지(국내산)잡채용/A",
  "[친환경]맛타리버섯(국내산)/무농약",
  "생표고버섯(국내산)/특",
  "팽이버섯(국내산)/특"
]

async function main() {
  console.log('📄 동행거래명세서.pdf 매칭 테스트')
  console.log('='.repeat(90))
  
  let matched = 0, pending = 0, unmatched = 0
  
  console.log('\n원본품목명                    | 점수 | DB 매칭결과                   | 상태')
  console.log('-'.repeat(90))
  
  for (const item of items) {
    const normalized = normalizeItemName(item)
    
    const { data: candidates } = await supabase.rpc('search_products_fuzzy', {
      search_term_raw: item,
      search_term_clean: normalized,
      limit_count: 3,
    })
    
    const topScore = candidates?.[0]?.match_score || 0
    const topMatch = candidates?.[0]?.product_name || '-'
    
    let status = '❌'
    if (topScore > 0.8) { status = '✅'; matched++ }
    else if (topScore >= 0.3) { status = '🟡'; pending++ }
    else { unmatched++ }
    
    console.log(`${item.substring(0,28).padEnd(28)} | ${topScore.toFixed(2)} | ${topMatch.substring(0,28).padEnd(28)} | ${status}`)
  }
  
  const total = matched + pending + unmatched
  console.log(`\n📊 ✅ Auto: ${matched} (${(matched/total*100).toFixed(0)}%) | 🟡 Pending: ${pending} (${(pending/total*100).toFixed(0)}%) | ❌ Miss: ${unmatched} (${(unmatched/total*100).toFixed(0)}%)`)
}

main().catch(console.error)

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

async function debug(itemName: string) {
  const normalized = normalize(itemName)
  console.log(`\n🔍 "${itemName}"`)
  console.log(`   정규화: "${normalized}"`)
  
  const { data } = await supabase.rpc('search_products_fuzzy', {
    search_term_raw: itemName,
    search_term_clean: normalized,
    limit_count: 5,
  })
  
  console.log(`\n   TOP 5 결과:`)
  data?.forEach((p: any, i: number) => {
    const icon = p.match_score > 0.8 ? '✅' : p.match_score >= 0.3 ? '🟡' : '❌'
    console.log(`   ${i+1}. ${icon} ${p.match_score.toFixed(2)} | ${p.product_name}`)
  })
}

async function main() {
  await debug("우사태(한우/국내산)국거리용/A")
  await debug("흙무(국내산)/상")
  await debug("돈후지(국내산)잡채용/A")
}

main()

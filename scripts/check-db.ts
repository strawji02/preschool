import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const problemItems = [
  { name: "우사태", desc: "소고기 사태" },
  { name: "흙무", desc: "생무" },
  { name: "돈후지", desc: "돼지 뒷다리" },
  { name: "맛타리", desc: "버섯" },
  { name: "무", desc: "무" },
]

async function main() {
  console.log('🔍 DB 상품 존재 여부 확인\n')
  
  for (const item of problemItems) {
    console.log(`\n━━━ "${item.name}" (${item.desc}) ━━━`)
    
    // LIKE 검색
    const { data: exact } = await supabase
      .from('products')
      .select('product_name, supplier, standard_price')
      .ilike('product_name', `%${item.name}%`)
      .limit(5)
    
    if (exact && exact.length > 0) {
      console.log(`✅ DB에 ${exact.length}건 있음:`)
      exact.forEach((p: any) => {
        console.log(`   - ${p.product_name} (${p.supplier}) ${p.standard_price}원`)
      })
    } else {
      console.log(`❌ DB에 없음!`)
    }
  }
  
  // 전체 통계
  const { count } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`📊 전체 상품 수: ${count}개`)
}

main().catch(console.error)

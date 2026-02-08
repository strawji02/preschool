import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function search() {
  // 1. DB에 국내산 깻잎 있는지 확인
  const { data, error } = await supabase
    .from('products')
    .select('id, product_name, supplier')
    .or('product_name.ilike.%깻잎%국내%,product_name.ilike.%국내%깻잎%')
    .limit(20)
  
  console.log('=== 국내산 깻잎 검색 결과 ===')
  if (error) console.error(error)
  else console.log(JSON.stringify(data, null, 2))
  
  // 2. 깻잎 관련 전체
  const { data: all } = await supabase
    .from('products')
    .select('id, product_name, supplier')
    .ilike('product_name', '%깻잎%')
    .limit(30)
  
  console.log('\n=== 깻잎 포함 전체 (30개) ===')
  console.log(JSON.stringify(all, null, 2))
}

search()

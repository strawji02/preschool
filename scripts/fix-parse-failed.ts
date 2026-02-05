/**
 * 규격 파싱 실패 상품 보정 스크립트
 * 
 * 사용법:
 *   테스트: npx tsx scripts/fix-parse-failed.ts --dry-run
 *   실행:   npx tsx scripts/fix-parse-failed.ts
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DRY_RUN = process.argv.includes('--dry-run')

interface Product {
  id: number
  supplier: string
  product_code: string
  product_name: string
  standard_price: number
  spec_raw: string | null
  unit_raw: string
}

interface FixResult {
  spec_quantity: number
  spec_unit: string
  standard_unit: 'g' | 'ml' | 'ea'
  ppu: number | null
  spec_parse_failed: boolean
}

/**
 * 상품명 패턴에 따라 보정값 결정
 */
function determinefix(product: Product): FixResult | null {
  const name = product.product_name || ''
  const price = product.standard_price

  // 패턴 1: KG) 끝 → 1KG당 가격
  if (/\sKG\)\s*$/.test(name)) {
    return {
      spec_quantity: 1000, // 1kg = 1000g
      spec_unit: 'g',
      standard_unit: 'g',
      ppu: price / 1000, // 원/g
      spec_parse_failed: false
    }
  }

  // 패턴 2: (KG) 괄호 → 1KG당 가격
  if (/\(KG\)/.test(name)) {
    return {
      spec_quantity: 1000,
      spec_unit: 'g',
      standard_unit: 'g',
      ppu: price / 1000,
      spec_parse_failed: false
    }
  }

  // 패턴 3: EA) 끝 → 1EA당 가격
  if (/\sEA\)\s*$/.test(name)) {
    return {
      spec_quantity: 1,
      spec_unit: 'EA',
      standard_unit: 'ea',
      ppu: price, // 원/개
      spec_parse_failed: false
    }
  }

  // 패턴 4: BOX) 끝 → 1BOX당 가격 (EA 취급)
  if (/\sBOX\)\s*$/.test(name)) {
    return {
      spec_quantity: 1,
      spec_unit: 'BOX',
      standard_unit: 'ea',
      ppu: price, // 원/박스
      spec_parse_failed: false
    }
  }

  // 패턴 5: PAC) 끝 → 1PAC당 가격 (EA 취급)
  if (/\sPAC\)\s*$/.test(name)) {
    return {
      spec_quantity: 1,
      spec_unit: 'PAC',
      standard_unit: 'ea',
      ppu: price,
      spec_parse_failed: false
    }
  }

  // 패턴 6: (EA) 끝 (공백 없음) → 1EA당 가격
  if (/\(EA\)\s*$/.test(name)) {
    return {
      spec_quantity: 1,
      spec_unit: 'EA',
      standard_unit: 'ea',
      ppu: price,
      spec_parse_failed: false
    }
  }

  return null // 보정 불가
}

async function main() {
  console.log(DRY_RUN ? '🧪 DRY RUN 모드 (실제 DB 변경 없음)\n' : '🚀 실제 실행 모드\n')

  // 모든 파싱 실패 건 가져오기
  let allData: Product[] = []
  let from = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, supplier, product_code, product_name, standard_price, spec_raw, unit_raw')
      .eq('spec_parse_failed', true)
      .range(from, from + pageSize - 1)

    if (error) { console.error(error); return }
    if (!data || data.length === 0) break

    allData = allData.concat(data as Product[])
    from += pageSize
    if (data.length < pageSize) break
  }

  console.log(`총 파싱 실패: ${allData.length}개\n`)

  // 분류
  const fixable: { product: Product; fix: FixResult }[] = []
  const unfixable: Product[] = []

  for (const product of allData) {
    const fix = determinefix(product)
    if (fix) {
      fixable.push({ product, fix })
    } else {
      unfixable.push(product)
    }
  }

  console.log('=== 보정 가능 ===')
  console.log(`${fixable.length}개 (${(fixable.length / allData.length * 100).toFixed(1)}%)`)

  // 패턴별 통계
  const byPattern = {
    'KG)': fixable.filter(f => /\sKG\)\s*$/.test(f.product.product_name)).length,
    '(KG)': fixable.filter(f => /\(KG\)/.test(f.product.product_name)).length,
    'EA)': fixable.filter(f => /\sEA\)\s*$/.test(f.product.product_name)).length,
    '(EA)': fixable.filter(f => /\(EA\)\s*$/.test(f.product.product_name)).length,
    'BOX)': fixable.filter(f => /\sBOX\)\s*$/.test(f.product.product_name)).length,
    'PAC)': fixable.filter(f => /\sPAC\)\s*$/.test(f.product.product_name)).length,
  }
  console.log('\n패턴별:')
  for (const [pat, cnt] of Object.entries(byPattern)) {
    if (cnt > 0) console.log(`  ${pat}: ${cnt}개`)
  }

  console.log('\n=== 보정 불가 (수동 필요) ===')
  console.log(`${unfixable.length}개`)
  unfixable.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.product_name}`)
  })
  if (unfixable.length > 10) console.log(`  ... 외 ${unfixable.length - 10}개`)

  // 샘플 보정 결과
  console.log('\n=== 보정 샘플 ===')
  fixable.slice(0, 5).forEach((f, i) => {
    console.log(`${i + 1}. ${f.product.product_name}`)
    console.log(`   가격: ${f.product.standard_price.toLocaleString()}원`)
    console.log(`   → ${f.fix.spec_quantity}${f.fix.spec_unit}, PPU: ${f.fix.ppu?.toFixed(2)}원/${f.fix.standard_unit}`)
  })

  if (DRY_RUN) {
    console.log('\n✅ DRY RUN 완료. 실제 적용하려면 --dry-run 없이 실행하세요.')
    return
  }

  // 실제 업데이트
  console.log('\n📦 DB 업데이트 시작...')
  const batchSize = 100
  let updated = 0

  for (let i = 0; i < fixable.length; i += batchSize) {
    const batch = fixable.slice(i, i + batchSize)
    
    for (const { product, fix } of batch) {
      const { error } = await supabase
        .from('products')
        .update({
          spec_quantity: fix.spec_quantity,
          spec_unit: fix.spec_unit,
          standard_unit: fix.standard_unit,
          ppu: fix.ppu,
          spec_parse_failed: false
        })
        .eq('id', product.id)

      if (error) {
        console.error(`❌ ${product.product_code} 실패:`, error.message)
      } else {
        updated++
      }
    }

    console.log(`  ✅ ${Math.min(i + batchSize, fixable.length)}/${fixable.length} 완료`)
  }

  console.log(`\n🎉 총 ${updated}개 보정 완료!`)
  console.log(`⚠️  ${unfixable.length}개는 수동 보정 필요`)
}

main()

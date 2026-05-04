/**
 * 콤마 천단위 spec_raw 잘못 파싱된 SHINSEGAE 제품 backfill
 *
 * 문제: "1,000G"가 spec_quantity=1, spec_unit='G'로 파싱됨 (콤마=소수점 해석)
 * 영향: SHINSEGAE 약 111건
 * 수정: 콤마 천단위 제거 후 재파싱
 */
import { createClient } from '@supabase/supabase-js'
import { parseShinsegaeSpec } from './lib/spec-parser'
import * as path from 'path'
import * as fs from 'fs'

// .env.local 로드
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf-8')
  env.split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function main() {
  console.log('🔍 콤마 천단위 잘못 파싱된 SHINSEGAE 제품 검색...')

  // 페이징으로 전체 가져옴 (Supabase max 1000/page)
  let all: Array<{
    id: string
    product_code: string
    product_name: string
    spec_raw: string | null
    spec_quantity: number | null
    spec_unit: string | null
  }> = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from('products')
      .select('id, product_code, product_name, spec_raw, spec_quantity, spec_unit')
      .eq('supplier', 'SHINSEGAE')
      .like('spec_raw', '%,%')
      .lt('spec_quantity', 100)
      .range(from, from + PAGE - 1)
    if (pageErr) {
      console.error('❌ DB 조회 실패:', pageErr)
      process.exit(1)
    }
    if (!page || page.length === 0) break
    all = all.concat(page)
    if (page.length < PAGE) break
    from += PAGE
  }
  const data = all
  const error = null

  if (error) {
    console.error('❌ DB 조회 실패:', error)
    process.exit(1)
  }

  const broken = (data ?? []).filter((p) => {
    const sr = p.spec_raw ?? ''
    const m = sr.match(/(\d+),(\d{3})\s*([A-Z]+)/i)
    if (!m) return false
    const expected = parseInt(m[1] + m[2])
    return expected !== p.spec_quantity
  })

  console.log(`   대상: ${broken.length}건`)

  let fixed = 0
  let failed = 0
  for (const p of broken) {
    const newSpec = parseShinsegaeSpec(p.spec_raw ?? '')
    if (
      !newSpec.parseFailed &&
      newSpec.quantity != null &&
      newSpec.quantity !== p.spec_quantity
    ) {
      const { error: updErr } = await supabase
        .from('products')
        .update({
          spec_quantity: newSpec.quantity,
          spec_unit: newSpec.unit,
        })
        .eq('id', p.id)

      if (updErr) {
        console.error(`   ❌ ${p.product_code}: ${updErr.message}`)
        failed++
      } else {
        console.log(
          `   ✅ ${p.product_code} ${p.product_name.slice(0, 25).padEnd(25)} ` +
            `${p.spec_raw} → q=${newSpec.quantity} u=${newSpec.unit}`,
        )
        fixed++
      }
    }
  }

  console.log(`\n✨ 완료: ${fixed}건 수정, ${failed}건 실패`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

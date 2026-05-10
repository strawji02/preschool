/**
 * "X단위 * N" 곱셈 패턴 spec_raw 잘못 파싱된 SHINSEGAE 제품 backfill (2026-05-10)
 *
 * 문제: sync-shinsegae.ts의 단순 정규식이 "10G*100개"의 첫 매치 "10G"만 잡아
 *       spec_quantity=10으로 저장 (정답: 10×100=1000)
 *
 * 영향: 792건 (10G*100개, 16G*70개, 120G*5개*8팩 등 모든 곱셈 spec)
 *
 * 수정: parseShinsegaeSpec (정상 작동) 으로 재파싱
 */
import { createClient } from '@supabase/supabase-js'
import { parseShinsegaeSpec } from './lib/spec-parser'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function main() {
  console.log('🔍 곱셈 패턴 spec_raw 검색 (페이징)...')

  // 페이징으로 SHINSEGAE 전체 조회 (Supabase 1000/page 제한)
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
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, product_name, spec_raw, spec_quantity, spec_unit')
      .eq('supplier', 'SHINSEGAE')
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('❌ DB 조회 실패:', error)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  console.log(`   전체 SHINSEGAE: ${all.length}건`)

  // 곱셈 패턴 + 잘못 파싱된 항목 필터
  const broken: typeof all = []
  for (const p of all) {
    const sr = p.spec_raw
    if (!sr) continue
    if (!/\*/.test(sr)) continue // 곱셈 없으면 스킵
    const r = parseShinsegaeSpec(sr)
    if (r.parseFailed || r.quantity == null) continue
    if (Math.abs((p.spec_quantity ?? 0) - r.quantity) > 0.5) {
      broken.push(p)
    }
  }
  console.log(`   잘못 파싱: ${broken.length}건`)

  if (broken.length === 0) {
    console.log('✨ 정상')
    return
  }

  console.log('\n📦 backfill 시작 (parseShinsegaeSpec으로 재계산)...')
  let fixed = 0
  let failed = 0
  for (const p of broken) {
    const r = parseShinsegaeSpec(p.spec_raw!)
    if (r.parseFailed || r.quantity == null) continue
    const { error } = await supabase
      .from('products')
      .update({
        spec_quantity: r.quantity,
        spec_unit: r.unit,
      })
      .eq('id', p.id)
    if (error) {
      console.error(`   ❌ ${p.product_code}: ${error.message}`)
      failed++
    } else {
      if (fixed < 10) {
        console.log(
          `   ✅ ${p.product_code} ${p.product_name.slice(0, 25).padEnd(25)} ` +
            `${p.spec_raw!.slice(0, 18).padEnd(18)} q=${p.spec_quantity} → ${r.quantity}`,
        )
      }
      fixed++
    }
  }
  console.log(`\n✨ 완료: ${fixed}건 수정, ${failed}건 실패`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

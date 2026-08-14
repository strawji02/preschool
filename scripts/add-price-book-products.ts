/**
 * 월별 단가표의 **신규 품목**을 `products`에 추가한다 — docs/systems/comparison.md §9
 *
 * ```
 *   npx tsx scripts/add-price-book-products.ts 2026-08            (DRY-RUN)
 *   npx tsx scripts/add-price-book-products.ts 2026-08 --apply
 * ```
 *
 * ★ **왜 필요한가** — 신세계가 매달 보내는 단가표에는 `products`에 없는 품목이
 * 있다. `products`는 2026-05-09 이후 동기화되지 않았다. 비교 세션이 8월 기준월을
 * 골라도, 애초에 `products`에 없는 품목은 **후보로 뜨지도 않는다.**
 *
 * ★ **여기서 하는 일은 "추가"뿐이다.** `scripts/sync-shinsegae.ts`와 달리
 *
 * ```
 *   기존 행의 단가를 고치지 않는다   기준월 없는 세션이 옛 결과를 재현해야 한다
 *   단종 마킹을 하지 않는다          단가표에 없다고 단종은 아니다 (발주중지·누락 가능)
 * ```
 *
 * 두 판단 모두 운영 중인 비교 시스템의 매칭 결과를 바꾼다. 전체 동기화는
 * 신세계 단가조회 엑셀로 `sync-shinsegae.ts`가 따로 한다.
 *
 * ⚠️ **임베딩은 넣지 않는다.** 별도 스크립트(`embed-missing-products.ts`)가
 * 채운다. 운영은 hybrid(BM25+trigram) 모드라 임베딩 없이도 검색된다.
 */

import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as fs from 'fs'
import {
  parseSpecQU,
  normalizeTaxType,
  normalizeUnit,
  classifyFood,
} from './lib/shinsegae-product-map'

/*
  .env.local 로드 (Next 밖에서 도는 스크립트라 직접 읽는다).

  ⚠️ **감싼 따옴표를 벗긴다.** 이 저장소의 .env.local은 값을 `"…"`로 감싸 둔다.
  그대로 쓰면 supabase-js가 `Invalid supabaseUrl`로 죽는다.
*/
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]]) return
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PAGE = 1000

interface BookRow {
  product_code: string
  product_name: string
  category: string | null
  item_group: string | null
  unit: string | null
  origin: string | null
  spec: string | null
  price: number
  previous_price: number | null
  tax_kind: string | null
  supplier: string | null
  order_cutoff: string | null
}

/** 그 달 단가표 전체 (PostgREST 1,000행 상한 → 나눠 읽는다) */
async function loadBook(period: string): Promise<BookRow[]> {
  const out: BookRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('shinsegae_price_book')
      .select(
        'product_code, product_name, category, item_group, unit, origin, spec, price, previous_price, tax_kind, supplier, order_cutoff'
      )
      .eq('period', period)
      // ⚠️ 정렬 없이 range로 넘기면 PostgREST가 순서를 보장하지 않아 **행을 빠뜨린다.**
      //    2026-08-15에 이 버그로 신규를 320개로 잘못 셌다 (실제 107개).
      .order('product_code')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`단가표 조회 실패: ${error.message}`)
    const rows = (data ?? []) as BookRow[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/** products의 신세계 품목코드 전부 */
async function loadExistingCodes(): Promise<Set<string>> {
  const set = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('product_code')
      .eq('supplier', 'SHINSEGAE')
      // ⚠️ 정렬 필수 — 없으면 페이지가 겹치거나 빠져 "없는 품목"을 잘못 센다
      .order('product_code')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`products 조회 실패: ${error.message}`)
    const rows = data ?? []
    for (const r of rows) set.add(r.product_code as string)
    if (rows.length < PAGE) break
  }
  return set
}

async function main() {
  const period = process.argv[2]
  const apply = process.argv.includes('--apply')

  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    console.error('사용법: npx tsx scripts/add-price-book-products.ts <YYYY-MM> [--apply]')
    process.exit(1)
  }

  console.log(`\n1️⃣  ${period} 단가표 읽기`)
  const book = await loadBook(period)
  if (book.length === 0) {
    console.error(`   ❌ ${period} 단가표가 없습니다. 먼저 정산 화면에서 올려 주세요.`)
    process.exit(1)
  }
  console.log(`   단가표 ${book.length.toLocaleString()}개`)

  console.log(`\n2️⃣  products와 대조`)
  const existing = await loadExistingCodes()
  console.log(`   products 신세계 ${existing.size.toLocaleString()}개`)

  /*
    같은 품목코드가 단가표 안에 두 번 나오면 마지막 것만 쓴다.
    DB는 (period, product_code) unique라 원래 중복이 없지만, 방어해 둔다.
  */
  const newByCode = new Map<string, BookRow>()
  for (const r of book) {
    if (!existing.has(r.product_code)) newByCode.set(r.product_code, r)
  }
  const newRows = [...newByCode.values()]
  console.log(`   신규 ${newRows.length.toLocaleString()}개`)

  if (newRows.length === 0) {
    console.log('\n   넣을 것이 없습니다.')
    return
  }

  // 분류 분포 — 비식자재가 섞여 있으면 매칭에서 빠지므로 미리 보여 준다
  const foodCount = { food: 0, nonFood: 0, unknown: 0 }
  const specFailed: string[] = []
  const insertRows = newRows.map((r) => {
    const spec = parseSpecQU(r.spec)
    const isFood = classifyFood(r.category)
    if (isFood === true) foodCount.food++
    else if (isFood === false) foodCount.nonFood++
    else foodCount.unknown++
    if (!spec.quantity) specFailed.push(`${r.product_code} ${r.product_name} / ${r.spec ?? '(규격없음)'}`)

    return {
      supplier: 'SHINSEGAE',
      product_code: r.product_code,
      product_name: r.product_name,
      product_name_normalized: r.product_name,
      standard_price: Math.round(Number(r.price)),
      unit_raw: r.unit ?? 'EA',
      unit_normalized: normalizeUnit(r.unit),
      spec_raw: r.spec,
      spec_quantity: spec.quantity,
      spec_unit: spec.unit,
      spec_parse_failed: !spec.quantity,
      category: r.category,
      subcategory: r.item_group,
      origin: r.origin,
      tax_type: normalizeTaxType(r.tax_kind),
      order_deadline: r.order_cutoff,
      supplier_partner: r.supplier,
      previous_price: r.previous_price,
      is_active: true,
      is_food: isFood,
      last_synced_at: new Date().toISOString(),
    }
  })

  console.log(`\n3️⃣  넣을 내용`)
  console.log(`   식자재 ${foodCount.food} · 비식자재 ${foodCount.nonFood} · 미분류(NULL) ${foodCount.unknown}`)
  console.log(`   규격 파싱 실패 ${specFailed.length}개 (spec_parse_failed=true — 단위중량 환산만 못 한다)`)
  console.log(`\n   표본 8개:`)
  for (const r of insertRows.slice(0, 8)) {
    console.log(
      `     ${r.product_code}  ${String(r.product_name).slice(0, 22).padEnd(22)}` +
        ` ${String(r.standard_price).padStart(7)}원  ${r.unit_normalized.padEnd(3)}` +
        ` ${String(r.category ?? '-').padEnd(8)} ${r.origin ?? '-'}`
    )
  }

  if (!apply) {
    console.log('\n👀 DRY-RUN — DB 변경 없음. --apply 를 붙이면 실제로 넣습니다.')
    return
  }

  console.log(`\n4️⃣  삽입 (${insertRows.length.toLocaleString()}건)`)
  /*
    ⚠️ **upsert가 아니라 insert다.** 기존 행을 건드리지 않는 게 이 스크립트의
    약속이다. 그 사이 누가 같은 코드를 넣었다면 unique 위반으로 **멈춘다** —
    조용히 덮어쓰는 것보다 낫다.
  */
  let inserted = 0
  const BATCH = 500
  for (let i = 0; i < insertRows.length; i += BATCH) {
    const slice = insertRows.slice(i, i + BATCH)
    const { error } = await supabase.from('products').insert(slice)
    if (error) throw new Error(`삽입 실패 (${i}~): ${error.message}`)
    inserted += slice.length
    console.log(`   📦 ${inserted}/${insertRows.length}`)
  }

  console.log(`\n5️⃣  확인`)
  const after = await loadExistingCodes()
  console.log(`   products 신세계 ${existing.size.toLocaleString()} → ${after.size.toLocaleString()}`)
  const missingStill = newRows.filter((r) => !after.has(r.product_code))
  console.log(`   아직 없는 것: ${missingStill.length}개 ${missingStill.length === 0 ? '(정상)' : '⚠️'}`)
  console.log(`\n✅ ${inserted.toLocaleString()}건 추가. 임베딩은 embed-missing-products.ts가 채웁니다.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

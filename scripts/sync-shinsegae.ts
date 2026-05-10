/**
 * 신세계 단가표 매월 동기화 스크립트
 *
 * 사용:
 *   npx tsx scripts/sync-shinsegae.ts <엑셀파일경로> [--apply]
 *
 *   --apply 없으면 dry-run (변경사항 미리보기만, DB 변경 없음)
 *   --apply 이 있어야 실제 UPSERT + 단종 마킹 수행
 *
 * 입력 엑셀 형식 (260509_신세계단가조회.xlsx 기준):
 *   2줄 multi-header, 3행부터 데이터
 *   컬럼: 순번, 카테고리, 품목군, 코드, 품목명, 단위, 원산지, 규격,
 *         종전단가, 결정단가, 변동율, 과면세, 발주구분, 협력사
 *
 * 동작:
 *   1) 엑셀 파싱 (multi-header + 카테고리/품목군 forward-fill)
 *   2) DB의 기존 SHINSEGAE 코드 조회
 *   3) Diff 계산:
 *      · 가격 변경 (같은 코드, standard_price 다름)
 *      · 신규 (DB에 없는 코드)
 *      · 단종 후보 (DB에 있지만 이번 엑셀에 없는 코드)
 *   4) --apply 시 UPSERT + 단종 마킹 + last_synced_at 갱신
 *
 * 임베딩:
 *   가격만 변경된 코드는 임베딩 재계산 불필요 (품명 동일).
 *   품명 변경/신규 품목만 별도 스크립트로 임베딩 처리 권장.
 */
import * as XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as fs from 'fs'
import { parseShinsegaeSpec } from './lib/spec-parser'

// .env.local 로드
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

interface ParsedRow {
  product_code: string
  product_name: string
  category: string | null
  subcategory: string | null
  unit_raw: string | null
  origin: string | null
  spec_raw: string | null
  standard_price: number
  previous_price: number | null
  tax_type: string | null
  order_deadline: string | null
  supplier_partner: string | null
}

// spec_quantity / spec_unit 파싱 — scripts/lib/spec-parser의 parseShinsegaeSpec 사용
// (이전 단순 정규식은 "10G*100개" 같은 곱셈 패턴을 못 잡아 baseQty만 저장 → 단위중량 잘못)
function parseSpecQU(spec: string | null): { quantity: number | null; unit: string | null } {
  if (!spec) return { quantity: null, unit: null }
  const r = parseShinsegaeSpec(spec)
  return { quantity: r.quantity, unit: r.unit }
}

/** tax_type 정규화 — "과세 / 의제매입대상" 같은 변형을 "과세"/"면세" 두 값으로 매핑 (DB check constraint) */
function normalizeTaxType(t: string | null): string | null {
  if (!t) return null
  const s = t.trim()
  if (s.includes('면세')) return '면세'
  if (s.includes('과세')) return '과세'
  return null
}

function normalizeUnit(u: string | null): string {
  if (!u) return 'EA'
  const upper = u.toUpperCase().trim()
  if (['KG', 'G'].includes(upper)) return upper
  if (['L', 'ML'].includes(upper)) return upper
  if (['봉', 'BAG'].includes(upper)) return 'BAG'
  if (['박스', 'BOX', 'CTN'].includes(upper)) return 'BOX'
  if (['팩', 'PAC', 'PACK'].includes(upper)) return 'PAC'
  if (['포', 'BAG'].includes(upper)) return 'BAG'
  return 'EA'
}

// 비식자재 카테고리 — 거래명세표(급식)는 식자재만 다루므로 매칭 제외 대상
// 신규 카테고리 등장 시 manual review 필요 (콘솔 경고)
const NON_FOOD_CATEGORIES = new Set<string>([
  '키친', '잡화', '용기', '유니폼', '사무용품', '소모품',
  '세척용품', '세제', '제지', '위생용품', '안전용품', '사무장비',
  '종이', '일회용품', '인쇄', '연포장', '스티커', '소모품 기타',
])
// 식자재 카테고리 (whitelist) — 검증용. 여기 없는 신규 카테고리는 NULL(안전망)로 마킹.
const KNOWN_FOOD_CATEGORIES = new Set<string>([
  '조미료', '농산가공품', '즉석조리', '가공', '음료류', '채소',
  '농산물원물가공', '유제품/빙과류', '즉석섭취', '베이커리', '축산가공품',
  '과자류', '돈육', '수산가공품', '커피/차류', '어류', '농산',
  '가금류', '수입육', '과일', '밀가루/전분', '건어', '양곡', '우육',
  '해조', '김치', '패류', '연체류', '갑각류', '건견과', '수산',
  '건강/특수용도식품', '축산', '난류', '선물세트', '피자', '선도유지',
  '베러푸즈',
])
function classifyFood(category: string | null): boolean | null {
  if (!category) return null // 안전망 — NULL은 매칭에 포함
  if (NON_FOOD_CATEGORIES.has(category)) return false
  if (KNOWN_FOOD_CATEGORIES.has(category)) return true
  console.warn(`⚠️ 알 수 없는 카테고리 (NULL로 마킹 — 안전망): "${category}"`)
  return null
}

function parseExcel(filePath: string): ParsedRow[] {
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][]

  // 행 0: 그룹 헤더, 행 1: 서브 헤더, 행 2~: 데이터
  // 카테고리/품목군은 병합셀이라 첫 행에만, null은 forward-fill 필요
  const rows: ParsedRow[] = []
  let curCat: string | null = null
  let curSub: string | null = null

  for (let i = 2; i < json.length; i++) {
    const row = json[i]
    if (!row) continue
    if (row[1]) curCat = String(row[1])
    if (row[2]) curSub = String(row[2])

    const code = row[3] != null ? String(row[3]) : null
    const name = row[4] != null ? String(row[4]) : null
    if (!code || !name) continue

    const oldPrice = typeof row[8] === 'number' ? row[8] : parseInt(String(row[8] ?? '0')) || 0
    const newPrice = typeof row[9] === 'number' ? row[9] : parseInt(String(row[9] ?? '0')) || 0

    rows.push({
      product_code: code,
      product_name: name,
      category: curCat,
      subcategory: curSub,
      unit_raw: row[5] != null ? String(row[5]) : null,
      origin: row[6] != null ? String(row[6]) : null,
      spec_raw: row[7] != null ? String(row[7]) : null,
      standard_price: newPrice,
      previous_price: oldPrice !== newPrice ? oldPrice : null,
      tax_type: row[11] != null ? String(row[11]) : null,
      order_deadline: row[12] != null ? String(row[12]) : null,
      supplier_partner: row[13] != null ? String(row[13]) : null,
    })
  }
  return rows
}

interface DBProduct {
  id: string
  product_code: string
  product_name: string
  standard_price: number
  category: string | null
  subcategory: string | null
}

async function fetchAllShinsegaeProducts(): Promise<DBProduct[]> {
  const all: DBProduct[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_code, product_name, standard_price, category, subcategory')
      .eq('supplier', 'SHINSEGAE')
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function main() {
  const args = process.argv.slice(2)
  const filePath = args.find((a) => !a.startsWith('--'))
  const apply = args.includes('--apply')

  if (!filePath) {
    console.error('Usage: npx tsx scripts/sync-shinsegae.ts <엑셀파일경로> [--apply]')
    process.exit(1)
  }

  const absPath = path.resolve(filePath)
  if (!fs.existsSync(absPath)) {
    console.error(`파일 없음: ${absPath}`)
    process.exit(1)
  }

  console.log(`📄 입력 파일: ${absPath}`)
  console.log(`🔧 모드: ${apply ? 'APPLY (DB 변경)' : 'DRY-RUN (미리보기만)'}`)
  console.log()

  // 1. 엑셀 파싱
  console.log('1️⃣  엑셀 파싱 중...')
  const newRows = parseExcel(absPath)
  console.log(`   엑셀 데이터: ${newRows.length}건`)

  // 2. DB 기존 데이터 조회
  console.log('\n2️⃣  DB 기존 SHINSEGAE 품목 조회 중...')
  const existing = await fetchAllShinsegaeProducts()
  console.log(`   DB 기존: ${existing.length}건`)

  const existingMap = new Map(existing.map((p) => [p.product_code, p]))
  const newCodes = new Set(newRows.map((r) => r.product_code))

  // 3. Diff 계산
  console.log('\n3️⃣  Diff 분석:')
  const toInsert: ParsedRow[] = []
  const toUpdate: { row: ParsedRow; existing: DBProduct }[] = []
  const priceChanges: { code: string; name: string; old: number; new: number }[] = []

  for (const row of newRows) {
    const ex = existingMap.get(row.product_code)
    if (!ex) {
      toInsert.push(row)
    } else {
      toUpdate.push({ row, existing: ex })
      if (ex.standard_price !== row.standard_price) {
        priceChanges.push({
          code: row.product_code,
          name: row.product_name.slice(0, 30),
          old: ex.standard_price,
          new: row.standard_price,
        })
      }
    }
  }

  const toDeactivate = existing.filter((p) => !newCodes.has(p.product_code))

  console.log(`   ➕ 신규: ${toInsert.length}건`)
  console.log(`   🔄 업데이트: ${toUpdate.length}건 (그 중 가격 변경 ${priceChanges.length}건)`)
  console.log(`   ⛔ 단종 후보: ${toDeactivate.length}건 (이번 엑셀에 없음)`)

  if (priceChanges.length > 0) {
    console.log('\n   💸 주요 가격 변경 (상위 10건):')
    for (const c of priceChanges.slice(0, 10)) {
      const pct = (((c.new - c.old) / c.old) * 100).toFixed(1)
      const arrow = c.new > c.old ? '▲' : '▼'
      console.log(`     ${c.code} ${c.name.padEnd(30)} ${c.old} → ${c.new} (${arrow}${pct}%)`)
    }
  }

  if (!apply) {
    console.log('\n👀 DRY-RUN 모드 — DB 변경 없음. --apply 추가하면 실제 적용.')
    return
  }

  // 4. 적용
  const now = new Date().toISOString()

  console.log('\n4️⃣  DB 적용 시작...')

  // 4a. UPSERT (신규 + 업데이트 일괄)
  // id는 항상 생략 — onConflict=(supplier, product_code)로 매칭, conflict 시 update.
  // (id 필드를 분기로 넣으면 supabase-js가 batch schema를 일치시키며 일부 row의 id를 null로 채워 NOT NULL 위반)
  const upsertBatch: Record<string, unknown>[] = []
  for (const row of newRows) {
    const ex = existingMap.get(row.product_code)
    const spec = parseSpecQU(row.spec_raw)
    const priceChanged = ex && ex.standard_price !== row.standard_price

    const obj: Record<string, unknown> = {
      supplier: 'SHINSEGAE',
      product_code: row.product_code,
      product_name: row.product_name,
      product_name_normalized: row.product_name,
      standard_price: row.standard_price,
      unit_raw: row.unit_raw ?? 'EA',
      unit_normalized: normalizeUnit(row.unit_raw),
      spec_raw: row.spec_raw,
      spec_quantity: spec.quantity,
      spec_unit: spec.unit,
      spec_parse_failed: !spec.quantity,
      category: row.category,
      subcategory: row.subcategory,
      origin: row.origin,
      tax_type: normalizeTaxType(row.tax_type),
      order_deadline: row.order_deadline,
      supplier_partner: row.supplier_partner,
      is_active: true,
      // 식자재 여부 자동 분류 (2026-05-11): 거래명세표는 식자재만 → 비식자재 카테고리 매칭 제외
      is_food: classifyFood(row.category),
      last_synced_at: now,
    }
    if (priceChanged) {
      obj.previous_price = ex!.standard_price
      obj.price_changed_at = now
    }
    upsertBatch.push(obj)
  }

  // upsert는 1000건씩 배치
  const BATCH = 500
  let upserted = 0
  for (let i = 0; i < upsertBatch.length; i += BATCH) {
    const slice = upsertBatch.slice(i, i + BATCH)
    const { error } = await supabase
      .from('products')
      .upsert(slice, { onConflict: 'supplier,product_code' })
    if (error) {
      console.error(`   ❌ UPSERT 실패 (batch ${i}):`, error.message)
      process.exit(1)
    }
    upserted += slice.length
    console.log(`   📦 UPSERT 진행: ${upserted}/${upsertBatch.length}`)
  }

  // 4b. 단종 마킹
  if (toDeactivate.length > 0) {
    const codes = toDeactivate.map((p) => p.product_code)
    let deactivated = 0
    for (let i = 0; i < codes.length; i += BATCH) {
      const slice = codes.slice(i, i + BATCH)
      const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('supplier', 'SHINSEGAE')
        .in('product_code', slice)
      if (error) {
        console.error(`   ❌ 단종 마킹 실패 (batch ${i}):`, error.message)
        process.exit(1)
      }
      deactivated += slice.length
    }
    console.log(`   ⛔ 단종 마킹: ${deactivated}건`)
  }

  console.log(`\n✅ 동기화 완료 (${now})`)
  console.log(`   UPSERT: ${upserted}건 / 단종: ${toDeactivate.length}건`)
  console.log(`\n다음 단계: 신규 ${toInsert.length}건 임베딩 처리 (별도 스크립트)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

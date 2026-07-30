/**
 * [정산] 홈택스 계산서 마스터 시드 생성 (docs §6-1, §14-8)
 *
 * 26년 6월 실제 홈택스 업로드 파일에서 **유치원 사업자 정보**와
 * **식당×과세구분 → 품목명** 매핑을 역추적해 migration 051의 시드 SQL을 만든다.
 *
 * 왜 금액으로 역추적하나: 품목명이 식당명에서 기계적으로 나오지 않는다
 * (`젬마유치원_수익자` → `급식재료(수익자)`, `행사` → `행사용`). 사람이 51개를
 * 손으로 옮기면 오타가 섞이므로, 실제 발행된 금액과 맞는 것을 정본으로 삼는다.
 *
 * ⚠️ 파싱은 **우리 파서를 그대로 쓴다.** 파이썬으로 다시 구현하면 기준이 갈려서
 * 시드와 런타임이 어긋날 수 있다.
 *
 * 실행: npx tsx scripts/generate-invoice-seed.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import {
  parseShinsegaeSheet,
  parseCjSheet,
  isValidBizRegNo,
  type NormalizedVenue,
} from '@/features/settlement'

const SOURCE = path.join(process.cwd(), '정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx')
const TAXED = path.join(process.cwd(), '(세금)계산서 발행을 위한 엑셀 파일_26년 6월.xlsx')
const EXEMPT = path.join(process.cwd(), '계산서 발행을 위한 엑셀 파일_26년 6월.xlsx')
/**
 * 마이그레이션을 **직접 생성한다.** 손으로 옮기면 틀린다 —
 * 실제로 주소 9곳과 식당코드 다수를 잘못 베꼈고, 생성 파일과 대조해서야 잡혔다.
 */
const OUT = path.join(process.cwd(), 'supabase/migrations/052_settlement_invoice_seed.sql')

/**
 * 계산서를 발행하지 않는 사업장 (migration 050의 `is_excluded` 시드와 같아야 한다).
 *
 * 본사는 자기 자신에게 계산서를 발행하지 않으므로 홈택스 파일에 없다.
 * 매칭 실패로 잡히면 안 되니 미리 빼 둔다 — 26년 6월 확정: 마케팅비 (docs §13-4).
 */
const NO_INVOICE_BUSINESSES = new Set(['shinsegae:88689'])

/**
 * 홈택스 양식 열 위치 (0-based). **양식별로 따로 둔다** —
 * 과세는 세액합계(U=20) 때문에 그 뒤가 전부 1칸 밀린다 (docs §6-1).
 */
const HOMETAX_COL = {
  taxable: {
    kind: 0,
    buyerNo: 10,
    buyerName: 12,
    buyerCeo: 13,
    buyerAddr: 14,
    buyerBizType: 15,
    buyerBizItem: 16,
    buyerEmail1: 17,
    buyerEmail2: 18,
    supplyTotal: 19,
    vatTotal: 20,
    product: 23,
  },
  exempt: {
    kind: 0,
    buyerNo: 10,
    buyerName: 12,
    buyerCeo: 13,
    buyerAddr: 14,
    buyerBizType: 15,
    buyerBizItem: 16,
    buyerEmail1: 17,
    buyerEmail2: 18,
    supplyTotal: 19,
    vatTotal: null,
    product: 22,
  },
} as const

/**
 * 데이터 시작 인덱스를 **내용으로 찾는다.**
 *
 * ⚠️ 엑셀 행 번호를 하드코딩하면 안 된다. 1~5행이 비어 있어 시트 범위가 `A5`부터
 * 시작하고, `sheet_to_json`은 그 앞을 잘라낸다 — 26년 6월 파일은 인덱스 1이 헤더,
 * 2가 첫 데이터다(엑셀 6·7행). 앞의 빈 행 수가 달라지면 오프셋이 어긋난다.
 * 실제로 6으로 두었더니 계산서 6장이 조용히 빠졌다.
 */
function findDataStart(rows: readonly unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (text(rows[i] ?? [], 1) === '작성일자') return i + 1
  }
  throw new Error('헤더(작성일자)를 찾지 못했습니다 — 양식이 바뀐 것 같습니다')
}

type TaxKind = 'taxable' | 'exempt'

interface InvoiceRow {
  excelRow: number
  kind: TaxKind
  buyerNo: string
  product: string
  supply: number
  vat: number
  /** 이미 어떤 식당에 붙었는지 */
  claimed: boolean
}

interface Kindergarten {
  bizRegNo: string
  companyName: string
  ceoName: string
  address: string
  bizType: string
  bizItem: string
  email1: string
  email2: string
  taxableSupply: number
  exempt: number
}

function text(row: unknown[], col: number): string {
  const v = row[col]
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function num(row: unknown[], col: number | null): number {
  if (col === null) return 0
  const v = row[col]
  return typeof v === 'number' ? v : 0
}

function readHometax(file: string, kind: TaxKind): InvoiceRow[] {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]!]
  if (!sheet) throw new Error(`${path.basename(file)}: 시트를 읽을 수 없습니다`)
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true }) as unknown[][]
  const C = HOMETAX_COL[kind]

  const out: InvoiceRow[] = []
  for (let i = findDataStart(rows); i < rows.length; i++) {
    const row = rows[i] ?? []
    // 종류(A)가 비어 있으면 빈껍데기 행이다 (원본에 42개 있다 — docs §6-1)
    if (text(row, C.kind) === '') continue
    out.push({
      excelRow: i + 1,
      kind,
      buyerNo: text(row, C.buyerNo).replace(/\D/g, ''),
      product: text(row, C.product),
      supply: num(row, C.supplyTotal),
      vat: num(row, C.vatTotal),
      claimed: false,
    })
  }
  return out
}

function readKindergartens(file: string, kind: TaxKind): Map<string, Kindergarten> {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]!]!
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true }) as unknown[][]
  const C = HOMETAX_COL[kind]

  const map = new Map<string, Kindergarten>()
  for (let i = findDataStart(rows); i < rows.length; i++) {
    const row = rows[i] ?? []
    if (text(row, C.kind) === '') continue
    const no = text(row, C.buyerNo).replace(/\D/g, '')
    const existing = map.get(no)
    const rec: Kindergarten = {
      bizRegNo: no,
      companyName: text(row, C.buyerName),
      ceoName: text(row, C.buyerCeo),
      address: text(row, C.buyerAddr),
      bizType: text(row, C.buyerBizType),
      bizItem: text(row, C.buyerBizItem),
      email1: text(row, C.buyerEmail1),
      email2: text(row, C.buyerEmail2),
      taxableSupply: kind === 'taxable' ? num(row, C.supplyTotal) : 0,
      exempt: kind === 'exempt' ? num(row, C.supplyTotal) : 0,
    }
    if (!existing) {
      map.set(no, rec)
      continue
    }
    // 같은 유치원이 여러 행에 나온다 — 필드가 다르면 원본이 일관되지 않다는 뜻
    for (const key of ['companyName', 'ceoName', 'address', 'bizType', 'bizItem', 'email1'] as const) {
      if (existing[key] !== rec[key]) {
        throw new Error(`${no} ${key} 불일치: "${existing[key]}" vs "${rec[key]}"`)
      }
    }
    existing.taxableSupply += rec.taxableSupply
    existing.exempt += rec.exempt
  }
  return map
}

function sql(value: string | null): string {
  if (value === null || value === '') return 'NULL'
  return `'${value.replace(/'/g, "''")}'`
}

function main(): void {
  // ── 1. 원천 파싱 (우리 파서) ──────────────────────────
  const wb = XLSX.read(readFileSync(SOURCE), { type: 'buffer' })
  const rowsOf = (name: string): unknown[][] =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false }) as unknown[][]

  const shin = parseShinsegaeSheet(rowsOf('신세계_전체 일반'))
  const cj = parseCjSheet(rowsOf('CJ_전체 집계표'))
  const venues: NormalizedVenue[] = [...shin.venues, ...cj.venues]
  console.log(`원천 파싱: 신세계 ${shin.venues.length} + CJ ${cj.venues.length} = ${venues.length} 식당`)

  // ── 2. 홈택스 파일 ────────────────────────────────────
  const invoices = [...readHometax(TAXED, 'taxable'), ...readHometax(EXEMPT, 'exempt')]
  const kgTaxed = readKindergartens(TAXED, 'taxable')
  const kgExempt = readKindergartens(EXEMPT, 'exempt')

  const kindergartens = new Map<string, Kindergarten>()
  for (const [no, k] of kgTaxed) kindergartens.set(no, { ...k })
  for (const [no, k] of kgExempt) {
    const cur = kindergartens.get(no)
    if (!cur) kindergartens.set(no, { ...k })
    else cur.exempt += k.exempt
  }
  console.log(`홈택스: 계산서 ${invoices.length}장 / 유치원 ${kindergartens.size}곳`)

  for (const [no] of kindergartens) {
    if (!isValidBizRegNo(no)) throw new Error(`사업자번호 체크섬 실패: ${no}`)
  }
  console.log(`사업자번호 체크섬: ${kindergartens.size}곳 전부 통과`)

  // ── 3. 사업장(=유치원) 식별 — 과세·면세 합계 쌍으로 묶는다 ──
  const byBusiness = new Map<string, NormalizedVenue[]>()
  for (const v of venues) {
    const key = `${v.source}:${v.businessCode}`
    const list = byBusiness.get(key)
    if (list) list.push(v)
    else byBusiness.set(key, [v])
  }

  const businessToKg = new Map<string, string>()
  const unresolved: string[] = []
  const skipped: string[] = []
  for (const [key, list] of byBusiness) {
    if (NO_INVOICE_BUSINESSES.has(key)) {
      skipped.push(key)
      continue
    }
    const taxable = list.reduce((s, v) => s + v.price.taxableSupply, 0)
    const exempt = list.reduce((s, v) => s + v.price.exempt, 0)
    const hits = [...kindergartens.values()].filter(
      (k) => k.taxableSupply === taxable && k.exempt === exempt
    )
    if (hits.length === 1) {
      businessToKg.set(key, hits[0]!.bizRegNo)
    } else {
      unresolved.push(`${key} (과세 ${taxable.toLocaleString()} / 면세 ${exempt.toLocaleString()}) → 후보 ${hits.length}곳`)
    }
  }
  console.log(
    `\n사업장 → 유치원 식별: ${businessToKg.size}/${byBusiness.size - skipped.length}` +
      ` (계산서 대상 아님 ${skipped.length}: ${skipped.join(', ')})`
  )
  for (const u of unresolved) console.log(`  ★ ${u}`)

  // ── 4. 식당×과세구분 → 품목명 ─────────────────────────
  interface ItemSeed {
    source: string
    businessCode: string
    restaurantCode: string
    restaurantName: string
    taxKind: TaxKind
    product: string
    amount: number
    /** 여러 식당이 한 장으로 합쳐진 경우 */
    merged: boolean
  }
  const items: ItemSeed[] = []
  const leftovers: { venue: NormalizedVenue; kind: TaxKind; amount: number }[] = []

  for (const [key, list] of byBusiness) {
    const bizNo = businessToKg.get(key)
    if (!bizNo) continue
    const pool = invoices.filter((r) => r.buyerNo === bizNo)

    for (const v of list) {
      for (const kind of ['taxable', 'exempt'] as const) {
        const amount = kind === 'taxable' ? v.price.taxableSupply : v.price.exempt
        if (amount === 0) continue
        const hit = pool.find((r) => r.kind === kind && !r.claimed && r.supply === amount)
        if (hit) {
          hit.claimed = true
          items.push({
            source: v.source,
            businessCode: v.businessCode,
            restaurantCode: v.restaurantCode,
            restaurantName: v.restaurantName,
            taxKind: kind,
            product: hit.product,
            amount,
            merged: false,
          })
        } else {
          leftovers.push({ venue: v, kind, amount })
        }
      }
    }
  }

  console.log(`\n금액 유일 매칭: ${items.length}건 / 남은 것 ${leftovers.length}건`)

  // 남은 것 = 여러 식당이 한 장으로 합쳐진 경우 (docs §6-1 해밀 사례).
  // 같은 사업장·같은 과세구분의 남은 식당 합계가 미청구 계산서와 일치하면 그 품목을 준다.
  for (const [key, list] of byBusiness) {
    const bizNo = businessToKg.get(key)
    if (!bizNo) continue
    for (const kind of ['taxable', 'exempt'] as const) {
      const mine = leftovers.filter(
        (l) => l.kind === kind && `${l.venue.source}:${l.venue.businessCode}` === key
      )
      if (mine.length === 0) continue
      const sum = mine.reduce((s, l) => s + l.amount, 0)
      const open = invoices.filter((r) => r.buyerNo === bizNo && r.kind === kind && !r.claimed)
      const hit = open.find((r) => r.supply === sum)
      if (!hit) {
        console.log(
          `  ★ 해결 못 함: ${key} ${kind} 남은 합계 ${sum.toLocaleString()} — 미청구 계산서 ${open
            .map((r) => r.supply.toLocaleString())
            .join(', ')}`
        )
        continue
      }
      hit.claimed = true
      console.log(
        `  합산 해결: ${key} ${kind} ${mine.length}개 식당 → ${hit.product} ${sum.toLocaleString()}`
      )
      for (const l of mine) {
        items.push({
          source: l.venue.source,
          businessCode: l.venue.businessCode,
          restaurantCode: l.venue.restaurantCode,
          restaurantName: l.venue.restaurantName,
          taxKind: kind,
          product: hit.product,
          amount: l.amount,
          merged: true,
        })
      }
    }
  }

  const unclaimed = invoices.filter((r) => !r.claimed)
  console.log(`\n최종: 품목 매핑 ${items.length}건 / 미청구 계산서 ${unclaimed.length}장`)
  for (const r of unclaimed) {
    console.log(`  ★ 미청구: ${r.kind} ${r.buyerNo} ${r.product} ${r.supply.toLocaleString()}`)
  }

  // ── 5. 검증 — 합계가 맞는지 ───────────────────────────
  const invTaxable = invoices.reduce((s, r) => s + (r.kind === 'taxable' ? r.supply : 0), 0)
  const invVat = invoices.reduce((s, r) => s + r.vat, 0)
  const invExempt = invoices.reduce((s, r) => s + (r.kind === 'exempt' ? r.supply : 0), 0)
  const seedTaxable = items
    .filter((i) => i.taxKind === 'taxable')
    .reduce((s, i) => s + i.amount, 0)
  const seedExempt = items.filter((i) => i.taxKind === 'exempt').reduce((s, i) => s + i.amount, 0)

  console.log('\n=== 합계 검증 ===')
  const check = (label: string, a: number, b: number) => {
    const ok = a === b
    console.log(`  ${label}: 시드=${a.toLocaleString()} 홈택스=${b.toLocaleString()} ${ok ? 'OK' : '★'}`)
    return ok
  }
  const okT = check('과세 공급가', seedTaxable, invTaxable)
  const okE = check('면세 금액  ', seedExempt, invExempt)
  console.log(`  과세 세액  : 홈택스=${invVat.toLocaleString()} (참고)`)

  // ── 6. SQL 출력 ───────────────────────────────────────
  const lines: string[] = []
  lines.push('-- 052_settlement_invoice_seed.sql')
  lines.push('-- [정산] 홈택스 계산서 마스터 26년 6월 시드 (docs §6-1)')
  lines.push('--')
  lines.push('-- ⚠️ **자동 생성 파일이다. 직접 수정하지 말고 스크립트를 고칠 것.**')
  lines.push('--   npx tsx scripts/generate-invoice-seed.ts')
  lines.push('--')
  lines.push('-- 출처: 실제 홈택스 업로드 파일 2종에서 **금액으로 역추적**했다.')
  lines.push('-- 품목명이 식당명에서 기계적으로 나오지 않아 사람이 옮기면 오타가 섞인다.')
  lines.push('--')
  lines.push('-- 검증 (스크립트가 매번 다시 확인한다):')
  lines.push(`--   · 사업장 → 유치원: 과세·면세 합계 쌍으로 ${businessToKg.size}/${businessToKg.size} 유일 식별`)
  lines.push(`--   · 식당×과세구분 → 품목: ${items.filter((i) => !i.merged).length}건 유일 + 합산 ${items.filter((i) => i.merged).length}건 = ${items.length}건`)
  lines.push(`--   · 과세 ${seedTaxable.toLocaleString()} / 면세 ${seedExempt.toLocaleString()} 원단위 일치, 미청구 계산서 ${unclaimed.length}장`)
  lines.push(`--   · 사업자번호 ${kindergartens.size}곳 전부 체크섬 통과`)
  lines.push('')
  lines.push('BEGIN;')
  lines.push('')
  lines.push('-- 본사 제외 사유 (§13-4 확정: 마케팅비)')
  lines.push('UPDATE public.settlement_venues')
  lines.push("   SET exclusion_reason = '마케팅비 — 본사 자체 소비분. 계산서를 발행하지 않는다.'")
  lines.push(" WHERE source = 'shinsegae' AND business_code = '88689' AND is_excluded;")
  lines.push('')
  lines.push('-- 유치원 사업자 정보 (계산서 발행용, docs §7 — 주민번호 없음)')
  lines.push('UPDATE public.settlement_venues v SET')
  lines.push('  biz_reg_no    = s.biz_reg_no,')
  lines.push('  company_name  = s.company_name,')
  lines.push('  ceo_name      = s.ceo_name,')
  lines.push('  address       = s.address,')
  lines.push('  biz_type      = s.biz_type,')
  lines.push('  biz_item      = s.biz_item,')
  lines.push('  email         = s.email1,')
  lines.push('  email2        = s.email2')
  lines.push('FROM (VALUES')
  const venueRows: string[] = []
  for (const [key, bizNo] of [...businessToKg].sort()) {
    const [source, code] = key.split(':') as [string, string]
    const k = kindergartens.get(bizNo)!
    venueRows.push(
      `  (${sql(source)}, ${sql(code)}, ${sql(k.bizRegNo)}, ${sql(k.companyName)}, ` +
        `${sql(k.ceoName)}, ${sql(k.address)}, ${sql(k.bizType)}, ${sql(k.bizItem)}, ` +
        `${sql(k.email1)}, ${sql(k.email2)})`
    )
  }
  lines.push(venueRows.join(',\n'))
  lines.push(') AS s(source, business_code, biz_reg_no, company_name, ceo_name, address, biz_type, biz_item, email1, email2)')
  lines.push('WHERE v.source = s.source AND v.business_code = s.business_code;')
  lines.push('')
  lines.push('-- 식당 × 과세구분 → 품목명')
  lines.push('-- ⚠️ 같은 식당이 과세·면세에서 품목명이 다를 수 있다 (나래유치원 원아급간식:')
  lines.push('--    과세 `원아급간식` / 면세 `급식재료`). 그래서 tax_kind가 키에 들어간다.')
  lines.push('INSERT INTO public.settlement_venue_items')
  lines.push('  (source, business_code, restaurant_code, restaurant_name, tax_kind, invoice_item_name, note)')
  lines.push('VALUES')
  const itemRows = items
    .slice()
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) ||
        a.businessCode.localeCompare(b.businessCode) ||
        a.restaurantCode.localeCompare(b.restaurantCode) ||
        a.taxKind.localeCompare(b.taxKind)
    )
    .map(
      (i) =>
        `  (${sql(i.source)}, ${sql(i.businessCode)}, ${sql(i.restaurantCode)}, ` +
        `${sql(i.restaurantName)}, ${sql(i.taxKind)}, ${sql(i.product)}, ` +
        `${sql(i.merged ? '26년 6월 실측 — 다른 식당과 한 장으로 합산 발행됨' : '26년 6월 실측 (금액 역추적)')})`
    )
  lines.push(itemRows.join(',\n'))
  lines.push('ON CONFLICT (source, business_code, restaurant_code, tax_kind) DO NOTHING;')
  lines.push('')
  lines.push('COMMIT;')
  lines.push('')

  writeFileSync(OUT, lines.join('\n'), 'utf8')
  console.log(`\n생성: ${path.relative(process.cwd(), OUT)}`)
  console.log(`  유치원 ${venueRows.length}곳 / 품목 매핑 ${itemRows.length}건`)

  const allOk = okT && okE && unclaimed.length === 0 && unresolved.length === 0
  console.log(`\n판정: ${allOk ? '전 항목 일치 — 시드로 사용 가능' : '★ 확인 필요'}`)
  if (!allOk) process.exitCode = 1
}

main()

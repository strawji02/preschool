/**
 * [정산] 홈택스 일괄발행 엑셀 2종 생성 + 실파일 대조 (docs §6-1)
 *
 * 26년 6월 원천 데이터로 계산서 파일을 만들고, 실제 홈택스에 올린 파일과
 * **(유치원 사업자번호 × 품목 × 금액) 집합**이 일치하는지 확인한다.
 *
 * ⚠️ 행 순서는 비교하지 않는다. 원본 순서는 `집계표_정산용`의 수작업 배열을 따르고
 * 재현할 근거가 없다. 홈택스는 1행 = 독립 계산서라 순서가 의미를 갖지 않는다.
 *
 * 마스터는 **DB에서 읽는다** — 실제 런타임 경로를 그대로 거쳐야 시드·로더·생성기가
 * 어긋나지 않는지 확인된다.
 *
 * 실행: set -a; . ./.env.local; set +a; npx tsx scripts/generate-invoice-files.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import {
  parseShinsegaeSheet,
  parseCjSheet,
  loadSettlementMaster,
  missingInvoiceFields,
  venueItemKey,
  collectInvoiceRows,
  buildInvoiceSheets,
  monthEndIssueDate,
  INVOICE_COL,
  type InvoiceParty,
  type InvoiceTaxKind,
  type InvoiceVenueLine,
} from '@/features/settlement'

const SOURCE = path.join(process.cwd(), '정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx')
const ORIG = {
  taxable: path.join(process.cwd(), '(세금)계산서 발행을 위한 엑셀 파일_26년 6월.xlsx'),
  exempt: path.join(process.cwd(), '계산서 발행을 위한 엑셀 파일_26년 6월.xlsx'),
} as const
const OUT = {
  taxable: path.join(process.cwd(), '(세금)계산서_26년6월_생성.xlsx'),
  exempt: path.join(process.cwd(), '계산서_26년6월_생성.xlsx'),
} as const

const YEAR = 2026
const MONTH = 6

type Row = unknown[]

function text(row: Row, col: number): string {
  const v = row[col]
  return v === null || v === undefined ? '' : String(v).trim()
}

function num(row: Row, col: number | null): number {
  if (col === null) return 0
  const v = row[col]
  return typeof v === 'number' ? v : 0
}

/** 헤더를 내용으로 찾는다 — 앞의 빈 행 수에 의존하면 조용히 어긋난다 */
function findDataStart(rows: readonly Row[]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    if (text(rows[i] ?? [], 1) === '작성일자') return i + 1
  }
  throw new Error('헤더(작성일자)를 찾지 못했습니다')
}

interface Fact {
  bizRegNo: string
  itemName: string
  supply: number
  vat: number
}

function factKey(f: Fact): string {
  return `${f.bizRegNo}|${f.itemName}|${f.supply}|${f.vat}`
}

function readOriginal(file: string, kind: InvoiceTaxKind): Fact[] {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]!]!
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true }) as Row[]
  const C = INVOICE_COL[kind]
  const out: Fact[] = []
  for (let i = findDataStart(rows); i < rows.length; i++) {
    const row = rows[i] ?? []
    if (text(row, C.kind) === '') continue // 영수/청구만 채워진 빈껍데기 행
    out.push({
      bizRegNo: text(row, C.buyerBizRegNo).replace(/\D/g, ''),
      itemName: text(row, C.itemName),
      supply: num(row, C.supplyTotal),
      vat: num(row, C.vatTotal),
    })
  }
  return out
}

function compare(label: string, ours: Fact[], theirs: Fact[]): number {
  const a = new Map<string, number>()
  for (const f of ours) a.set(factKey(f), (a.get(factKey(f)) ?? 0) + 1)
  const b = new Map<string, number>()
  for (const f of theirs) b.set(factKey(f), (b.get(factKey(f)) ?? 0) + 1)

  const onlyOurs: string[] = []
  const onlyTheirs: string[] = []
  for (const [k, n] of a) {
    const m = b.get(k) ?? 0
    for (let i = 0; i < n - m; i++) onlyOurs.push(k)
  }
  for (const [k, n] of b) {
    const m = a.get(k) ?? 0
    for (let i = 0; i < n - m; i++) onlyTheirs.push(k)
  }

  console.log(`\n=== ${label} 대조 ===`)
  console.log(`  생성 ${ours.length}장 / 원본 ${theirs.length}장`)
  if (onlyOurs.length === 0 && onlyTheirs.length === 0) {
    console.log('  전 항목 일치 (유치원 × 품목 × 공급가 × 세액)')
    return 0
  }
  for (const k of onlyOurs.slice(0, 10)) console.log(`  ★ 생성에만: ${k}`)
  for (const k of onlyTheirs.slice(0, 10)) console.log(`  ★ 원본에만: ${k}`)
  return onlyOurs.length + onlyTheirs.length
}

async function main(): Promise<void> {
  // ── 원천 파싱 ─────────────────────────────────────────
  const wb = XLSX.read(readFileSync(SOURCE), { type: 'buffer' })
  const rowsOf = (name: string): Row[] =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false }) as Row[]
  const shin = parseShinsegaeSheet(rowsOf('신세계_전체 일반'))
  const cj = parseCjSheet(rowsOf('CJ_전체 집계표'))
  const venues = [...shin.venues, ...cj.venues]
  console.log(`원천: 신세계 ${shin.venues.length} + CJ ${cj.venues.length} = ${venues.length} 식당`)

  // ── 마스터 (실제 런타임 경로) ─────────────────────────
  const master = await loadSettlementMaster()
  if (!master.issuer) throw new Error('계산서 공급자(settlement_issuer)가 설정되지 않았습니다')
  const issuer: InvoiceParty = master.issuer
  console.log(
    `마스터: 사업장 ${master.venues.length} / 품목 ${master.venueItems.size} / 공급자 ${issuer.companyName}`
  )

  const venueByKey = new Map<string, (typeof master.venues)[number]>(
    master.venues.map((v) => [`${v.source}:${v.businessCode}`, v])
  )

  // ── 계산서 줄 만들기 ──────────────────────────────────
  const lines: InvoiceVenueLine[] = venues.map((v) => {
    const key = `${v.source}:${v.businessCode}`
    const rec = venueByKey.get(key)
    const missing = rec ? missingInvoiceFields(rec) : ['사업장 미등록']
    const buyer: InvoiceParty | null =
      rec && missing.length === 0
        ? {
            bizRegNo: rec.invoice.bizRegNo!,
            companyName: rec.invoice.companyName!,
            ceoName: rec.invoice.ceoName!,
            address: rec.invoice.address!,
            bizType: rec.invoice.bizType!,
            bizItem: rec.invoice.bizItem!,
            email: rec.invoice.email!,
            email2: rec.invoice.email2,
          }
        : null
    const itemName = (kind: InvoiceTaxKind): string | null =>
      master.venueItems.get(venueItemKey(v.source, v.businessCode, v.restaurantCode, kind))
        ?.invoiceItemName ?? null

    return {
      source: v.source,
      businessCode: v.businessCode,
      restaurantCode: v.restaurantCode,
      restaurantName: v.restaurantName,
      price: v.price,
      isExcluded: rec?.isExcluded ?? false,
      buyer,
      itemNames: { taxable: itemName('taxable'), exempt: itemName('exempt') },
    }
  })

  const { rows, problems } = collectInvoiceRows(lines)
  console.log(`\n계산서 ${rows.length}장 / 문제 ${problems.length}건`)
  for (const p of problems) console.log(`  ★ ${p}`)

  const { issueDate, day } = monthEndIssueDate(YEAR, MONTH)
  const sheets = buildInvoiceSheets({ issueDate, day, issuer, rows })

  for (const kind of ['taxable', 'exempt'] as const) {
    const s = sheets[kind]
    const ws = XLSX.utils.aoa_to_sheet(s.rows as unknown[][])
    const out = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(out, ws, 'Sheet1')
    writeFileSync(OUT[kind], Buffer.from(XLSX.write(out, { type: 'array', bookType: 'xlsx' })))
    console.log(
      `\n생성: ${path.basename(OUT[kind])} — ${s.count}장 / 공급가 ${s.supplyTotal.toLocaleString()}` +
        (kind === 'taxable' ? ` / 세액 ${s.vatTotal.toLocaleString()}` : '')
    )
  }

  // ── 실파일 대조 ───────────────────────────────────────
  let mismatch = 0
  for (const kind of ['taxable', 'exempt'] as const) {
    const ours: Fact[] = rows
      .filter((r) => r.taxKind === kind)
      .map((r) => ({
        bizRegNo: r.buyer.bizRegNo,
        itemName: r.itemName,
        supply: r.supply,
        vat: kind === 'taxable' ? r.vat : 0,
      }))
    mismatch += compare(kind === 'taxable' ? '과세(세금계산서)' : '면세(계산서)', ours, readOriginal(ORIG[kind], kind))
  }

  console.log('\n=== 합계 검증 ===')
  const checks: [string, number, number][] = [
    ['과세 공급가', sheets.taxable.supplyTotal, 33_182_420],
    ['과세 세액  ', sheets.taxable.vatTotal, 3_318_242],
    ['면세 금액  ', sheets.exempt.supplyTotal, 65_846_245],
    ['과세 장수  ', sheets.taxable.count, 47],
    ['면세 장수  ', sheets.exempt.count, 41],
  ]
  for (const [label, got, want] of checks) {
    const ok = got === want
    if (!ok) mismatch++
    console.log(
      `  ${label}: 생성=${got.toLocaleString()} 원본=${want.toLocaleString()} ${ok ? 'OK' : '★'}`
    )
  }
  const total = sheets.taxable.supplyTotal + sheets.taxable.vatTotal + sheets.exempt.supplyTotal
  console.log(`  총 청구액  : ${total.toLocaleString()} (단가합계 102,359,832 − 본사 12,925)`)
  if (total !== 102_346_907) mismatch++

  console.log(
    `\n판정: ${mismatch === 0 && problems.length === 0 ? '전 항목 일치' : `★ 불일치 ${mismatch}건 / 문제 ${problems.length}건`}`
  )
  if (mismatch !== 0 || problems.length > 0) process.exitCode = 1
}

void main()

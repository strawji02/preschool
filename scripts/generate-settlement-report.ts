/**
 * [정산] 26년 6월 실데이터로 영업자별 정산 내역서를 생성하고 원본과 대조한다.
 *
 * 근거 파일이 저장소에 없으므로(업무 자료) 수동 실행 전용이다:
 *   npx tsx scripts/generate-settlement-report.ts
 *
 * 하는 일: 원천 두 시트 파싱 → 매핑·집계 → 산식 → 내역서 생성 → 원본 `계` 행과 대조
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import {
  parseShinsegaeSheet,
  parseCjSheet,
  aggregateByPartner,
  calcSettlement,
  buildDeclarationSheet,
  buildSettlementSheet,
  buildSettlementWorkbook,
  venueDisplayName,
  DECLARATION_COL,
  REPORT_COL,
  type DeclarationSplit,
  type PartnerMapping,
  type PartnerType,
  type ReportPartnerBlock,
  type SettlementResult,
} from '@/features/settlement'

const SOURCE = path.join(process.cwd(), '정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx')
const OUT = path.join(process.cwd(), '정산내역서_26년6월_생성.xlsx')

/** 26년 6월 검증된 매핑 (migration 050 시드와 동일). null = 정산 제외 */
const MAPPING: PartnerMapping = {
  'shinsegae:88689': null,
  'shinsegae:89912': '김중영',
  'cj:1003': '김중영',
  'cj:1005': '김중영',
  'cj:1008': '김중영',
  'cj:1014': '김중영',
  'cj:1015': '김중영',
  'shinsegae:89890': '이동현',
  'cj:1002': '이동현',
  'cj:1004': '이동현',
  'cj:1006': '이동현',
  'cj:1007': '이동현',
  'cj:1011': '이동현',
  'cj:1016': '이동현',
  'shinsegae:90223': '조성곤',
  'cj:1010': '조성곤',
  'cj:1013': '김영수',
}

const CONFIG: Record<string, { partnerType: PartnerType; businessDeduction: number }> = {
  김중영: { partnerType: 'cofounder', businessDeduction: 624_000 },
  이동현: { partnerType: 'cofounder', businessDeduction: 1_696_500 },
  조성곤: { partnerType: 'cofounder', businessDeduction: 0 },
  김영수: { partnerType: 'partner', businessDeduction: 0 },
}

/** 원본 블록 순서 */
const ORDER = ['김중영', '이동현', '조성곤', '김영수'] as const

/**
 * 26년 6월 실제 분할 신고 (docs §4). 원본 `사업소득 신고내역` 시트 순서를 따른다.
 * 이동현만 분할했고 나머지는 본인 명의 1건이다.
 */
const SPLITS: Record<string, DeclarationSplit[]> = {
  이동현: [
    { name: '김인순', amount: 5_000_000 },
    { name: '이유나', amount: 4_000_000 },
    { name: '이동현', amount: 4_490_317 },
  ],
}

/** 원본 신고내역의 영업자 등장 순서 — 김중영은 원본에 없다(원천징수 누락) */
const DECLARATION_ORDER = ['이동현', '조성곤', '김영수'] as const

type Row = unknown[]

function num(row: Row | undefined, col: number): number {
  const v = row?.[col]
  return typeof v === 'number' ? v : 0
}

function main(): void {
  const wb = XLSX.read(readFileSync(SOURCE), { type: 'buffer' })
  const rowsOf = (name: string): Row[] =>
    XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false }) as Row[]

  const ss = parseShinsegaeSheet(rowsOf('신세계_전체 일반'))
  const cj = parseCjSheet(rowsOf('CJ_전체 집계표'))
  console.log(`파싱: 신세계 ${ss.venues.length}건 / CJ ${cj.venues.length}건`)
  if (ss.warnings.length || cj.warnings.length) {
    console.log('★ 파서 경고:', [...ss.warnings, ...cj.warnings])
  }

  const all = [...cj.venues, ...ss.venues] // 원본은 CJ가 먼저 나온다
  const agg = aggregateByPartner(all, MAPPING)
  console.log(
    `집계: 영업자 ${agg.partners.length}명 / 제외 ${agg.excluded.length}건 / 누락 ${agg.unmapped.length}건`
  )
  if (agg.warnings.length) console.log('★ 집계 경고:', agg.warnings)

  // 블록 구성 — 원본 순서: 본사 → 김중영 → 이동현 → 조성곤 → 김영수
  const blocks: ReportPartnerBlock[] = [
    {
      partnerName: '본사',
      lines: agg.excluded.map((v) => ({
        venueName: venueDisplayName(v),
        cost: v.cost,
        price: v.price,
      })),
      settlement: null,
    },
  ]

  for (const name of ORDER) {
    const p = agg.partners.find((x) => x.partnerId === name)
    if (!p) throw new Error(`집계 결과에 ${name}이 없습니다 — 매핑을 확인하세요`)
    const cfg = CONFIG[name]
    blocks.push({
      partnerName: name,
      lines: p.venues.map((v) => ({
        venueName: venueDisplayName(v),
        cost: v.cost,
        price: v.price,
      })),
      settlement: calcSettlement({
        costTotal: p.costTotal,
        costVat: p.costVat,
        priceTotal: p.priceTotal,
        priceVat: p.priceVat,
        partnerType: cfg.partnerType,
        businessDeduction: cfg.businessDeduction,
      }),
    })
  }

  const sheet = buildSettlementSheet(blocks)

  // 지급명세서는 원본 순서(김중영 제외)로 만들어 셀 단위 대조가 되게 한다.
  // 김중영을 뒤에 붙이면 앞 5행의 일련번호가 밀리지 않는다.
  const settlementOf = (name: string): SettlementResult => {
    const b = blocks.find((x) => x.partnerName === name)
    if (!b?.settlement) throw new Error(`${name}의 정산 결과가 없습니다`)
    return b.settlement
  }
  const declarationSheet = buildDeclarationSheet({
    periodLabel: '26년 6월',
    partners: [...DECLARATION_ORDER, '김중영'].map((name) => ({
      partnerName: name,
      declared: settlementOf(name).declared,
      splits: SPLITS[name],
    })),
  })

  const outWb = buildSettlementWorkbook(sheet, { declarationSheet })
  writeFileSync(OUT, Buffer.from(XLSX.write(outWb, { type: 'array', bookType: 'xlsx' })))
  console.log(`\n생성: ${path.basename(OUT)} (${sheet.rows.length}행)`)
  console.log(`  시트: ${outWb.SheetNames.join(' / ')}`)
  if (declarationSheet.warnings.length > 0) {
    console.log('  ★ 명세서 경고:')
    for (const w of declarationSheet.warnings) console.log(`     - ${w}`)
  }

  // ── 원본 `계` 행과 대조 ──────────────────────────────
  // ⚠️ 원본 1~2행이 완전히 비어 있어 시트 범위가 A3부터 시작한다. 즉 인덱스는
  // "엑셀 행 − 3"이다. 하드코딩하면 어긋나므로 구분 열을 훑어 동적으로 찾는다.
  const orig = XLSX.utils.sheet_to_json(wb.Sheets['집계표_정산용'], {
    header: 1,
    blankrows: true,
  }) as Row[]
  const origTotals = findTotalRows(orig)
  console.log(`원본 계 행 위치(0-based): ${JSON.stringify(origTotals)}`)

  const COLS: [string, number][] = [
    ['원가공급가', REPORT_COL.costSupply],
    ['원가세액', REPORT_COL.costVat],
    ['원가면세', REPORT_COL.costExempt],
    ['원가합계', REPORT_COL.costTotal],
    ['단가합계', REPORT_COL.priceTotal],
    ['차액', REPORT_COL.margin],
    ['적립금', REPORT_COL.platformFee],
    ['부가세차액', REPORT_COL.vatDiff],
    ['사업자공제', REPORT_COL.deduction],
    ['세전', REPORT_COL.preTax],
  ]

  const genTotals = findTotalRows(sheet.rows)
  let mismatch = 0

  console.log('\n=== 원본 계 행과 대조 (원가/단가/M·O·P·Q·R) ===')
  for (const name of ORDER) {
    const o = orig[origTotals[name]]
    const g = sheet.rows[genTotals[name]]
    const bad: string[] = []
    for (const [label, c] of COLS) {
      if (num(o, c) !== num(g, c)) {
        bad.push(`${label} 원본=${num(o, c).toLocaleString()} 생성=${num(g, c).toLocaleString()}`)
        mismatch++
      }
    }
    console.log(`  ${name}: ${bad.length === 0 ? '전 항목 일치' : '★ ' + bad.join(' / ')}`)
  }

  console.log('\n=== 원천징수 (원본은 김중영이 누락돼 있다) ===')
  for (const name of ORDER) {
    const o = orig[origTotals[name]]
    const g = sheet.rows[genTotals[name]]
    const f = (row: Row | undefined, c: number) => {
      const v = row?.[c]
      return typeof v === 'number' ? v.toLocaleString() : '(비어있음)'
    }
    console.log(
      `  ${name}: 신고액 원본=${f(o, REPORT_COL.declared)} 생성=${f(g, REPORT_COL.declared)}` +
        ` | 실지급 원본=${f(o, REPORT_COL.netPay)} 생성=${f(g, REPORT_COL.netPay)}`
    )
  }

  // ── 원본 `사업소득 신고내역`과 대조 ────────────────────
  // 원본은 성명이 유일하므로 성명으로 찾는다 (행 번호에 의존하지 않는다).
  const origDecl = XLSX.utils.sheet_to_json(wb.Sheets['사업소득 신고내역'], {
    header: 1,
    blankrows: true,
  }) as Row[]

  const DECL_COLS: [string, number][] = [
    ['사업소득액', DECLARATION_COL.amount],
    ['소득세', DECLARATION_COL.incomeTax],
    ['지방소득세', DECLARATION_COL.localTax],
    ['소득세계', DECLARATION_COL.taxTotal],
    ['실지급액', DECLARATION_COL.netPay],
  ]

  console.log('\n=== 원본 사업소득 신고내역과 대조 ===')
  let declMismatch = 0
  for (const line of declarationSheet.lines) {
    const o = origDecl.find((r) => r?.[DECLARATION_COL.name] === line.name)
    if (!o) {
      console.log(`  ${line.name}: 원본에 없음 (생성 ${line.amount.toLocaleString()}원)`)
      continue
    }
    const gen: Record<string, number> = {
      사업소득액: line.amount,
      소득세: line.incomeTax,
      지방소득세: line.localTax,
      소득세계: line.taxTotal,
      실지급액: line.netPay,
    }
    const bad: string[] = []
    for (const [label, c] of DECL_COLS) {
      if (num(o, c) !== gen[label]) {
        bad.push(`${label} 원본=${num(o, c).toLocaleString()} 생성=${gen[label]!.toLocaleString()}`)
        declMismatch++
      }
    }
    console.log(`  ${line.name}: ${bad.length === 0 ? '전 항목 일치' : '★ ' + bad.join(' / ')}`)
  }

  // 원본 계 행 — 김중영이 빠져 있으므로 우리 합계와는 다르다. 김중영을 뺀 값으로 비교한다.
  const origDeclTotalRow = origDecl.find((r) => r?.[DECLARATION_COL.seq] === '계')
  const kim = declarationSheet.lines.find((l) => l.name === '김중영')
  const exKim = {
    사업소득액: declarationSheet.totals.amount - (kim?.amount ?? 0),
    소득세계: declarationSheet.totals.taxTotal - (kim?.taxTotal ?? 0),
    실지급액: declarationSheet.totals.netPay - (kim?.netPay ?? 0),
  }
  console.log('\n  계 행 (김중영 제외 기준):')
  for (const [label, c] of [
    ['사업소득액', DECLARATION_COL.amount],
    ['소득세계', DECLARATION_COL.taxTotal],
    ['실지급액', DECLARATION_COL.netPay],
  ] as [keyof typeof exKim, number][]) {
    const o = num(origDeclTotalRow, c)
    const g = exKim[label]
    const ok = o === g
    if (!ok) declMismatch++
    console.log(
      `    ${label}: 원본=${o.toLocaleString()} 생성=${g.toLocaleString()} ${ok ? 'OK' : '★'}`
    )
  }
  if (kim) {
    console.log(
      `\n  김중영은 원본에 없다 → 생성 ${kim.amount.toLocaleString()}원 ` +
        `(소득세계 ${kim.taxTotal.toLocaleString()} / 실지급 ${kim.netPay.toLocaleString()}). ` +
        `원본의 원천징수 누락을 확정 규칙대로 채운 결과다.`
    )
  }

  // 주민번호가 새어나가지 않는지 확인한다 (docs §7)
  const residentFilled = declarationSheet.rows
    .slice(7)
    .some((r) => r[DECLARATION_COL.residentId] !== null)
  console.log(`  주민번호 열 비어 있음: ${residentFilled ? '★ 값이 들어있다' : 'OK'}`)

  console.log(
    `\n판정: ${
      mismatch === 0 && declMismatch === 0
        ? '집계표·신고내역 전 항목 일치'
        : `★ 불일치 집계표 ${mismatch}건 / 신고내역 ${declMismatch}건`
    }`
  )
}

/** 구분 열에서 `계` 행을 찾고, 위로 훑어 어느 블록의 계인지 알아낸다 */
function findTotalRows(rows: readonly Row[]): Record<string, number> {
  const found: Record<string, number> = {}
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.[REPORT_COL.division] !== '계') continue
    const name = blockNameAbove(rows, i)
    if (name && name !== '구분') found[name] = i
  }
  return found
}

function blockNameAbove(rows: readonly Row[], totalIdx: number): string | null {
  for (let i = totalIdx - 1; i >= 0; i--) {
    const v = rows[i]?.[REPORT_COL.division]
    if (typeof v === 'string' && v !== '계') return v
  }
  return null
}

main()

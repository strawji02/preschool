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
  buildSettlementSheet,
  writeSettlementXlsx,
  venueDisplayName,
  REPORT_COL,
  type PartnerMapping,
  type PartnerType,
  type ReportPartnerBlock,
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
  writeFileSync(OUT, Buffer.from(writeSettlementXlsx(sheet)))
  console.log(`\n생성: ${path.basename(OUT)} (${sheet.rows.length}행)`)

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

  console.log(
    `\n판정: ${mismatch === 0 ? '원가·단가·산식 전 항목 일치' : `★ 불일치 ${mismatch}건`}`
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

import { numCell, textCell } from '@/lib/excel-cell'

/**
 * 신세계 월별 단가표 — docs/systems/settlement/단가표.md §21
 *
 * 신세계가 **매달 10일 전에** 보내는 품목 카탈로그다. 26년 6월 7,798개.
 *
 * ```
 * 순번 카테고리 품목군 품목코드 품목명 단위 원산지 규격
 *      종전단가 결정단가 변동율 과면세 발주구분 협력사
 * ```
 *
 * ★ **원산지가 여기 있다.** 우리 원천에는 없어서 거래명세표의 원산지 열을
 * 비워 뒀다 (§19). 이제 품목코드로 채운다.
 *
 * ★ **결정단가는 우리 원가다.** 26년 6월 실측에서 원천의 납품단가와
 * **523건 전부 일치**했다 (가맹점 단가와는 0건 — 그건 우리 판매가).
 * 그래서 원천 검증에도 쓸 수 있다.
 */

/** 0-based 열 번호 */
const COL = {
  category: 1,
  group: 2,
  productCode: 3,
  productName: 4,
  unit: 5,
  origin: 6,
  spec: 7,
  previousPrice: 8,
  price: 9,
  deltaRate: 10,
  taxKind: 11,
  orderCutoff: 12,
  supplier: 13,
} as const

/** 머리 2줄(`순번…` + `코드/명`) 다음부터 품목이다 */
const FIRST_DATA_ROW = 2

export interface PriceBookItem {
  productCode: string
  productName: string
  category: string
  group: string
  unit: string
  /** ★ 거래명세표의 원산지 열을 채우는 값 */
  origin: string
  spec: string
  /** 지난달 결정단가 — 연월 검증에 쓴다 */
  previousPrice: number
  /** 이번 달 확정 원가 */
  price: number
  deltaRate: number
  taxKind: 'taxable' | 'exempt'
  supplier: string
  orderCutoff: string
}

export interface PriceBookResult {
  items: PriceBookItem[]
  warnings: string[]
}

/**
 * 품목코드를 6자리 문자열로 맞춘다.
 *
 * ⚠️ 엑셀이 `017392`를 **숫자 17392로** 주는 일이 있다. 그대로 두면 원천의
 * `017392`와 안 붙어 원산지가 통째로 비어 버린다.
 */
export function normalizeProductCode(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (s === '') return null
  return /^\d+$/.test(s) ? s.padStart(6, '0') : s
}

export function parsePriceBookSheet(rows: readonly unknown[][]): PriceBookResult {
  const items: PriceBookItem[] = []
  const warnings: string[] = []
  const seen = new Set<string>()

  let category = ''
  let group = ''

  for (let i = FIRST_DATA_ROW; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    /*
      카테고리·품목군은 **첫 줄에만 적히고 아래로 비어 있다** (엑셀 세로 병합처럼).
      비어 있으면 위에서 이어받는다.
    */
    const c = textCell(row, COL.category)
    if (c) category = c
    const g = textCell(row, COL.group)
    if (g) group = g

    const productCode = normalizeProductCode(row[COL.productCode])
    if (!productCode) continue

    if (seen.has(productCode)) {
      warnings.push(`품목코드 ${productCode}가 두 번 나옵니다. 첫 줄만 씁니다.`)
      continue
    }
    seen.add(productCode)

    items.push({
      productCode,
      productName: textCell(row, COL.productName),
      category,
      group,
      unit: textCell(row, COL.unit),
      origin: textCell(row, COL.origin),
      spec: textCell(row, COL.spec),
      previousPrice: numCell(row, COL.previousPrice),
      price: numCell(row, COL.price),
      deltaRate: numCell(row, COL.deltaRate),
      taxKind: textCell(row, COL.taxKind).includes('과세') ? 'taxable' : 'exempt',
      supplier: textCell(row, COL.supplier),
      orderCutoff: textCell(row, COL.orderCutoff),
    })
  }

  return { items, warnings }
}

export interface PeriodCheckResult {
  ok: boolean
  matched: number
  mismatched: number
  message: string | null
}

/**
 * 고른 연월이 맞는지 확인한다.
 *
 * ⚠️ **파일에 연월이 없다.** 헤더 어디에도 월 표기가 없고 파일명에만 `6월`이
 * 있다. 사용자가 잘못 고르면 **다른 달 단가가 조용히 들어간다** — 매달 5~10%가
 * 바뀌므로 눈치채기 어렵다.
 *
 * 대신 데이터 안에 근거가 있다: **새 파일의 종전단가 = 직전 달 결정단가.**
 * 실측에서 6→7월 7,798/7,798, 7→8월 7,818/7,818로 **100% 맞았다.**
 * 한 달 건너뛴 오선택(6→8월)은 88.8%였다.
 *
 * ```
 * 맞게 고름   100.0%
 * 한 달 건너뜀 88.8%   ← 6,927 일치 / 871 불일치
 * ```
 *
 * 그래서 문턱을 **97%**로 잡는다. 정상이 딱 100%라 여유를 크게 둘 이유가 없고,
 * 90%로 두면 오선택이 겨우 걸린다. 신세계가 몇 건을 소급 정정하는 정도는 통과한다.
 */
const MATCH_THRESHOLD = 0.97

export function checkPriceBookPeriod(
  incoming: readonly { productCode: string; previousPrice: number }[],
  previousMonth: readonly { productCode: string; price: number }[] | null
): PeriodCheckResult {
  // 첫 달이면 대조할 것이 없다 — 막지 않는다
  if (!previousMonth || previousMonth.length === 0) {
    return { ok: true, matched: 0, mismatched: 0, message: null }
  }

  const prev = new Map(previousMonth.map((p) => [p.productCode, p.price]))
  let matched = 0
  let mismatched = 0
  for (const item of incoming) {
    const before = prev.get(item.productCode)
    if (before === undefined) continue // 신규 품목 — 대조 대상이 아니다
    if (before === item.previousPrice) matched++
    else mismatched++
  }

  const total = matched + mismatched
  if (total === 0) {
    return { ok: true, matched: 0, mismatched: 0, message: null }
  }
  const rate = matched / total
  if (rate >= MATCH_THRESHOLD) {
    return { ok: true, matched, mismatched, message: null }
  }
  return {
    ok: false,
    matched,
    mismatched,
    message:
      `연월이 틀렸을 수 있습니다 — 종전단가가 직전 달 결정단가와 ` +
      `${total}건 중 ${mismatched}건 어긋납니다. 고른 달을 확인해 주세요.`,
  }
}

import { describe, it, expect } from 'vitest'
import {
  checkPriceBookPeriod,
  normalizeProductCode,
  parsePriceBookSheet,
} from '@/features/settlement/parse/price-book'

/**
 * [정산] 신세계 월별 단가표 (docs §21)
 *
 * ★ **무엇인가** — 신세계가 매달 10일 전에 보내는 품목 카탈로그다.
 * 26년 6월 7,798개 · 7월 7,818개 · 8월 7,828개.
 *
 * ```
 * 순번 카테고리 품목군 품목코드 품목명 단위 원산지 규격
 *      종전단가 결정단가 변동율 과면세 발주구분 협력사
 * ```
 *
 * ★ **왜 필요한가** — `원산지`가 여기 있다. 우리 원천에는 없어서 거래명세표의
 * 원산지 열을 비워 뒀다 (§19). 이제 품목코드로 채울 수 있다.
 *
 * 26년 6월 실측: 원천 533행 중 523행이 코드로 매칭됐고 **원산지 523/523 채워짐**.
 * `결정단가`는 우리 원가(원천의 납품단가)와 **523건 전부 일치**했다.
 */

/** 6월 파일 앞부분 실제 값 */
const JUNE_ROWS: unknown[][] = [
  ['순번', '카테고리', '품목군', '품목', null, '단위', '원산지', '규격', '공급단가', null, null, '과면세', '발주구분', '협력사'],
  [null, null, null, '코드', '명', null, null, null, '종전단가', '결정단가', '변동율', null, null, null],
  [1, '양곡', '미곡류', '902769', '무농약 찹쌀 국내산 상온', 'kg', '국내산', '1KG', 8140, 8140, 0, '면세', 'D-1  17:00', '농업회사법인유한회사광복'],
  [2, null, null, '347395', '일반미 단풍애물든쌀 국내산 상온', '포', '국내산', '20KG', 71400, 71400, 0, '면세', 'D-1  17:00', '평택물류센터'],
  // 코드가 숫자로 오고 앞자리 0이 날아간 경우 — 원천은 `017392`다
  [3, null, null, 17392, '세척당근 국내산 실온(냉장 권장)', 'kg', '국내산', '1KG, 개당120g이상', 2340, 2370, 1.28, '면세', 'D-1  17:00', '평택물류센터'],
  [null, null, null, null, null, null, null, null, null, null, null, null, null, null],
]

describe('parsePriceBookSheet — 단가표 읽기', () => {
  const parsed = parsePriceBookSheet(JUNE_ROWS)

  it('머리 2줄을 건너뛰고 품목만 읽는다', () => {
    expect(parsed.items).toHaveLength(3)
    expect(parsed.warnings).toEqual([])
  })

  it('품목코드는 6자리로 맞춘다', () => {
    // ⚠️ 엑셀이 `017392`를 숫자 17392로 주면 원천과 안 붙는다
    expect(parsed.items.map((i) => i.productCode)).toEqual(['902769', '347395', '017392'])
  })

  it('원산지·규격·단위·과면세를 그대로 담는다', () => {
    const it0 = parsed.items[0]
    expect(it0.origin).toBe('국내산')
    expect(it0.spec).toBe('1KG')
    expect(it0.unit).toBe('kg')
    expect(it0.taxKind).toBe('exempt')
  })

  it('종전단가·결정단가·변동율을 숫자로 담는다', () => {
    const last = parsed.items[2]
    expect(last.previousPrice).toBe(2340)
    expect(last.price).toBe(2370)
    expect(last.deltaRate).toBeCloseTo(1.28)
  })
})

/**
 * 연월 검증 — **파일에 연월이 없다.**
 *
 * 헤더 어디에도 월 표기가 없고 파일명에만 `6월`이 있다. 사용자가 고른 연월이
 * 틀리면 **조용히 다른 달 단가가 들어간다.** 매달 5~10%가 바뀌므로 그냥 넘어간다.
 *
 * 다행히 데이터 안에 근거가 있다 — **새 파일의 종전단가 = 직전 달 결정단가**.
 * 실측: 6→7월 7,798/7,798, 7→8월 7,818/7,818 (100%).
 */
describe('checkPriceBookPeriod — 연월 오선택 차단', () => {
  const prev = [
    { productCode: '902769', price: 8140 },
    { productCode: '347395', price: 71400 },
    { productCode: '017392', price: 2340 },
  ]

  it('직전 달이 없으면 통과시킨다 (첫 달)', () => {
    const r = checkPriceBookPeriod([{ productCode: '902769', previousPrice: 8140 }], null)
    expect(r.ok).toBe(true)
    expect(r.matched).toBe(0)
  })

  it('종전단가가 직전 달 결정단가와 맞으면 통과', () => {
    const next = [
      { productCode: '902769', previousPrice: 8140 },
      { productCode: '347395', previousPrice: 71400 },
      { productCode: '017392', previousPrice: 2340 },
    ]
    const r = checkPriceBookPeriod(next, prev)
    expect(r.ok).toBe(true)
    expect(r.matched).toBe(3)
    expect(r.mismatched).toBe(0)
  })

  it('많이 어긋나면 막는다 — 연월을 잘못 골랐다는 뜻', () => {
    const wrong = [
      { productCode: '902769', previousPrice: 9999 },
      { productCode: '347395', previousPrice: 8888 },
      { productCode: '017392', previousPrice: 2340 },
    ]
    const r = checkPriceBookPeriod(wrong, prev)
    expect(r.ok).toBe(false)
    expect(r.mismatched).toBe(2)
    expect(r.message).toContain('연월')
  })

  it('몇 건 어긋나는 정도는 통과 — 품목이 갈리는 일은 늘 있다', () => {
    const mostly = [
      { productCode: '902769', previousPrice: 8140 },
      { productCode: '347395', previousPrice: 71400 },
      { productCode: '017392', previousPrice: 1 }, // 1/3 어긋남
    ]
    // 문턱 97% — 정상이 100%, 한 달 건너뛴 오선택이 88.8%였다 (실측)
    expect(checkPriceBookPeriod(mostly, prev).ok).toBe(false)
    const many = Array.from({ length: 100 }, (_, i) => ({
      productCode: String(900000 + i),
      previousPrice: 100,
    }))
    const manyPrev = many.map((m, i) => ({
      productCode: m.productCode,
      price: i < 2 ? 999 : 100, // 2/100 = 2% 어긋남 — 소급 정정 정도는 통과
    }))
    expect(checkPriceBookPeriod(many, manyPrev).ok).toBe(true)
  })
})

describe('normalizeProductCode', () => {
  it('숫자·문자·공백을 6자리 문자열로 맞춘다', () => {
    expect(normalizeProductCode(17392)).toBe('017392')
    expect(normalizeProductCode(' 902769 ')).toBe('902769')
    expect(normalizeProductCode('017392')).toBe('017392')
  })

  it('읽을 수 없으면 null', () => {
    expect(normalizeProductCode(null)).toBeNull()
    expect(normalizeProductCode('')).toBeNull()
  })
})

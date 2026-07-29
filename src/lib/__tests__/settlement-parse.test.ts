import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseShinsegaeSheet,
  parseCjSheet,
  aggregateByPartner,
  type NormalizedVenue,
} from '@/features/settlement'

/**
 * [정산] 원천 데이터 파서 TDD — docs/systems/settlement.md §5
 *
 * 두 원천의 **레벨이 다르다**:
 * - 신세계 `신세계_전체 일반` — 품목 단위, 2행 병합 헤더 (534품목 → 14 사업장×식당)
 * - CJ `CJ_전체 집계표` — 이미 사업장×식당 집계, 1행 헤더 + **2행이 총계**
 *
 * 공통 정규화 지점은 **사업장×식당×과세구분**이다.
 *
 * ## 2026-07-29 실측으로 확정한 사실
 *
 * `정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx` 기준:
 * - 신세계 원가합계 19,324,963 / 단가합계 31,078,599
 * - CJ     원가합계 54,684,053 / 단가합계 71,281,233 (자체 총계행과 일치)
 * - 두 원천 합계 = `집계표_정산용` 합계행 **74,009,016 / 102,359,832 원단위 일치**
 * - 두 원천의 사업장코드 체계가 다르고(신세계 88689 / CJ 1008) **담당 유치원이 겹치지 않는다**
 *   → 매핑 키는 `(원천, 사업장코드)`, 병합 불필요
 * - `면과세` 컬럼 값은 정확히 `과세` / `면세` 두 종류
 * - 신세계에는 `키즈웰에듀푸드(본사)`가 섞여 있고 **정산 대상이 아니다**
 *
 * ## SheetJS 주의
 *
 * `sheet_to_json(sheet, { header: 1 })`은 각 행의 **trailing 빈 셀을 배열에서 제거**한다.
 * 따라서 행 길이가 헤더보다 짧을 수 있다 (기존 excel-parser.ts에도 같은 주석이 있다).
 */

// ============================================================
// 픽스처 — 실제 시트의 행 모양을 그대로 재현 (열 위치가 핵심)
// ============================================================

/** 신세계: 1~2행 병합 헤더, 3행부터 데이터 */
const SHINSEGAE_HEADER: unknown[][] = [
  ['순번', '사업장', null, '식당', null, '입고일자', '카테고리', '품목코드', '품목명', '규격', '단위', '면과세', '수량', '납품', null, null, null, '가맹점'],
  [null, '코드', '명', '코드', '명', null, null, null, null, null, null, null, null, '단가', '금액', '세액', '총액', '단가', '금액', '세액', '총금액'],
]

/**
 * 실제 3행(과세) — 본사 / 쌀떡볶이
 * 납품 금액 9,050 세액 905 · 가맹점 금액 11,750 세액 1,175
 */
const SS_ROW_HQ_TAXABLE: unknown[] = [
  1, 88689, 'EDU)키즈_키즈웰에듀푸드(본사)', '01', '본사', '2026-06-24', '농산가공품',
  168427, '쌀떡볶이 동성식품', '1KG, 55개내외', '봉', '과세', 5,
  1810, 9050, 905, 9955, 2350, 11750, 1175, 12925,
]

/**
 * 실제 4행(면세) — 국제유치원 / 차조
 * 납품 금액 28,440 세액 0 · 가맹점 금액 45,880 세액 0
 */
const SS_ROW_INTL_EXEMPT: unknown[] = [
  2, 89890, 'EDU)키즈_국제유치원(키즈웰)', '01', '급식재료', '2026-06-01', '양곡',
  162323, '차조 농협 국내산 실온', '1KG', '봉', '면세', 2,
  14220, 28440, 0, 28440, 22940, 45880, 0, 45880,
]

/** 같은 사업장×식당에 과세 품목 추가 — 집계되는지 확인용 */
const SS_ROW_INTL_TAXABLE: unknown[] = [
  3, 89890, 'EDU)키즈_국제유치원(키즈웰)', '01', '급식재료', '2026-06-02', '농산가공품',
  111111, '두부', '300G', '개', '과세', 10,
  1000, 10000, 1000, 11000, 1500, 15000, 1500, 16500,
]

/** CJ: 1행 헤더, 2행 총계, 3행부터 데이터 */
const CJ_HEADER: unknown[][] = [
  ['번호', '사업장코드', '사업장', '식당코드', '식당명', '사업부', '팀',
    '원가/과세/공급가', '원가/과세/부가세', '원가/과세/금액', '원가/면세', '원가/합계(a)',
    '단가/과세/공급가', '단가/과세/부가세', '단가/과세/금액', '단가/면세', '단가/합계(b)', '차액(b-a)'],
  // ⚠️ 총계 행 — 사업장코드가 비어 있다. 이걸 데이터로 읽으면 금액이 두 배가 된다.
  ['총계', null, null, null, null, null, null,
    17726760, 1772676, 19499436, 35184617, 54684053,
    22923380, 2292338, 25215718, 46065515, 71281233, 16597180],
]

/** 실제 3행 — 선경유치원 */
const CJ_ROW_SEONKYUNG: unknown[] = [
  1, 1008, '키즈웰에듀푸드(선경유치원)', 1000, '키즈웰에듀푸드(선경유치원)', '기본사업부', '기본팀',
  1478110, 147811, 1625921, 2046990, 3672911,
  1773040, 177304, 1950344, 2455760, 4406104, 733193,
]

// ============================================================
// 1. 신세계 파서
// ============================================================
describe('parseShinsegaeSheet — 품목 → 사업장×식당 집계', () => {
  it('2행 병합 헤더를 데이터로 읽지 않는다', () => {
    const r = parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_HQ_TAXABLE])
    expect(r.venues).toHaveLength(1)
    expect(r.venues[0].businessCode).toBe('88689')
  })

  it('과세 품목은 공급가·부가세로 들어간다 (면세는 0)', () => {
    const [v] = parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_HQ_TAXABLE]).venues
    expect(v.cost).toEqual({ taxableSupply: 9_050, vat: 905, exempt: 0, total: 9_955 })
    expect(v.price).toEqual({ taxableSupply: 11_750, vat: 1_175, exempt: 0, total: 12_925 })
  })

  it('면세 품목은 면세로 들어간다 (공급가·부가세는 0)', () => {
    const [v] = parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_INTL_EXEMPT]).venues
    expect(v.cost).toEqual({ taxableSupply: 0, vat: 0, exempt: 28_440, total: 28_440 })
    expect(v.price).toEqual({ taxableSupply: 0, vat: 0, exempt: 45_880, total: 45_880 })
  })

  it('같은 사업장×식당의 품목을 하나로 합친다', () => {
    const r = parseShinsegaeSheet([
      ...SHINSEGAE_HEADER,
      SS_ROW_INTL_EXEMPT,
      SS_ROW_INTL_TAXABLE,
    ])
    expect(r.venues).toHaveLength(1)
    const v = r.venues[0]
    expect(v.cost).toEqual({
      taxableSupply: 10_000,
      vat: 1_000,
      exempt: 28_440,
      total: 39_440,
    })
    expect(v.price.total).toBe(45_880 + 16_500)
  })

  it('사업장이 다르면 따로 집계한다', () => {
    const r = parseShinsegaeSheet([
      ...SHINSEGAE_HEADER,
      SS_ROW_HQ_TAXABLE,
      SS_ROW_INTL_EXEMPT,
    ])
    expect(r.venues).toHaveLength(2)
    expect(r.venues.map((v) => v.businessCode).sort()).toEqual(['88689', '89890'])
  })

  it('같은 사업장이라도 식당이 다르면 따로 집계한다', () => {
    const other = [...SS_ROW_INTL_TAXABLE]
    other[3] = '02' // 식당코드만 변경
    const r = parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_INTL_EXEMPT, other])
    expect(r.venues).toHaveLength(2)
    expect(r.venues.map((v) => v.restaurantCode).sort()).toEqual(['01', '02'])
  })

  it('합계는 항상 공급가 + 부가세 + 면세다', () => {
    const r = parseShinsegaeSheet([
      ...SHINSEGAE_HEADER,
      SS_ROW_HQ_TAXABLE,
      SS_ROW_INTL_EXEMPT,
      SS_ROW_INTL_TAXABLE,
    ])
    for (const v of r.venues) {
      expect(v.cost.total).toBe(v.cost.taxableSupply + v.cost.vat + v.cost.exempt)
      expect(v.price.total).toBe(v.price.taxableSupply + v.price.vat + v.price.exempt)
    }
  })

  it('사업장코드가 빈 행은 건너뛴다', () => {
    const blank = new Array(21).fill(null)
    const r = parseShinsegaeSheet([...SHINSEGAE_HEADER, blank, SS_ROW_HQ_TAXABLE])
    expect(r.venues).toHaveLength(1)
  })

  it('trailing 빈 셀로 행이 짧아도 안전하다 (SheetJS 특성)', () => {
    const short = SS_ROW_HQ_TAXABLE.slice(0, 17) // 가맹점 열이 잘린 행
    const r = parseShinsegaeSheet([...SHINSEGAE_HEADER, short])
    expect(r.venues).toHaveLength(1)
    expect(r.venues[0].price.total).toBe(0)
    expect(r.venues[0].cost.total).toBe(9_955)
  })

  it('면과세 값이 과세/면세가 아니면 경고하고 해당 행을 버린다', () => {
    const weird = [...SS_ROW_HQ_TAXABLE]
    weird[11] = '기타'
    const r = parseShinsegaeSheet([...SHINSEGAE_HEADER, weird])
    expect(r.venues).toHaveLength(0)
    expect(r.warnings.join()).toContain('면과세')
  })

  it('원천 표시는 shinsegae다', () => {
    const [v] = parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_HQ_TAXABLE]).venues
    expect(v.source).toBe('shinsegae')
  })
})

// ============================================================
// 2. CJ 파서
// ============================================================
describe('parseCjSheet — 이미 집계된 시트', () => {
  it('총계 행을 데이터로 읽지 않는다 (읽으면 금액이 두 배가 된다)', () => {
    const r = parseCjSheet([...CJ_HEADER, CJ_ROW_SEONKYUNG])
    expect(r.venues).toHaveLength(1)
    expect(r.venues[0].businessCode).toBe('1008')
    expect(r.venues[0].cost.total).toBe(3_672_911)
  })

  it('원가·단가를 과세공급가/부가세/면세로 매핑한다', () => {
    const [v] = parseCjSheet([...CJ_HEADER, CJ_ROW_SEONKYUNG]).venues
    expect(v.cost).toEqual({
      taxableSupply: 1_478_110,
      vat: 147_811,
      exempt: 2_046_990,
      total: 3_672_911,
    })
    expect(v.price).toEqual({
      taxableSupply: 1_773_040,
      vat: 177_304,
      exempt: 2_455_760,
      total: 4_406_104,
    })
  })

  it('시트에 적힌 합계와 재계산 값이 다르면 경고한다', () => {
    const broken = [...CJ_ROW_SEONKYUNG]
    broken[11] = 9_999_999 // 원가/합계(a) 를 틀린 값으로
    const r = parseCjSheet([...CJ_HEADER, broken])
    expect(r.warnings.join()).toContain('합계')
    // 경고는 하지만 재계산 값을 신뢰한다
    expect(r.venues[0].cost.total).toBe(3_672_911)
  })

  it('식당명·사업장명을 보존한다', () => {
    const [v] = parseCjSheet([...CJ_HEADER, CJ_ROW_SEONKYUNG]).venues
    expect(v.businessName).toBe('키즈웰에듀푸드(선경유치원)')
    expect(v.restaurantCode).toBe('1000')
    expect(v.source).toBe('cj')
  })
})

// ============================================================
// 3. 영업자별 집계 — 매핑 누락은 마감 차단 사유 (docs §8)
// ============================================================
describe('aggregateByPartner', () => {
  const venues: NormalizedVenue[] = [
    ...parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_INTL_EXEMPT, SS_ROW_INTL_TAXABLE]).venues,
    ...parseCjSheet([...CJ_HEADER, CJ_ROW_SEONKYUNG]).venues,
  ]

  it('원천이 달라도 같은 영업자면 합산한다', () => {
    const r = aggregateByPartner(venues, {
      'shinsegae:89890': '김영수',
      'cj:1008': '김영수',
    })
    expect(r.partners).toHaveLength(1)
    const p = r.partners[0]
    expect(p.partnerId).toBe('김영수')
    expect(p.costTotal).toBe(39_440 + 3_672_911)
    expect(p.costVat).toBe(1_000 + 147_811)
    expect(p.priceTotal).toBe(62_380 + 4_406_104)
    expect(p.priceVat).toBe(1_500 + 177_304)
  })

  it('영업자가 다르면 분리한다', () => {
    const r = aggregateByPartner(venues, {
      'shinsegae:89890': '김영수',
      'cj:1008': '조성곤',
    })
    expect(r.partners.map((p) => p.partnerId).sort()).toEqual(['김영수', '조성곤'])
  })

  it('매핑이 없는 사업장은 경고에 남기고 집계에서 제외한다', () => {
    const r = aggregateByPartner(venues, { 'shinsegae:89890': '김영수' })
    expect(r.partners).toHaveLength(1)
    expect(r.unmapped).toHaveLength(1)
    expect(r.unmapped[0].businessCode).toBe('1008')
    expect(r.warnings.join()).toContain('매핑')
  })

  it('매핑 누락이 없으면 마감 가능하다', () => {
    const ok = aggregateByPartner(venues, {
      'shinsegae:89890': '김영수',
      'cj:1008': '김영수',
    })
    expect(ok.unmapped).toHaveLength(0)
    expect(ok.warnings).toHaveLength(0)
  })

  // ── 의도적 정산 제외 (본사) — 누락과 반드시 구분해야 한다 ──
  describe('정산 제외 (매핑값 null) — 예: 키즈웰에듀푸드(본사)', () => {
    const withHq: NormalizedVenue[] = [
      ...parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_HQ_TAXABLE]).venues, // 88689 본사
      ...parseShinsegaeSheet([...SHINSEGAE_HEADER, SS_ROW_INTL_EXEMPT]).venues, // 89890
    ]

    it('null로 표시한 사업장은 excluded로 분류하고 경고하지 않는다', () => {
      const r = aggregateByPartner(withHq, {
        'shinsegae:88689': null, // 본사 — 정산 대상 아님
        'shinsegae:89890': '김영수',
      })
      expect(r.excluded).toHaveLength(1)
      expect(r.excluded[0].businessCode).toBe('88689')
      expect(r.unmapped).toHaveLength(0)
      expect(r.warnings).toHaveLength(0) // 의도된 제외라서 경고 없음
    })

    it('제외된 사업장 금액은 영업자 합계에 들어가지 않는다', () => {
      const r = aggregateByPartner(withHq, {
        'shinsegae:88689': null,
        'shinsegae:89890': '김영수',
      })
      expect(r.partners).toHaveLength(1)
      expect(r.partners[0].costTotal).toBe(28_440) // 국제유치원 면세분만
      expect(r.partners[0].venues).toHaveLength(1)
    })

    it('제외와 누락이 섞여 있으면 각각 분리한다 (마감 검증의 핵심)', () => {
      const r = aggregateByPartner(withHq, {
        'shinsegae:88689': null, // 의도적 제외
        // 'shinsegae:89890' 누락
      })
      expect(r.excluded).toHaveLength(1)
      expect(r.unmapped).toHaveLength(1)
      expect(r.unmapped[0].businessCode).toBe('89890')
      // 경고는 누락에 대해서만 발생해야 한다
      expect(r.warnings).toHaveLength(1)
      expect(r.warnings[0]).toContain('89890')
      expect(r.warnings[0]).not.toContain('88689')
    })

    it('빈 문자열은 제외가 아니라 누락으로 본다 (실수 방지)', () => {
      const r = aggregateByPartner(withHq, {
        'shinsegae:88689': '',
        'shinsegae:89890': '김영수',
      })
      expect(r.excluded).toHaveLength(0)
      expect(r.unmapped).toHaveLength(1)
      expect(r.warnings).toHaveLength(1)
    })
  })

  it('집계 결과는 calcSettlement 입력 형태와 맞는다', () => {
    const r = aggregateByPartner(venues, {
      'shinsegae:89890': '김영수',
      'cj:1008': '김영수',
    })
    const p = r.partners[0]
    expect(p).toMatchObject({
      costTotal: expect.any(Number),
      costVat: expect.any(Number),
      priceTotal: expect.any(Number),
      priceVat: expect.any(Number),
    })
    expect(p.venues).toHaveLength(2)
  })
})

// ============================================================
// 4. 실파일 통합 검증 — 파일이 있을 때만 (저장소에 커밋하지 않는 업무 자료)
// ============================================================
const SOURCE_FILE = path.join(
  process.cwd(),
  '정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx'
)
const hasSource = existsSync(SOURCE_FILE)

describe.skipIf(!hasSource)('26년 6월 실파일 통합 검증', () => {
  async function loadRows(sheetName: string): Promise<unknown[][]> {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(readFileSync(SOURCE_FILE), { type: 'buffer' })
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      blankrows: false,
    }) as unknown[][]
  }

  it('신세계 534품목 → 14 사업장×식당, 합계 19,324,963 / 31,078,599', async () => {
    const r = parseShinsegaeSheet(await loadRows('신세계_전체 일반'))
    expect(r.warnings).toHaveLength(0)
    expect(r.venues).toHaveLength(14)
    const cost = r.venues.reduce((s, v) => s + v.cost.total, 0)
    const price = r.venues.reduce((s, v) => s + v.price.total, 0)
    expect(cost).toBe(19_324_963)
    expect(price).toBe(31_078_599)
  })

  it('CJ 37행, 합계 54,684,053 / 71,281,233 (자체 총계행과 일치)', async () => {
    const r = parseCjSheet(await loadRows('CJ_전체 집계표'))
    expect(r.venues).toHaveLength(37)
    const cost = r.venues.reduce((s, v) => s + v.cost.total, 0)
    const price = r.venues.reduce((s, v) => s + v.price.total, 0)
    expect(cost).toBe(54_684_053)
    expect(price).toBe(71_281_233)
  })

  it('두 원천 합계가 집계표_정산용 합계행과 일치한다 (74,009,016 / 102,359,832)', async () => {
    const ss = parseShinsegaeSheet(await loadRows('신세계_전체 일반'))
    const cj = parseCjSheet(await loadRows('CJ_전체 집계표'))
    const all = [...ss.venues, ...cj.venues]
    expect(all.reduce((s, v) => s + v.cost.total, 0)).toBe(74_009_016)
    expect(all.reduce((s, v) => s + v.price.total, 0)).toBe(102_359_832)
  })

  it('사업장코드는 두 원천 사이에서 겹치지 않는다', async () => {
    const ss = parseShinsegaeSheet(await loadRows('신세계_전체 일반'))
    const cj = parseCjSheet(await loadRows('CJ_전체 집계표'))
    const ssCodes = new Set(ss.venues.map((v) => v.businessCode))
    const cjCodes = new Set(cj.venues.map((v) => v.businessCode))
    expect([...ssCodes].filter((c) => cjCodes.has(c))).toHaveLength(0)
    expect(ssCodes.size).toBe(4)
    expect(cjCodes.size).toBe(13)
  })
})

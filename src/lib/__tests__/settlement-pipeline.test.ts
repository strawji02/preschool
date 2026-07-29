import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  parseShinsegaeSheet,
  parseCjSheet,
  aggregateByPartner,
  calcSettlement,
  type PartnerMapping,
  type PartnerType,
} from '@/features/settlement'

/**
 * [정산] 전 구간 통합 검증 — 원천 엑셀 → 파서 → 매핑 → 집계 → 산식 → 실지급액
 *
 * 개별 단위 테스트(settlement-formula / settlement-parse)가 각 조각을 고정하지만,
 * **조각을 이어붙였을 때 실제 엑셀과 같은 답이 나오는지**는 여기서만 확인된다.
 * 중간에 집계 단위가 틀리거나 매핑이 어긋나면 단위 테스트는 통과하면서 결과가 달라진다.
 *
 * 근거 파일: `정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx`
 * 업무 자료라 저장소에 커밋하지 않으므로, 파일이 있을 때만 실행한다.
 */

const SOURCE_FILE = path.join(
  process.cwd(),
  '정산시스템_개발용_급식_정산_종합_26년_6월분.xlsx'
)

/**
 * 26년 6월 실제 영업자–사업장 매핑 (2026-07-29 추출·검증).
 *
 * `집계표_정산용`의 영업자 그룹을 식당명으로 원천 시트와 대조해 사업장코드를 역추적했다.
 * 51개 식당행 전부 매칭에 성공했고, 이 매핑으로 집계한 영업자별 원가·단가 합계가
 * 엑셀 `계` 행과 원단위 일치함을 확인했다.
 *
 * `본사`는 `null` — 정산 대상이 아니다(엑셉 `계` 행에도 지급액이 없다).
 * 매핑 누락과 구분하기 위해 명시적으로 null을 넣는다.
 */
const JUNE_2026_MAPPING: PartnerMapping = {
  'shinsegae:88689': null, // 키즈웰에듀푸드(본사) — 정산 제외

  'shinsegae:89912': '김중영', // 나래유치원
  'cj:1003': '김중영', // 재능유치원
  'cj:1005': '김중영', // 해밀유치원
  'cj:1008': '김중영', // 선경유치원
  'cj:1014': '김중영', // 율화유치원
  'cj:1015': '김중영', // 미래샘유치원

  'shinsegae:89890': '이동현', // 국제유치원
  'cj:1002': '이동현', // 젬마유치원
  'cj:1004': '이동현', // 천안_복자유치원
  'cj:1006': '이동현', // 우현유치원
  'cj:1007': '이동현', // 부산_복자유치원
  'cj:1011': '이동현', // 부산_해성유치원
  'cj:1016': '이동현', // 복자유치원

  'shinsegae:90223': '조성곤', // 수원복자유치원
  'cj:1010': '조성곤', // 우성유치원

  'cj:1013': '김영수', // 아름솔유치원
}

/** 영업자 유형 + 사업자공제(Q, 매월 수기 입력) — 엑셀 `집계표_정산용` Q열 실측값 */
const PARTNER_CONFIG: Record<
  string,
  { partnerType: PartnerType; businessDeduction: number }
> = {
  김중영: { partnerType: 'cofounder', businessDeduction: 624_000 },
  이동현: { partnerType: 'cofounder', businessDeduction: 1_696_500 },
  조성곤: { partnerType: 'cofounder', businessDeduction: 0 },
  김영수: { partnerType: 'partner', businessDeduction: 0 },
}

/** 엑셀 `집계표_정산용` 영업자별 `계` 행 실측값 */
const EXPECTED = {
  김중영: {
    costTotal: 24_642_816,
    costVat: 762_890,
    priceTotal: 34_270_849,
    priceVat: 1_051_286,
    margin: 9_628_033,
    platformFee: 1_194_000,
    vatDiff: 288_396,
    preTax: 7_521_637,
    // ⚠️ 원본 엑셀은 원천징수가 누락돼 V=0,S=0,T=0,U=R 이었다.
    // docs §3 확정 규칙대로 시스템은 징수한다 — 4명 중 유일하게 엑셀과 다른 값.
    declared: 8_715_637,
    netPay: 7_234_037,
  },
  이동현: {
    costTotal: 39_311_775,
    costVat: 1_356_855,
    priceTotal: 55_029_088,
    priceVat: 1_887_351,
    margin: 15_717_313,
    platformFee: 1_897_750,
    vatDiff: 530_496,
    preTax: 11_592_567,
    declared: 13_490_317,
    netPay: 11_147_397,
  },
  조성곤: {
    costTotal: 4_156_582,
    costVat: 101_972,
    priceTotal: 5_401_093,
    priceVat: 132_468,
    margin: 1_244_511,
    platformFee: 202_740,
    vatDiff: 30_496,
    preTax: 1_011_275,
    declared: 1_214_015,
    netPay: 971_215,
  },
  김영수: {
    costTotal: 5_887_888,
    costVat: 190_613,
    priceTotal: 7_645_877,
    priceVat: 247_137,
    margin: 1_757_989,
    platformFee: 284_870,
    vatDiff: 56_524,
    preTax: 1_416_595,
    declared: 1_416_595,
    netPay: 1_369_865,
  },
} as const

describe.skipIf(!existsSync(SOURCE_FILE))('26년 6월 전 구간 통합 검증', () => {
  async function runPipeline() {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(readFileSync(SOURCE_FILE), { type: 'buffer' })
    const rows = (name: string) =>
      XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1,
        blankrows: false,
      }) as unknown[][]

    const ss = parseShinsegaeSheet(rows('신세계_전체 일반'))
    const cj = parseCjSheet(rows('CJ_전체 집계표'))
    const agg = aggregateByPartner([...ss.venues, ...cj.venues], JUNE_2026_MAPPING)

    const settlements = agg.partners.map((p) => {
      const cfg = PARTNER_CONFIG[p.partnerId]
      return {
        partnerId: p.partnerId,
        totals: p,
        result: calcSettlement({
          costTotal: p.costTotal,
          costVat: p.costVat,
          priceTotal: p.priceTotal,
          priceVat: p.priceVat,
          partnerType: cfg.partnerType,
          businessDeduction: cfg.businessDeduction,
        }),
      }
    })

    return { ss, cj, agg, settlements }
  }

  it('파서 경고가 없다 (원천 데이터가 예상 구조와 일치)', async () => {
    const { ss, cj } = await runPipeline()
    expect(ss.warnings).toEqual([])
    expect(cj.warnings).toEqual([])
  })

  it('매핑 누락이 없고 본사만 정산 제외된다 (마감 가능 상태)', async () => {
    const { agg } = await runPipeline()
    expect(agg.unmapped).toEqual([])
    expect(agg.warnings).toEqual([])
    expect(agg.excluded).toHaveLength(1)
    expect(agg.excluded[0].businessName).toContain('본사')
  })

  it('영업자 4명이 집계된다', async () => {
    const { agg } = await runPipeline()
    expect(agg.partners.map((p) => p.partnerId).sort()).toEqual([
      '김영수',
      '김중영',
      '이동현',
      '조성곤',
    ])
  })

  for (const [name, exp] of Object.entries(EXPECTED)) {
    describe(name, () => {
      it('집계된 원가·단가가 엑셀 계 행과 일치한다', async () => {
        const { settlements } = await runPipeline()
        const s = settlements.find((x) => x.partnerId === name)!
        expect(s.totals.costTotal).toBe(exp.costTotal)
        expect(s.totals.costVat).toBe(exp.costVat)
        expect(s.totals.priceTotal).toBe(exp.priceTotal)
        expect(s.totals.priceVat).toBe(exp.priceVat)
      })

      it('산식 결과가 엑셀과 일치한다 (M·O·P·R)', async () => {
        const { settlements } = await runPipeline()
        const r = settlements.find((x) => x.partnerId === name)!.result
        expect(r.margin).toBe(exp.margin)
        expect(r.platformFee).toBe(exp.platformFee)
        expect(r.vatDiff).toBe(exp.vatDiff)
        expect(r.preTax).toBe(exp.preTax)
      })

      it('신고액·실지급액이 확정 규칙과 일치한다 (V·U)', async () => {
        const { settlements } = await runPipeline()
        const r = settlements.find((x) => x.partnerId === name)!.result
        expect(r.declared).toBe(exp.declared)
        expect(r.netPay).toBe(exp.netPay)
      })

      it('세전이 양수라 0 처리 경고가 없다', async () => {
        const { settlements } = await runPipeline()
        const r = settlements.find((x) => x.partnerId === name)!.result
        expect(r.warnings).toEqual([])
      })
    })
  }

  it('세전 합계가 엑셀 합계행(21,542,074)과 일치한다', async () => {
    const { settlements } = await runPipeline()
    const total = settlements.reduce((s, x) => s + x.result.preTax, 0)
    expect(total).toBe(21_542_074)
  })

  it('본사를 제외한 원가 합계가 전체(74,009,016)에서 본사분만큼 적다', async () => {
    const { agg, settlements } = await runPipeline()
    const partnerCost = settlements.reduce((s, x) => s + x.totals.costTotal, 0)
    const excludedCost = agg.excluded.reduce((s, v) => s + v.cost.total, 0)
    expect(partnerCost + excludedCost).toBe(74_009_016)
    expect(excludedCost).toBeGreaterThan(0) // 본사도 거래가 있었다
  })
})

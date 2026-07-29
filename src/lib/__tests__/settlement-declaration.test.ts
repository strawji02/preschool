import { describe, it, expect } from 'vitest'
import {
  buildDeclarationLines,
  buildDeclarationSheet,
  calcNameWithholding,
  DECLARATION_COL,
  type DeclarationPartner,
} from '@/features/settlement'

/**
 * [정산] 사업소득 지급명세서 (docs §6-3, 세무사 제출용)
 *
 * 근거 파일 `사업소득 신고내역` 시트를 그대로 재현한다 (2026-07-30 실측).
 *
 * ```
 *  1행: 26년 6월 사업소득 신고 내역_종합   (A1:H1 병합)
 *  6행: ◆ 키즈웰에듀푸드(831-05-03575)
 *  7행: 구분 성명 사업소득액 소득세 지방소득세 소득세계 실지급액 주민번호
 *  8행~: 1 김인순 5,000,000 150,000 15,000 165,000 4,835,000 (주민번호 빈칸)
 *  13행: 계 (A13:B13 병합)
 *  15행: 예성세무회계 / 16행: ysd8304@naver.com
 * ```
 *
 * ⚠️ 이 시트에는 `집계표_정산용`과 **다른 정의가 두 개** 있다:
 *
 * 1. **세액은 명의별로 계산된다** — 영업자 전체 신고액이 아니라 분할된 각 명의의
 *    금액에 3%/10%를 적용한다. 실제로 각 사람 앞으로 원천징수되기 때문이다.
 * 2. **이 시트의 `실지급액` = 사업소득액 − 소득세계**다. 집계표의 실지급(U)은
 *    `세전(R) − 소득세 − 지방세`이므로 값이 다르다. 여기는 신고 문서라
 *    신고액에서만 세금을 뺀 금액을 적는다.
 */

/** 26년 6월 원본 `사업소득 신고내역` 실값 (row 8~12) */
const JUNE_ROWS = [
  { name: '김인순', amount: 5_000_000, incomeTax: 150_000, localTax: 15_000, taxTotal: 165_000, netPay: 4_835_000 },
  { name: '이유나', amount: 4_000_000, incomeTax: 120_000, localTax: 12_000, taxTotal: 132_000, netPay: 3_868_000 },
  { name: '이동현', amount: 4_490_317, incomeTax: 134_700, localTax: 13_470, taxTotal: 148_170, netPay: 4_342_147 },
  { name: '조성곤', amount: 1_214_015, incomeTax: 36_420, localTax: 3_640, taxTotal: 40_060, netPay: 1_173_955 },
  { name: '김영수', amount: 1_416_595, incomeTax: 42_490, localTax: 4_240, taxTotal: 46_730, netPay: 1_369_865 },
] as const

/** 원본과 동일한 구성 — 이동현만 3명으로 분할 신고, 김중영은 원본에 없다 */
const JUNE_PARTNERS: DeclarationPartner[] = [
  {
    partnerName: '이동현',
    declared: 13_490_317,
    splits: [
      { name: '김인순', amount: 5_000_000 },
      { name: '이유나', amount: 4_000_000 },
      { name: '이동현', amount: 4_490_317 },
    ],
  },
  { partnerName: '조성곤', declared: 1_214_015 },
  { partnerName: '김영수', declared: 1_416_595 },
]

describe('calcNameWithholding — 명의별 원천징수', () => {
  it('소득세는 사업소득액의 3%를 10원 내림', () => {
    // 4,490,317 × 3% = 134,709.51 → 134,700
    expect(calcNameWithholding(4_490_317).incomeTax).toBe(134_700)
  })

  it('지방소득세는 소득세의 10%를 10원 내림', () => {
    // 36,420 × 10% = 3,642 → 3,640 (반올림이 아니다)
    expect(calcNameWithholding(1_214_015).localTax).toBe(3_640)
  })

  it('실지급액은 사업소득액 − 소득세계다 (집계표의 U와 다르다)', () => {
    const r = calcNameWithholding(1_214_015)
    expect(r.taxTotal).toBe(40_060)
    expect(r.netPay).toBe(1_214_015 - 40_060)
    expect(r.netPay).toBe(1_173_955)
  })

  it('26년 6월 원본 5개 행과 원단위까지 일치한다', () => {
    for (const row of JUNE_ROWS) {
      expect(calcNameWithholding(row.amount), row.name).toEqual({
        incomeTax: row.incomeTax,
        localTax: row.localTax,
        taxTotal: row.taxTotal,
        netPay: row.netPay,
      })
    }
  })

  it('금액이 0이면 세금도 0이다', () => {
    expect(calcNameWithholding(0)).toEqual({
      incomeTax: 0,
      localTax: 0,
      taxTotal: 0,
      netPay: 0,
    })
  })
})

describe('buildDeclarationLines', () => {
  it('분할이 없는 영업자는 본인 명의 1행이 된다', () => {
    const { lines } = buildDeclarationLines([
      { partnerName: '김영수', declared: 1_416_595 },
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ seq: 1, name: '김영수', amount: 1_416_595 })
  })

  it('분할이 있으면 명의별로 행이 나뉜다 (원본 순서 유지)', () => {
    const { lines } = buildDeclarationLines(JUNE_PARTNERS)
    expect(lines.map((l) => l.name)).toEqual([
      '김인순',
      '이유나',
      '이동현',
      '조성곤',
      '김영수',
    ])
  })

  it('구분 열은 1부터 이어지는 일련번호다', () => {
    const { lines } = buildDeclarationLines(JUNE_PARTNERS)
    expect(lines.map((l) => l.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('26년 6월 원본 5개 행을 그대로 재현한다', () => {
    const { lines } = buildDeclarationLines(JUNE_PARTNERS)
    expect(lines).toHaveLength(JUNE_ROWS.length)
    JUNE_ROWS.forEach((row, i) => {
      expect(lines[i], row.name).toMatchObject({
        name: row.name,
        amount: row.amount,
        incomeTax: row.incomeTax,
        localTax: row.localTax,
        taxTotal: row.taxTotal,
        netPay: row.netPay,
      })
    })
  })

  it('합계는 원본 계 행과 일치한다', () => {
    const { totals } = buildDeclarationLines(JUNE_PARTNERS)
    expect(totals.amount).toBe(16_120_927)
    expect(totals.incomeTax).toBe(483_610)
    expect(totals.localTax).toBe(48_350)
    expect(totals.taxTotal).toBe(531_960)
    expect(totals.netPay).toBe(15_588_967)
  })

  it('신고액이 0이면 행을 만들지 않고 알려준다', () => {
    // 세전이 음수여서 0으로 처리된 영업자. 신고할 소득이 없으므로 명세서에 넣지 않는다.
    const { lines, warnings } = buildDeclarationLines([
      { partnerName: '홍길동', declared: 0 },
      { partnerName: '김영수', declared: 1_416_595 },
    ])
    expect(lines.map((l) => l.name)).toEqual(['김영수'])
    expect(warnings.join(' ')).toContain('홍길동')
  })

  it('분할 합계가 신고액과 다르면 경고한다 (마감 차단 사유)', () => {
    const { warnings } = buildDeclarationLines([
      {
        partnerName: '이동현',
        declared: 13_490_317,
        splits: [
          { name: '김인순', amount: 5_000_000 },
          { name: '이동현', amount: 4_490_317 },
        ],
      },
    ])
    expect(warnings.join(' ')).toContain('이동현')
    expect(warnings.join(' ')).toContain('4,000,000')
  })

  it('분할 합계가 맞으면 경고가 없다', () => {
    const { warnings } = buildDeclarationLines(JUNE_PARTNERS)
    expect(warnings).toEqual([])
  })

  it('명의별 세액 합이 전체 기준 세액과 다르면 경고한다', () => {
    // 명의별로 10원 내림을 하므로 합이 전체 기준과 어긋날 수 있다.
    // 100원씩 3분할: 각 소득세 0 (100×3%=3 → 0) / 전체 300×3%=9 → 0. 같다.
    // 400원 = 200+200: 각 200×3%=6→0, 합 0 / 전체 400×3%=12→10. 10원 차이가 난다.
    const { warnings } = buildDeclarationLines([
      {
        partnerName: '테스트',
        declared: 400,
        splits: [
          { name: 'A', amount: 200 },
          { name: 'B', amount: 200 },
        ],
      },
    ])
    expect(warnings.join(' ')).toContain('원천징수')
  })

  it('26년 6월 이동현은 명의별 합과 전체 기준이 일치한다', () => {
    // 우연이 아니라 확인이 필요한 사항이므로 픽스처로 고정한다.
    const { warnings } = buildDeclarationLines([JUNE_PARTNERS[0]!])
    expect(warnings.filter((w) => w.includes('원천징수'))).toEqual([])
  })
})

describe('buildDeclarationSheet — 원본 레이아웃', () => {
  const sheet = buildDeclarationSheet({
    periodLabel: '26년 6월',
    partners: JUNE_PARTNERS,
  })

  it('1행은 제목이고 A1:H1로 병합된다', () => {
    expect(sheet.rows[0]?.[0]).toBe('26년 6월 사업소득 신고 내역_종합')
    expect(sheet.merges).toContainEqual({
      s: { r: 0, c: 0 },
      e: { r: 0, c: DECLARATION_COL.residentId },
    })
  })

  it('2~5행은 비어 있다 (원본과 동일)', () => {
    for (const r of [1, 2, 3, 4]) {
      expect(sheet.rows[r]?.some((v) => v !== null && v !== ''), `${r + 1}행`).toBeFalsy()
    }
  })

  it('6행은 사업자 표시다', () => {
    expect(sheet.rows[5]?.[0]).toBe('◆ 키즈웰에듀푸드(831-05-03575)')
  })

  it('7행 헤더는 원본과 같은 순서다', () => {
    expect(sheet.rows[6]).toEqual([
      '구분',
      '성명',
      '사업소득액',
      '소득세',
      '지방소득세',
      '소득세계',
      '실지급액',
      '주민번호',
    ])
  })

  it('8행부터 명의별 행이 들어간다', () => {
    expect(sheet.rows[7]?.slice(0, 7)).toEqual([
      1,
      '김인순',
      5_000_000,
      150_000,
      15_000,
      165_000,
      4_835_000,
    ])
  })

  it('주민번호 열은 항상 비어 있다 (docs §7 — 저장하지 않는다)', () => {
    for (let r = 7; r < 7 + JUNE_ROWS.length; r++) {
      expect(sheet.rows[r]?.[DECLARATION_COL.residentId], `${r + 1}행`).toBeNull()
    }
  })

  it('계 행은 성명 열까지 병합되고 합계를 담는다', () => {
    const totalRow = 7 + JUNE_ROWS.length
    expect(sheet.rows[totalRow]?.[DECLARATION_COL.seq]).toBe('계')
    expect(sheet.rows[totalRow]?.[DECLARATION_COL.name]).toBeNull()
    expect(sheet.rows[totalRow]?.[DECLARATION_COL.amount]).toBe(16_120_927)
    expect(sheet.rows[totalRow]?.[DECLARATION_COL.netPay]).toBe(15_588_967)
    expect(sheet.merges).toContainEqual({
      s: { r: totalRow, c: DECLARATION_COL.seq },
      e: { r: totalRow, c: DECLARATION_COL.name },
    })
  })

  it('원본과 같은 행 위치에 세무사 정보가 온다', () => {
    const totalRow = 7 + JUNE_ROWS.length // 12 (원본 13행)
    expect(sheet.rows[totalRow + 2]?.[0]).toBe('예성세무회계')
    expect(sheet.rows[totalRow + 3]?.[0]).toBe('ysd8304@naver.com')
  })

  it('경고는 시트가 아니라 결과로 돌려준다 (문서에 섞으면 제출용으로 못 쓴다)', () => {
    const bad = buildDeclarationSheet({
      periodLabel: '26년 6월',
      partners: [
        {
          partnerName: '이동현',
          declared: 13_490_317,
          splits: [{ name: '이동현', amount: 1_000 }],
        },
      ],
    })
    expect(bad.warnings.length).toBeGreaterThan(0)
    const flat = bad.rows.flat().filter((v) => typeof v === 'string')
    expect(flat.some((v) => (v as string).includes('경고'))).toBe(false)
  })

  it('사업자·세무사 정보를 바꿀 수 있다', () => {
    const custom = buildDeclarationSheet({
      periodLabel: '26년 7월',
      partners: [{ partnerName: '김영수', declared: 1_416_595 }],
      businessLabel: '◆ 다른상호(123-45-67890)',
      accountantName: '다른세무',
      accountantEmail: 'x@y.com',
    })
    expect(custom.rows[0]?.[0]).toBe('26년 7월 사업소득 신고 내역_종합')
    expect(custom.rows[5]?.[0]).toBe('◆ 다른상호(123-45-67890)')
    expect(custom.rows[10]?.[0]).toBe('다른세무')
    expect(custom.rows[11]?.[0]).toBe('x@y.com')
  })
})

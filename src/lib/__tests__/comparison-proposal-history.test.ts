import { describe, expect, it } from 'vitest'
import {
  aggregateProposalMonth,
  buildOfficialProposalDashboard,
  buildStatementSnapshot,
  classifyHistoricalProposal,
  compareProposalSnapshots,
  normalizeKindergartenName,
  type ProposalAmountSnapshot,
  type ProposalVersionForAggregation,
  type OfficialProposalVersionInput,
} from '../comparison-proposal-history'

const amount = (monthlyProposedAmount: number): ProposalAmountSnapshot => ({
  monthlyExistingAmount: 1_000_000,
  monthlyProposedAmount,
  monthlySavings: 1_000_000 - monthlyProposedAmount,
  annualExistingAmount: 12_000_000,
  annualProposedAmount: monthlyProposedAmount * 12,
  annualSavings: (1_000_000 - monthlyProposedAmount) * 12,
  savingsPercent: ((1_000_000 - monthlyProposedAmount) / 1_000_000) * 100,
  supplyRate: 1.25,
  totalExtrasAnnual: 0,
})

describe('비교 제안서 발행·변경 이력', () => {
  it('행 순서와 파일명만 달라진 거래명세표는 동일하게 판정한다', () => {
    const a = buildStatementSnapshot([
      { supplier: '푸디스트', name: '감자', spec: '1kg', quantity: 2, unitPrice: 3000, totalPrice: 6000, sourceFileName: 'a.xlsx' },
      { supplier: '푸드머스', name: '양파', spec: '1kg', quantity: 1, unitPrice: 4000, totalPrice: 4000, sourceFileName: 'b.xlsx' },
    ])
    const b = buildStatementSnapshot([
      { supplier: '푸드머스', name: '양파', spec: '1kg', quantity: 1, unitPrice: 4000, totalPrice: 4000, sourceFileName: 'renamed.xlsx' },
      { supplier: '푸디스트', name: '감자', spec: '1kg', quantity: 2, unitPrice: 3000, totalPrice: 6000, sourceFileName: 'other.xlsx' },
    ])

    expect(a.hash).toBe(b.hash)
    expect(compareProposalSnapshots({ statement: a, amount: amount(800_000) }, { statement: b, amount: amount(800_000) }).statementChanged).toBe(false)
  })

  it('공급사가 다르면 같은 날짜·품목·금액이어도 별도 거래로 보존한다', () => {
    const first = buildStatementSnapshot([
      { supplier: '푸디스트', name: '감자', spec: '1kg', quantity: 2, unitPrice: 3000, totalPrice: 6000 },
    ])
    const second = buildStatementSnapshot([
      { supplier: '푸드머스', name: '감자', spec: '1kg', quantity: 2, unitPrice: 3000, totalPrice: 6000 },
    ])

    expect(first.hash).not.toBe(second.hash)
  })

  it('거래 수량 변경과 제안금액 동일을 분리해서 기록한다', () => {
    const previous = buildStatementSnapshot([
      { supplier: '푸디스트', name: '감자', spec: '1kg', quantity: 1, unitPrice: 3000, totalPrice: 3000 },
    ])
    const current = buildStatementSnapshot([
      { supplier: '푸디스트', name: '감자', spec: '1kg', quantity: 2, unitPrice: 3000, totalPrice: 6000 },
    ])

    const result = compareProposalSnapshots(
      { statement: previous, amount: amount(800_000) },
      { statement: current, amount: amount(800_000) },
    )
    expect(result.statementChanged).toBe(true)
    expect(result.proposalAmountChanged).toBe(false)
    expect(result.statementDiff.modifiedCount).toBe(1)
    expect(result.statementDiff.totalDelta).toBe(3000)
  })

  it('거래명세표는 같지만 제안금액이 1원 이상 달라지면 금액 변경이다', () => {
    const statement = buildStatementSnapshot([
      { supplier: '푸디스트', name: '감자', spec: '1kg', quantity: 1, unitPrice: 3000, totalPrice: 3000 },
    ])
    const result = compareProposalSnapshots(
      { statement, amount: amount(800_000) },
      { statement, amount: amount(799_999) },
    )

    expect(result.statementChanged).toBe(false)
    expect(result.proposalAmountChanged).toBe(true)
    expect(result.amountDiff.monthlyProposedAmount).toBe(-1)
  })

  it('월간 집계는 신규와 재발행을 분리하고 재발행 4분류 합을 보존한다', () => {
    const rows: ProposalVersionForAggregation[] = [
      { kindergartenId: 'k1', versionNo: 1, isEstimated: false, statementChanged: null, proposalAmountChanged: null },
      { kindergartenId: 'k1', versionNo: 2, isEstimated: false, statementChanged: true, proposalAmountChanged: true },
      { kindergartenId: 'k2', versionNo: 1, isEstimated: true, statementChanged: null, proposalAmountChanged: null },
      { kindergartenId: 'k2', versionNo: 2, isEstimated: false, statementChanged: false, proposalAmountChanged: true },
      { kindergartenId: 'k3', versionNo: 2, isEstimated: false, statementChanged: true, proposalAmountChanged: false },
      { kindergartenId: 'k3', versionNo: 3, isEstimated: false, statementChanged: false, proposalAmountChanged: false },
    ]
    const summary = aggregateProposalMonth(rows)

    expect(summary.totalVersions).toBe(6)
    expect(summary.newProposalCount).toBe(2)
    expect(summary.reissueCount).toBe(4)
    expect(summary.bothChangedCount).toBe(1)
    expect(summary.amountOnlyChangedCount).toBe(1)
    expect(summary.statementOnlyChangedCount).toBe(1)
    expect(summary.neitherChangedCount).toBe(1)
    expect(summary.estimatedCount).toBe(1)
    expect(summary.kindergartenCount).toBe(3)
  })

  it('과거 세션은 보고서 단계와 부가정보 보유 여부로 신뢰도를 구분한다', () => {
    expect(classifyHistoricalProposal({ currentStep: 'report', proposalExtras: { proposed_to: '소망유치원' } })?.confidence).toBe('high')
    expect(classifyHistoricalProposal({ currentStep: 'report', proposalExtras: {} })?.confidence).toBe('medium')
    expect(classifyHistoricalProposal({ currentStep: 'matching', proposalExtras: { children_count: 80 } })?.confidence).toBe('low')
    expect(classifyHistoricalProposal({ currentStep: 'matching', proposalExtras: {} })).toBeNull()
  })

  it('날짜·공급사·문서 표현을 제거해 유치원명을 안정적으로 묶는다', () => {
    expect(normalizeKindergartenName('소망유치원-26년6월')).toBe('소망유치원')
    expect(normalizeKindergartenName('소망유) 푸드머스 주문내역서_26년 6월')).toBe('소망유치원')
    expect(normalizeKindergartenName('서호_7월_신세계_7월')).toBe('서호')
  })
})

const dashboardRow = (
  overrides: Partial<OfficialProposalVersionInput>,
): OfficialProposalVersionInput => ({
  id: 'v1',
  proposalId: 'p1',
  sessionId: 's1',
  kindergartenId: 'k1',
  kindergartenName: '소망유치원',
  targetPeriod: '2026-09',
  rawVersionNo: 1,
  issueFormat: 'pptx',
  statementChanged: null,
  proposalAmountChanged: null,
  statementDiff: {},
  amountDiff: {},
  amountSnapshot: amount(800_000),
  changeReasons: [],
  isEstimated: false,
  issuedAt: '2026-09-02T00:00:00.000Z',
  issuerId: 'u1',
  issuerName: '김담당',
  issuerEmail: 'kim@example.com',
  ...overrides,
})

describe('공식 제안서 웹 대시보드 집계', () => {
  const options = {
    officialStartAt: '2026-09-01T00:00:00.000Z',
    monthStart: '2026-09-01T00:00:00.000Z',
    monthEnd: '2026-10-01T00:00:00.000Z',
    page: 1,
    pageSize: 20,
  }

  it('기존 추정본과 공식 시작일 전 자료를 완전히 제외하고 첫 실제 발행을 공식 v1로 만든다', () => {
    const result = buildOfficialProposalDashboard([
      dashboardRow({ id: 'estimated', rawVersionNo: 1, isEstimated: true, issuedAt: '2026-08-20T00:00:00.000Z' }),
      dashboardRow({ id: 'old-real', rawVersionNo: 2, issuedAt: '2026-08-25T00:00:00.000Z' }),
      dashboardRow({
        id: 'first-official',
        rawVersionNo: 3,
        issuedAt: '2026-09-02T00:00:00.000Z',
        statementChanged: true,
        proposalAmountChanged: true,
        statementDiff: { modifiedCount: 4 },
        amountDiff: { monthlyProposedAmount: 50_000 },
      }),
    ], options)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('first-official')
    expect(result.rows[0].officialVersionNo).toBe(1)
    expect(result.rows[0].statementChanged).toBeNull()
    expect(result.rows[0].proposalAmountChanged).toBeNull()
    expect(result.rows[0].statementDiff).toEqual({})
    expect(result.rows[0].amountDiff).toEqual({})
    expect(result.summary.newProposalCount).toBe(1)
    expect(result.summary.reissueCount).toBe(0)
  })

  it('공식 재발행만 네 가지 변경 유형으로 분류하고 유치원 수를 중복 제거한다', () => {
    const result = buildOfficialProposalDashboard([
      dashboardRow({ id: 'p1-v1', rawVersionNo: 5, issuedAt: '2026-09-02T00:00:00.000Z' }),
      dashboardRow({ id: 'p1-v2', rawVersionNo: 6, issuedAt: '2026-09-03T00:00:00.000Z', statementChanged: true, proposalAmountChanged: true }),
      dashboardRow({ id: 'p1-v3', rawVersionNo: 7, issuedAt: '2026-09-04T00:00:00.000Z', statementChanged: false, proposalAmountChanged: false }),
      dashboardRow({ id: 'p2-v1', proposalId: 'p2', sessionId: 's2', kindergartenId: 'k2', kindergartenName: '서호유치원', rawVersionNo: 2, issuedAt: '2026-09-05T00:00:00.000Z' }),
      dashboardRow({ id: 'p2-v2', proposalId: 'p2', sessionId: 's2', kindergartenId: 'k2', kindergartenName: '서호유치원', rawVersionNo: 3, issuedAt: '2026-09-06T00:00:00.000Z', statementChanged: false, proposalAmountChanged: true }),
    ], options)

    expect(result.summary.totalVersions).toBe(5)
    expect(result.summary.kindergartenCount).toBe(2)
    expect(result.summary.newProposalCount).toBe(2)
    expect(result.summary.reissueCount).toBe(3)
    expect(result.summary.bothChangedCount).toBe(1)
    expect(result.summary.amountOnlyChangedCount).toBe(1)
    expect(result.summary.neitherChangedCount).toBe(1)
    expect(result.summary.statementOnlyChangedCount).toBe(0)
  })

  it('유치원·변경유형·담당자 필터와 페이지 구간을 일관되게 적용한다', () => {
    const rows = [
      dashboardRow({ id: 'a1', rawVersionNo: 1 }),
      dashboardRow({ id: 'a2', rawVersionNo: 2, issuedAt: '2026-09-03T00:00:00.000Z', statementChanged: true, proposalAmountChanged: false }),
      dashboardRow({ id: 'b1', proposalId: 'p2', sessionId: 's2', kindergartenId: 'k2', kindergartenName: '서호유치원', rawVersionNo: 1, issuerId: 'u2', issuerName: '이담당' }),
      dashboardRow({ id: 'b2', proposalId: 'p2', sessionId: 's2', kindergartenId: 'k2', kindergartenName: '서호유치원', rawVersionNo: 2, issuerId: 'u2', issuerName: '이담당', issuedAt: '2026-09-04T00:00:00.000Z', statementChanged: true, proposalAmountChanged: false }),
    ]
    const result = buildOfficialProposalDashboard(rows, {
      ...options,
      search: '서호',
      changeType: 'statement_only',
      issuerId: 'u2',
      pageSize: 1,
    })

    expect(result.total).toBe(1)
    expect(result.rows.map((row) => row.id)).toEqual(['b2'])
    expect(result.summary.statementOnlyChangedCount).toBe(1)
  })
})

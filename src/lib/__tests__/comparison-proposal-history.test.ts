import { describe, expect, it } from 'vitest'
import {
  aggregateProposalMonth,
  buildStatementSnapshot,
  classifyHistoricalProposal,
  compareProposalSnapshots,
  normalizeKindergartenName,
  type ProposalAmountSnapshot,
  type ProposalVersionForAggregation,
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

import { describe, expect, it } from 'vitest'
import {
  pendingWorkNoteCount,
  validateWorkNoteDraft,
  workNoteGateError,
} from '@/features/settlement'

describe('월별 정산 메모', () => {
  const valid = {
    period: '2026-09',
    targetType: 'venue' as const,
    targetKey: 'cj:1016',
    targetLabel: '인천 복자유치원',
    memo: '공급가 3원 조정 요청',
  }

  it('대상과 자유 메모만 있으면 등록할 수 있다', () => {
    expect(validateWorkNoteDraft(valid)).toEqual([])
  })

  it('빈 메모와 지나치게 긴 메모는 거부한다', () => {
    expect(validateWorkNoteDraft({ ...valid, memo: '   ' })).toContain(
      '메모 내용을 입력해 주세요.'
    )
    expect(validateWorkNoteDraft({ ...valid, memo: '가'.repeat(2001) })).toContain(
      '메모는 2,000자 이하로 입력해 주세요.'
    )
  })

  it('미확인 상태만 마감 전 확인 대상으로 센다', () => {
    const notes = [
      { status: 'pending' as const },
      { status: 'applied' as const },
      { status: 'not_applied' as const },
      { status: 'pending' as const },
    ]
    expect(pendingWorkNoteCount(notes)).toBe(2)
    expect(workNoteGateError(notes)).toBe('정산 메모 미확인 2건을 처리해 주세요.')
  })

  it('모든 메모를 확인하면 마감을 막지 않는다', () => {
    expect(
      workNoteGateError([
        { status: 'applied' as const },
        { status: 'not_applied' as const },
      ])
    ).toBeNull()
  })
})

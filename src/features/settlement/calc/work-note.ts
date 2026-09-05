export type WorkNoteTargetType = 'supplier' | 'partner' | 'venue' | 'other'
export type WorkNoteStatus = 'pending' | 'applied' | 'not_applied'

export interface WorkNoteDraft {
  period: string
  targetType: WorkNoteTargetType
  targetKey: string
  targetLabel: string
  memo: string
}

export const WORK_NOTE_TARGET_LABEL: Record<WorkNoteTargetType, string> = {
  supplier: '공급사',
  partner: '파트너',
  venue: '유치원',
  other: '기타',
}

export const WORK_NOTE_STATUS_LABEL: Record<WorkNoteStatus, string> = {
  pending: '미확인',
  applied: '반영 완료',
  not_applied: '미반영',
}

export function validateWorkNoteDraft(input: WorkNoteDraft): string[] {
  const errors: string[] = []
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    errors.push('정산월이 올바르지 않습니다.')
  }
  if (!['supplier', 'partner', 'venue', 'other'].includes(input.targetType)) {
    errors.push('메모 대상을 선택해 주세요.')
  }
  if (!input.targetKey.trim() || !input.targetLabel.trim()) {
    errors.push('메모 대상을 선택해 주세요.')
  }
  if (!input.memo.trim()) errors.push('메모 내용을 입력해 주세요.')
  if (input.memo.trim().length > 2000) {
    errors.push('메모는 2,000자 이하로 입력해 주세요.')
  }
  return errors
}

export function pendingWorkNoteCount(
  notes: readonly { status: WorkNoteStatus }[]
): number {
  return notes.filter((note) => note.status === 'pending').length
}

export function workNoteGateError(
  notes: readonly { status: WorkNoteStatus }[]
): string | null {
  const count = pendingWorkNoteCount(notes)
  return count > 0 ? `정산 메모 미확인 ${count}건을 처리해 주세요.` : null
}

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  validateWorkNoteDraft,
  type WorkNoteDraft,
  type WorkNoteStatus,
  type WorkNoteTargetType,
} from '../calc/work-note'

export class WorkNoteError extends Error {}

export interface WorkNoteRecord extends WorkNoteDraft {
  id: string
  status: WorkNoteStatus
  createdAt: string
  createdBy: string
  resolvedAt: string | null
  resolvedBy: string | null
}

interface Row {
  id: string
  period: string
  target_type: WorkNoteTargetType
  target_key: string
  target_label: string
  memo: string
  status: WorkNoteStatus
  created_at: string
  created_by: string
  resolved_at: string | null
  resolved_by: string | null
}

const COLUMNS =
  'id, period, target_type, target_key, target_label, memo, status, created_at, created_by, resolved_at, resolved_by'

function toRecord(row: Row): WorkNoteRecord {
  return {
    id: row.id,
    period: row.period,
    targetType: row.target_type,
    targetKey: row.target_key,
    targetLabel: row.target_label,
    memo: row.memo,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  }
}

export async function listWorkNotes(period: string): Promise<WorkNoteRecord[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_work_notes')
    .select(COLUMNS)
    .eq('period', period)
    .order('created_at', { ascending: true })
  if (error) throw new WorkNoteError(`정산 메모 조회 실패: ${error.message}`)
  return (data ?? []).map((row) => toRecord(row as unknown as Row))
}

export async function getWorkNote(id: string): Promise<WorkNoteRecord | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_work_notes')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new WorkNoteError(`정산 메모 확인 실패: ${error.message}`)
  return data ? toRecord(data as unknown as Row) : null
}

export async function createWorkNote(
  input: WorkNoteDraft,
  actor: string
): Promise<WorkNoteRecord> {
  const problems = validateWorkNoteDraft(input)
  if (problems.length > 0) throw new WorkNoteError(problems[0])

  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_work_notes')
    .insert({
      period: input.period,
      target_type: input.targetType,
      target_key: input.targetKey.trim(),
      target_label: input.targetLabel.trim(),
      memo: input.memo.trim(),
      status: 'pending',
      created_by: actor,
    })
    .select(COLUMNS)
    .single()
  if (error) throw new WorkNoteError(`정산 메모 저장 실패: ${error.message}`)
  return toRecord(data as unknown as Row)
}

export async function setWorkNoteStatus(
  id: string,
  status: WorkNoteStatus,
  actor: string
): Promise<WorkNoteRecord> {
  const resolved = status === 'pending'
    ? { resolved_at: null, resolved_by: null }
    : { resolved_at: new Date().toISOString(), resolved_by: actor }
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_work_notes')
    .update({ status, ...resolved })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()
  if (error) throw new WorkNoteError(`정산 메모 처리 실패: ${error.message}`)
  if (!data) throw new WorkNoteError('정산 메모를 찾을 수 없습니다.')
  return toRecord(data as unknown as Row)
}

export async function deletePendingWorkNote(id: string): Promise<void> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_work_notes')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new WorkNoteError(`정산 메모 삭제 실패: ${error.message}`)
  if ((data ?? []).length !== 1) {
    throw new WorkNoteError('미확인 상태의 메모만 삭제할 수 있습니다.')
  }
}

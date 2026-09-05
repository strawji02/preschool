'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type TargetType = 'supplier' | 'partner' | 'venue' | 'other'
type NoteStatus = 'pending' | 'applied' | 'not_applied'

interface TargetOption {
  key: string
  label: string
}

interface WorkNote {
  id: string
  targetType: TargetType
  targetKey: string
  targetLabel: string
  memo: string
  status: NoteStatus
  createdAt: string
  createdBy: string
  resolvedAt: string | null
  resolvedBy: string | null
}

interface Targets {
  suppliers: TargetOption[]
  partners: TargetOption[]
  venues: TargetOption[]
}

const TYPE_LABEL: Record<TargetType, string> = {
  supplier: '공급사',
  partner: '파트너',
  venue: '유치원',
  other: '기타',
}

const STATUS_LABEL: Record<NoteStatus, string> = {
  pending: '미확인',
  applied: '반영 완료',
  not_applied: '미반영',
}

const STATUS_STYLE: Record<NoteStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  applied: 'bg-emerald-100 text-emerald-800',
  not_applied: 'bg-slate-200 text-slate-700',
}

const EMPTY_TARGETS: Targets = { suppliers: [], partners: [], venues: [] }

export default function WorkNotePanel({
  period,
  locked,
  onPendingChange,
}: {
  period: string
  locked: boolean
  onPendingChange: (count: number) => void
}) {
  const [notes, setNotes] = useState<WorkNote[]>([])
  const [targets, setTargets] = useState<Targets>(EMPTY_TARGETS)
  const [serverLocked, setServerLocked] = useState(false)
  const [targetType, setTargetType] = useState<TargetType>('venue')
  const [targetKey, setTargetKey] = useState('')
  const [memo, setMemo] = useState('')
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/settlement/work-note?period=${encodeURIComponent(period)}`)
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
        notes?: WorkNote[]
        targets?: Targets
        locked?: boolean
      } | null
      if (!res.ok || !json?.success) {
        setError(json?.error ?? '정산 메모를 불러오지 못했습니다.')
        return
      }
      setNotes(json.notes ?? [])
      setTargets(json.targets ?? EMPTY_TARGETS)
      setServerLocked(Boolean(json.locked))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '정산 메모를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const pendingCount = notes.filter((note) => note.status === 'pending').length
  useEffect(() => {
    onPendingChange(pendingCount)
  }, [onPendingChange, pendingCount])

  const options = useMemo(() => {
    if (targetType === 'supplier') return targets.suppliers
    if (targetType === 'partner') return targets.partners
    if (targetType === 'venue') return targets.venues
    return [{ key: 'other', label: '기타' }]
  }, [targetType, targets])

  useEffect(() => {
    if (!options.some((option) => option.key === targetKey)) {
      setTargetKey(options[0]?.key ?? '')
    }
  }, [options, targetKey])

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1
      if (a.status !== 'pending' && b.status === 'pending') return 1
      return b.createdAt.localeCompare(a.createdAt)
    }),
    [notes]
  )
  const effectiveLocked = locked || serverLocked

  async function addNote() {
    if (!targetKey || !memo.trim()) return
    setBusy('create')
    setError(null)
    try {
      const res = await fetch('/api/settlement/work-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, targetType, targetKey, memo }),
      })
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
        note?: WorkNote
      } | null
      if (!res.ok || !json?.success || !json.note) {
        setError(json?.error ?? '정산 메모를 저장하지 못했습니다.')
        return
      }
      setNotes((previous) => [...previous, json.note as WorkNote])
      setMemo('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '정산 메모를 저장하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function changeStatus(id: string, status: NoteStatus) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/settlement/work-note', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
        note?: WorkNote
      } | null
      if (!res.ok || !json?.success || !json.note) {
        setError(json?.error ?? '정산 메모 상태를 바꾸지 못했습니다.')
        return
      }
      setNotes((previous) => previous.map((note) => (note.id === id ? json.note as WorkNote : note)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '정산 메모 상태를 바꾸지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function removeNote(id: string) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/settlement/work-note?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
      } | null
      if (!res.ok || !json?.success) {
        setError(json?.error ?? '정산 메모를 삭제하지 못했습니다.')
        return
      }
      setNotes((previous) => previous.filter((note) => note.id !== id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '정산 메모를 삭제하지 못했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="sticky top-2 z-30 rounded-2xl border border-slate-300 bg-slate-50/95 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">이번 달 정산 메모</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {period} · 메모를 보며 직접 반영한 뒤 처리 여부만 확인합니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-white px-2.5 py-1 text-slate-600">전체 {notes.length}</span>
          <span className={`rounded-full px-2.5 py-1 font-medium ${pendingCount > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
            미확인 {pendingCount}
          </span>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-100"
          >
            {open ? '접기' : '펼치기'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {!effectiveLocked && (
            <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[110px_190px_1fr_auto]">
              <select
                value={targetType}
                onChange={(event) => {
                  setTargetType(event.target.value as TargetType)
                  setTargetKey('')
                }}
                className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                aria-label="메모 대상 구분"
              >
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                value={targetKey}
                onChange={(event) => setTargetKey(event.target.value)}
                disabled={options.length === 0}
                className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm disabled:bg-slate-100"
                aria-label="메모 대상"
              >
                {options.length === 0 && <option value="">대상 없음</option>}
                {options.map((option) => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
              <textarea
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="예: 과세 공급가 3원 조정 요청 / 이번 달 미청구"
                className="min-h-10 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
                aria-label="정산 메모 내용"
              />
              <button
                type="button"
                onClick={() => void addNote()}
                disabled={busy !== null || !targetKey || !memo.trim()}
                className="self-stretch rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'create' ? '저장 중…' : '메모 추가'}
              </button>
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {loading ? (
            <p className="text-xs text-slate-500">메모를 불러오는 중…</p>
          ) : sortedNotes.length === 0 ? (
            <p className="rounded-lg bg-white px-3 py-3 text-sm text-slate-500">등록된 메모가 없습니다.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {sortedNotes.map((note) => (
                <li key={note.id} className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium text-slate-600">{TYPE_LABEL[note.targetType]}</span>
                        <span className="font-semibold text-slate-900">{note.targetLabel}</span>
                        <span className={`rounded px-2 py-0.5 font-medium ${STATUS_STYLE[note.status]}`}>
                          {STATUS_LABEL[note.status]}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{note.memo}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {formatWhen(note.createdAt)} · {note.createdBy}
                        {note.resolvedAt && note.resolvedBy && ` · 처리 ${formatWhen(note.resolvedAt)} ${note.resolvedBy}`}
                      </p>
                    </div>
                    {!effectiveLocked && (
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {note.status === 'pending' ? (
                          <>
                            <button type="button" onClick={() => void changeStatus(note.id, 'applied')} disabled={busy !== null} className="rounded border border-emerald-300 px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">반영 완료</button>
                            <button type="button" onClick={() => void changeStatus(note.id, 'not_applied')} disabled={busy !== null} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">미반영</button>
                            <button type="button" onClick={() => void removeNote(note.id)} disabled={busy !== null} className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">삭제</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => void changeStatus(note.id, 'pending')} disabled={busy !== null} className="rounded border border-amber-300 px-2.5 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50">미확인으로 되돌리기</button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_INVOICE_OVERRIDE_REASON,
  validateInvoiceOverrideDraft,
} from '@/features/settlement/client'

interface Candidate {
  taxKind: 'taxable' | 'exempt'
  itemName: string
  supply: number
  vat: number
}

interface Override {
  id: string
  taxKind: 'taxable' | 'exempt'
  itemName: string
  originalSupply: number
  originalVat: number
  finalSupply: number
  finalVat: number
  reason: string
  status: 'draft' | 'approved' | 'cancelled'
}

interface DraftEdit {
  originalSupply: number
  originalVat: number
  supply: string
  vat: string
  reason: string
}

const candidateKey = (candidate: Pick<Candidate, 'taxKind' | 'itemName'>) =>
  `${candidate.taxKind}:${candidate.itemName}`

export default function InvoiceOverridePanel({ period, candidates, overrides, locked, isAdmin, onChanged }: {
  period: string
  candidates: Candidate[]
  overrides: Override[]
  locked: boolean
  isAdmin: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({})

  useEffect(() => {
    setEdits((previous) => {
      const next: Record<string, DraftEdit> = {}
      for (const candidate of candidates) {
        const key = candidateKey(candidate)
        const existing = previous[key]
        next[key] = existing &&
          existing.originalSupply === candidate.supply &&
          existing.originalVat === candidate.vat
          ? existing
          : {
              originalSupply: candidate.supply,
              originalVat: candidate.vat,
              supply: String(candidate.supply),
              vat: String(candidate.vat),
              reason: DEFAULT_INVOICE_OVERRIDE_REASON,
            }
      }
      return next
    })
  }, [candidates])

  const activeKeys = useMemo(
    () => new Set(overrides.filter((item) => item.status !== 'cancelled').map(candidateKey)),
    [overrides]
  )
  const pendingIds = overrides
    .filter((item) => item.status === 'draft')
    .map((item) => item.id)

  const batchItems = candidates.flatMap((candidate) => {
    const key = candidateKey(candidate)
    if (activeKeys.has(key)) return []
    const edit = edits[key]
    if (!edit) return []
    const finalSupply = Number(edit.supply.replace(/,/g, ''))
    const finalVat = Number(edit.vat.replace(/,/g, ''))
    if (finalSupply === candidate.supply && finalVat === candidate.vat) return []
    return [{
      taxKind: candidate.taxKind,
      itemName: candidate.itemName,
      originalSupply: candidate.supply,
      originalVat: candidate.vat,
      finalSupply,
      finalVat,
      reason: edit.reason.trim(),
    }]
  })
  const batchProblem = batchItems
    .map(validateInvoiceOverrideDraft)
    .find((problem): problem is string => problem !== null) ?? null

  async function send(payload: Record<string, unknown>, key: string) {
    setBusy(key)
    setError(null)
    try {
      const response = await fetch('/api/settlement/invoice-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!response.ok || !json?.success) setError(json?.error ?? '원단위 조정을 저장하지 못했습니다.')
      else onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-slate-900">CJ 1016 인천 복자유치원 원단위 조정</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        일반 거래처는 공급사 공급가·부가세·면세 금액을 그대로 사용합니다. 이 화면은 CJ 사업장코드 1016만 예외이며 원본·최종값·사유·승인이 모두 기록됩니다.
      </p>
      {isAdmin && pendingIds.length > 0 && !locked && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void send({ action: 'approve-batch', ids: pendingIds }, 'approve-batch')}
          className="mt-3 rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          {busy === 'approve-batch' ? '일괄 승인 중…' : `승인대기 ${pendingIds.length}건 일괄 승인`}
        </button>
      )}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {candidates.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">이번 달 CJ 1016 계산서 품목이 없습니다.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {candidates.map((candidate) => {
            const current = overrides.find((item) => item.taxKind === candidate.taxKind && item.itemName === candidate.itemName && item.status !== 'cancelled')
            return current ? (
              <div key={`${candidate.taxKind}:${candidate.itemName}`} className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{candidate.itemName} · {candidate.taxKind === 'taxable' ? '과세' : '면세'}</span>
                  <span className={current.status === 'approved' ? 'text-emerald-700' : 'text-amber-700'}>{current.status === 'approved' ? '승인됨' : '승인대기'}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  공급가 {current.originalSupply.toLocaleString()} → {current.finalSupply.toLocaleString()}원 · 부가세 {current.originalVat.toLocaleString()} → {current.finalVat.toLocaleString()}원 · {current.reason}
                </p>
                {isAdmin && current.status === 'draft' && !locked && (
                  <button type="button" disabled={busy === current.id} onClick={() => void send({ action: 'approve', id: current.id }, current.id)} className="mt-2 rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">관리자 승인</button>
                )}
              </div>
            ) : (
              <OverrideForm
                key={candidateKey(candidate)}
                candidate={candidate}
                edit={edits[candidateKey(candidate)]}
                disabled={locked || busy !== null}
                onChange={(next) => setEdits((previous) => ({
                  ...previous,
                  [candidateKey(candidate)]: next,
                }))}
              />
            )
          })}
        </div>
      )}
      {batchItems.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={locked || busy !== null || batchProblem !== null}
            onClick={() => void send(
              { action: 'create-batch', period, items: batchItems },
              'create-batch'
            )}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy === 'create-batch' ? '요청 중…' : `변경 ${batchItems.length}건 한 번에 승인 요청`}
          </button>
          {batchProblem && <span className="text-xs text-red-600">{batchProblem}</span>}
        </div>
      )}
    </section>
  )
}

function OverrideForm({ candidate, edit, disabled, onChange }: {
  candidate: Candidate
  edit?: DraftEdit
  disabled: boolean
  onChange: (edit: DraftEdit) => void
}) {
  const value = edit ?? {
    originalSupply: candidate.supply,
    originalVat: candidate.vat,
    supply: String(candidate.supply),
    vat: String(candidate.vat),
    reason: DEFAULT_INVOICE_OVERRIDE_REASON,
  }
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="text-sm font-medium text-slate-900">{candidate.itemName} · {candidate.taxKind === 'taxable' ? '과세' : '면세'}</p>
      <p className="mt-1 text-xs text-slate-500">원본 공급가 {candidate.supply.toLocaleString()}원 · 부가세 {candidate.vat.toLocaleString()}원</p>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-xs">
        <label><span className="mb-1 block text-slate-500">최종 공급가</span><input disabled={disabled} value={value.supply} onChange={(event) => onChange({ ...value, supply: event.target.value })} className="w-28 rounded border border-slate-300 px-2 py-1 text-right disabled:bg-slate-100" /></label>
        <label><span className="mb-1 block text-slate-500">최종 부가세</span><input value={value.vat} disabled={disabled || candidate.taxKind === 'exempt'} onChange={(event) => onChange({ ...value, vat: event.target.value })} className="w-28 rounded border border-slate-300 px-2 py-1 text-right disabled:bg-slate-100" /></label>
        <label><span className="mb-1 block text-slate-500">조정 사유</span><input disabled={disabled} value={value.reason} onChange={(event) => onChange({ ...value, reason: event.target.value })} className="w-64 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100" /></label>
        <span className="pb-1 text-slate-400">변경한 행은 아래에서 한 번에 요청합니다.</span>
      </div>
    </div>
  )
}

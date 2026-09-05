'use client'

import { useEffect, useState } from 'react'
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

export default function InvoiceOverridePanel({ period, candidates, overrides, locked, onChanged }: {
  period: string
  candidates: Candidate[]
  overrides: Override[]
  locked: boolean
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({})

  useEffect(() => {
    const next: Record<string, DraftEdit> = {}
    for (const candidate of candidates) {
      const current = overrides.find(
        (item) => item.status !== 'cancelled' && candidateKey(item) === candidateKey(candidate)
      )
      next[candidateKey(candidate)] = {
        originalSupply: candidate.supply,
        originalVat: candidate.vat,
        supply: String(current?.finalSupply ?? candidate.supply),
        vat: String(current?.finalVat ?? candidate.vat),
        reason: current?.reason ?? DEFAULT_INVOICE_OVERRIDE_REASON,
      }
    }
    setEdits(next)
  }, [candidates, overrides])

  const batchItems = candidates.flatMap((candidate) => {
    const key = candidateKey(candidate)
    const edit = edits[key]
    if (!edit) return []
    const current = overrides.find(
      (item) => item.status !== 'cancelled' && candidateKey(item) === key
    )
    const finalSupply = Number(edit.supply.replace(/,/g, ''))
    const finalVat = Number(edit.vat.replace(/,/g, ''))
    const baselineSupply = current?.finalSupply ?? candidate.supply
    const baselineVat = current?.finalVat ?? candidate.vat
    const stale = current !== undefined && (
      current.originalSupply !== candidate.supply || current.originalVat !== candidate.vat
    )
    if (!stale && current?.status !== 'draft' && finalSupply === baselineSupply && finalVat === baselineVat && edit.reason.trim() === (current?.reason ?? DEFAULT_INVOICE_OVERRIDE_REASON)) return []
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
    setNotice(null)
    try {
      const response = await fetch('/api/settlement/invoice-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await response.json().catch(() => null)) as { success?: boolean; error?: string; requiresReconfirm?: boolean } | null
      if (!response.ok || !json?.success) setError(json?.error ?? '원단위 조정을 저장하지 못했습니다.')
      else {
        setNotice(json.requiresReconfirm
          ? '즉시 반영했습니다. 이미 확정된 달이므로 8번에서 다시 확정하거나 마감해 주세요.'
          : '유치원 요청 금액을 즉시 반영했습니다.')
        onChanged()
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-slate-900">CJ 1016 인천 복자유치원 원단위 조정</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        담당자가 유치원 요청 금액을 저장하면 즉시 반영됩니다. 총 청구액 변경도 가능하며, 파트너 정산은 원본을 유지하고 차액은 본사가 부담합니다.
      </p>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {notice && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p>}
      {candidates.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">이번 달 CJ 1016 계산서 품목이 없습니다.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {candidates.map((candidate) => {
            const current = overrides.find((item) => item.taxKind === candidate.taxKind && item.itemName === candidate.itemName && item.status !== 'cancelled')
            return <OverrideForm
              key={candidateKey(candidate)}
              candidate={candidate}
              current={current}
              edit={edits[candidateKey(candidate)]}
              disabled={locked || busy !== null}
              onChange={(next) => setEdits((previous) => ({
                ...previous,
                [candidateKey(candidate)]: next,
              }))}
            />
          })}
        </div>
      )}
      {batchItems.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={locked || busy !== null || batchProblem !== null}
            onClick={() => void send(
              { action: 'save-batch', period, items: batchItems },
              'save-batch'
            )}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy === 'save-batch' ? '반영 중…' : `변경 ${batchItems.length}건 즉시 반영`}
          </button>
          {batchProblem && <span className="text-xs text-red-600">{batchProblem}</span>}
        </div>
      )}
    </section>
  )
}

function OverrideForm({ candidate, current, edit, disabled, onChange }: {
  candidate: Candidate
  current?: Override
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
  const finalSupply = Number(value.supply.replace(/,/g, '')) || 0
  const finalVat = Number(value.vat.replace(/,/g, '')) || 0
  const originalTotal = candidate.supply + candidate.vat
  const finalTotal = finalSupply + finalVat
  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">{candidate.itemName} · {candidate.taxKind === 'taxable' ? '과세' : '면세'}</p>
        {current && <span className={`text-xs font-medium ${current.status === 'draft' ? 'text-amber-700' : 'text-emerald-700'}`}>{current.status === 'draft' ? '기존 승인대기 · 저장 시 즉시 반영' : '현재 반영 중 · 다시 편집 가능'}</span>}
      </div>
      <p className="mt-1 text-xs text-slate-500">공급사 원본 공급가 {candidate.supply.toLocaleString()}원 · 부가세 {candidate.vat.toLocaleString()}원 · 합계 {originalTotal.toLocaleString()}원</p>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-xs">
        <label><span className="mb-1 block text-slate-500">최종 공급가</span><input disabled={disabled} value={value.supply} onChange={(event) => onChange({ ...value, supply: event.target.value })} className="w-28 rounded border border-slate-300 px-2 py-1 text-right disabled:bg-slate-100" /></label>
        <label><span className="mb-1 block text-slate-500">최종 부가세</span><input value={value.vat} disabled={disabled || candidate.taxKind === 'exempt'} onChange={(event) => onChange({ ...value, vat: event.target.value })} className="w-28 rounded border border-slate-300 px-2 py-1 text-right disabled:bg-slate-100" /></label>
        <label><span className="mb-1 block text-slate-500">조정 사유</span><input disabled={disabled} value={value.reason} onChange={(event) => onChange({ ...value, reason: event.target.value })} className="w-64 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100" /></label>
        <span className="pb-1 text-slate-500">최종 합계 {finalTotal.toLocaleString()}원 · 증감 {(finalTotal - originalTotal).toLocaleString()}원</span>
      </div>
    </div>
  )
}

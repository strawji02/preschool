'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_INVOICE_OVERRIDE_REASON,
  validateInvoiceOverrideDraft,
} from '@/features/settlement/client'
import type { ClosingStatusValue } from './closing-panel'

interface Candidate {
  taxKind: 'taxable' | 'exempt'
  itemName: string
  supply: number
  vat: number
  restaurantNames?: string[]
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
  supply: string
  vat: string
  reason: string
}

const candidateKey = (candidate: Pick<Candidate, 'taxKind' | 'itemName'>) =>
  `${candidate.taxKind}:${candidate.itemName}`

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`

function signedWon(amount: number): string {
  if (!Number.isFinite(amount)) return '입력 확인'
  if (amount === 0) return '0원'
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString('ko-KR')}원`
}

function parseAmount(value: string): number {
  const normalized = value.replace(/,/g, '').trim()
  return normalized === '' ? Number.NaN : Number(normalized)
}

export default function InvoiceOverridePanel({
  period,
  candidates,
  overrides,
  locked,
  closingStatus,
  onChanged,
}: {
  period: string
  candidates: Candidate[]
  overrides: Override[]
  locked: boolean
  closingStatus: ClosingStatusValue
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeNeedsReconfirm, setNoticeNeedsReconfirm] = useState(false)
  const [edits, setEdits] = useState<Record<string, DraftEdit>>({})

  useEffect(() => {
    const next: Record<string, DraftEdit> = {}
    for (const candidate of candidates) {
      const current = overrides.find(
        (item) => item.status !== 'cancelled' && candidateKey(item) === candidateKey(candidate)
      )
      next[candidateKey(candidate)] = {
        supply: String(current?.finalSupply ?? candidate.supply),
        vat: String(current?.finalVat ?? candidate.vat),
        reason: current?.reason ?? DEFAULT_INVOICE_OVERRIDE_REASON,
      }
    }
    setEdits(next)
  }, [candidates, overrides])

  const activeByKey = new Map(
    overrides
      .filter((item) => item.status !== 'cancelled')
      .map((item) => [candidateKey(item), item] as const)
  )
  const batchItems = candidates.flatMap((candidate) => {
    const key = candidateKey(candidate)
    const edit = edits[key]
    if (!edit) return []
    const current = activeByKey.get(key)
    const finalSupply = parseAmount(edit.supply)
    const finalVat = parseAmount(edit.vat)
    const baselineSupply = current?.finalSupply ?? candidate.supply
    const baselineVat = current?.finalVat ?? candidate.vat
    const stale = current !== undefined && (
      current.originalSupply !== candidate.supply || current.originalVat !== candidate.vat
    )
    const unchanged =
      !stale &&
      current?.status !== 'draft' &&
      finalSupply === baselineSupply &&
      finalVat === baselineVat &&
      edit.reason.trim() === (current?.reason ?? DEFAULT_INVOICE_OVERRIDE_REASON)
    if (unchanged) return []
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
  const dirtyKeys = new Set(batchItems.map((item) => candidateKey(item)))
  const batchProblem = batchItems
    .map(validateInvoiceOverrideDraft)
    .find((problem): problem is string => problem !== null) ?? null

  const requestedTotals = candidates.reduce(
    (total, candidate) => {
      const edit = edits[candidateKey(candidate)]
      const supply = edit ? parseAmount(edit.supply) : candidate.supply
      const vat = edit ? parseAmount(edit.vat) : candidate.vat
      return {
        originalSupply: total.originalSupply + candidate.supply,
        originalVat: total.originalVat + candidate.vat,
        finalSupply: total.finalSupply + supply,
        finalVat: total.finalVat + vat,
      }
    },
    { originalSupply: 0, originalVat: 0, finalSupply: 0, finalVat: 0 }
  )
  const totalSupplyDelta = requestedTotals.finalSupply - requestedTotals.originalSupply
  const totalVatDelta = requestedTotals.finalVat - requestedTotals.originalVat
  const totalAmountDelta = totalSupplyDelta + totalVatDelta

  const groups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const restaurantKey = (candidate.restaurantNames ?? []).join('\u0000')
    const key = `${restaurantKey}\u0001${candidate.itemName}`
    const rows = groups.get(key) ?? []
    rows.push(candidate)
    groups.set(key, rows)
  }

  async function send(payload: Record<string, unknown>, key: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    setNoticeNeedsReconfirm(false)
    try {
      const response = await fetch('/api/settlement/invoice-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await response.json().catch(() => null)) as {
        success?: boolean
        error?: string
        requiresReconfirm?: boolean
      } | null
      if (!response.ok || !json?.success) {
        setError(json?.error ?? '원단위 조정을 저장하지 못했습니다.')
      } else {
        const requiresReconfirm = Boolean(json.requiresReconfirm)
        setNoticeNeedsReconfirm(requiresReconfirm)
        setNotice(
          requiresReconfirm
            ? '변경 금액을 저장하고 산출물을 갱신했습니다. 월 마감에서 다시 확정해 주세요.'
            : '변경 금액을 저장하고 산출물을 갱신했습니다.'
        )
        onChanged()
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">복자유치원 요청 금액 반영</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            유치원이 전달한 공급가와 부가세를 입력하면 총 청구액은 자동 계산됩니다.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          CJ 사업장 1016 전용
        </span>
      </div>

      <ol className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['1', '공급사 원본 확인'],
          ['2', '유치원 요청값 입력'],
          ['3', '변경 전·후 검토'],
          ['4', '저장 후 월 마감 확인'],
        ].map(([step, label]) => (
          <li key={step} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[11px] font-semibold text-white">
              {step}
            </span>
            {label}
          </li>
        ))}
      </ol>

      <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-900">
        <strong>반영 기준</strong> · 파트너 정산과 공급자 지급액은 공급사 원본을 유지합니다.
        총 청구액의 증감은 본사 부담으로 처리되고 계산서·거래명세서·경영 보고서·수금액에
        반영됩니다.
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      {notice && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <span>{notice}</span>
          {noticeNeedsReconfirm && (
            <a href="#settlement-closing" className="font-semibold underline underline-offset-2">
              8. 월 마감으로 이동
            </a>
          )}
        </div>
      )}

      {candidates.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">이번 달 CJ 1016 계산서 품목이 없습니다.</p>
      ) : (
        <>
          <div className="sticky top-3 z-20 mt-4 rounded-xl border border-slate-300 bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {locked
                    ? '마감된 달입니다 · 조회만 가능'
                    : batchItems.length > 0
                      ? `저장 전 변경사항 ${batchItems.length}건`
                      : '변경된 금액이 없습니다'}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  전체 조정 · 공급가 {signedWon(totalSupplyDelta)} · 부가세 {signedWon(totalVatDelta)} ·{' '}
                  <strong>총 청구액 {signedWon(totalAmountDelta)}</strong>
                </p>
                {closingStatus === 'confirmed' && !locked && (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    현재 확정된 달입니다. 저장 후 화면 하단 ‘8. 월 마감’에서 다시 확정해야 합니다.
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={locked || busy !== null || batchProblem !== null || batchItems.length === 0}
                onClick={() => void send(
                  { action: 'save-batch', period, items: batchItems },
                  'save-batch'
                )}
                className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy === 'save-batch'
                  ? '저장하고 갱신하는 중…'
                  : batchItems.length > 0
                    ? `변경 ${batchItems.length}건 저장하고 산출물 갱신`
                    : '변경된 금액이 없습니다'}
              </button>
            </div>
            {batchProblem && <p className="mt-2 text-xs font-medium text-red-600">{batchProblem}</p>}
          </div>

          <div className="mt-4 space-y-4">
            {[...groups.values()].map((rows) => {
              const first = rows[0]
              const restaurants = first.restaurantNames ?? []
              return (
                <div key={`${restaurants.join(':')}:${first.itemName}`} className="overflow-hidden rounded-xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {restaurants.length > 0 ? restaurants.join(' · ') : '식당명 미확인'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      청구 품목 {first.itemName}
                      {restaurants.length > 1 && ` · 식당 ${restaurants.length}곳 합산`}
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {rows
                      .sort((a, b) => a.taxKind.localeCompare(b.taxKind))
                      .map((candidate) => (
                        <OverrideRow
                          key={candidateKey(candidate)}
                          candidate={candidate}
                          current={activeByKey.get(candidateKey(candidate))}
                          edit={edits[candidateKey(candidate)]}
                          dirty={dirtyKeys.has(candidateKey(candidate))}
                          locked={locked}
                          disabled={locked || busy !== null}
                          onChange={(next) => setEdits((previous) => ({
                            ...previous,
                            [candidateKey(candidate)]: next,
                          }))}
                        />
                      ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function OverrideRow({
  candidate,
  current,
  edit,
  dirty,
  locked,
  disabled,
  onChange,
}: {
  candidate: Candidate
  current?: Override
  edit?: DraftEdit
  dirty: boolean
  locked: boolean
  disabled: boolean
  onChange: (edit: DraftEdit) => void
}) {
  const value = edit ?? {
    supply: String(candidate.supply),
    vat: String(candidate.vat),
    reason: DEFAULT_INVOICE_OVERRIDE_REASON,
  }
  const finalSupply = parseAmount(value.supply)
  const finalVat = parseAmount(value.vat)
  const originalTotal = candidate.supply + candidate.vat
  const finalTotal = finalSupply + finalVat
  const supplyDelta = finalSupply - candidate.supply
  const vatDelta = finalVat - candidate.vat
  const totalDelta = finalTotal - originalTotal

  const status = locked
    ? { label: '마감됨 · 조회만 가능', style: 'bg-slate-100 text-slate-600' }
    : dirty
      ? { label: '저장 전 변경사항', style: 'bg-amber-100 text-amber-800' }
      : current?.status === 'draft'
        ? { label: '기존 승인대기 · 저장 필요', style: 'bg-amber-100 text-amber-800' }
        : current
          ? { label: '저장 완료', style: 'bg-emerald-100 text-emerald-800' }
          : { label: '공급사 원본 사용', style: 'bg-slate-100 text-slate-600' }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          candidate.taxKind === 'taxable'
            ? 'bg-rose-50 text-rose-700'
            : 'bg-teal-50 text-teal-700'
        }`}>
          {candidate.taxKind === 'taxable' ? '과세' : '면세'}
        </span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${status.style}`}>
          {status.label}
        </span>
      </div>

      <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_0.9fr]">
        <AmountBox
          title="공급사 원본"
          supply={candidate.supply}
          vat={candidate.vat}
          total={originalTotal}
          tone="source"
        />
        <div className="hidden items-center text-lg text-slate-300 lg:flex" aria-hidden="true">→</div>
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
          <p className="text-xs font-semibold text-blue-900">유치원 요청 금액</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <AmountInput
              label="공급가"
              value={value.supply}
              disabled={disabled}
              onChange={(supply) => onChange({ ...value, supply })}
            />
            <AmountInput
              label="부가세"
              value={value.vat}
              disabled={disabled || candidate.taxKind === 'exempt'}
              onChange={(vat) => onChange({ ...value, vat })}
            />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-blue-100 pt-2 text-xs">
            <span className="text-blue-700">총액 자동계산</span>
            <strong className="tabular-nums text-blue-950">
              {Number.isFinite(finalTotal) ? won(finalTotal) : '입력 확인'}
            </strong>
          </div>
        </div>
        <div className={`rounded-lg border p-3 ${
          dirty ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
        }`} aria-live="polite">
          <p className="text-xs font-semibold text-slate-800">변경 내역</p>
          <dl className="mt-2 space-y-1.5 text-xs">
            <Delta label="공급가" value={supplyDelta} />
            <Delta label="부가세" value={vatDelta} />
            <Delta label="총 청구액" value={totalDelta} strong />
          </dl>
        </div>
      </div>

      <label className="mt-3 block text-xs text-slate-600">
        <span className="mb-1 block font-medium">조정 사유</span>
        <input
          disabled={disabled}
          value={value.reason}
          onChange={(event) => onChange({ ...value, reason: event.target.value })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
        />
      </label>
    </div>
  )
}

function AmountBox({
  title,
  supply,
  vat,
  total,
  tone,
}: {
  title: string
  supply: number
  vat: number
  total: number
  tone: 'source'
}) {
  return (
    <div className={`rounded-lg border p-3 ${tone === 'source' ? 'border-slate-200 bg-slate-50' : ''}`}>
      <p className="text-xs font-semibold text-slate-700">{title}</p>
      <dl className="mt-2 space-y-1.5 text-xs text-slate-600">
        <div className="flex justify-between gap-3"><dt>공급가</dt><dd className="tabular-nums">{won(supply)}</dd></div>
        <div className="flex justify-between gap-3"><dt>부가세</dt><dd className="tabular-nums">{won(vat)}</dd></div>
        <div className="flex justify-between gap-3 border-t border-slate-200 pt-1.5 font-semibold text-slate-900">
          <dt>합계</dt><dd className="tabular-nums">{won(total)}</dd>
        </div>
      </dl>
    </div>
  )
}

function AmountInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="text-xs text-blue-800">
      <span className="mb-1 block">{label}</span>
      <div className="relative">
        <input
          inputMode="numeric"
          aria-label={`유치원 요청 ${label}`}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-blue-200 bg-white py-2 pl-2 pr-6 text-right text-sm font-medium tabular-nums text-slate-900 disabled:bg-slate-100"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">원</span>
      </div>
    </label>
  )
}

function Delta({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-slate-200 pt-1.5 font-semibold' : ''}`}>
      <dt className="text-slate-600">{label}</dt>
      <dd className={`tabular-nums ${
        !Number.isFinite(value)
          ? 'text-red-600'
          : value === 0
            ? 'text-slate-500'
            : 'text-amber-800'
      }`}>
        {signedWon(value)}
      </dd>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'

type Source = 'cj' | 'shinsegae'

interface PayableView {
  closingRevision: number
  needsReview: boolean
  summary: {
    rows: {
      source: Source
      principal: number
      adjustment: number
      payable: number
      paid: number
      outstanding: number
      paymentCount: number
      lastPaidDate: string | null
    }[]
  }
  payments: {
    id: string
    source: Source
    paidDate: string
    amount: number
    note: string | null
    status: 'active' | 'cancelled'
  }[]
  adjustments: {
    id: string
    source: Source
    amount: number
    reason: string
    status: 'draft' | 'approved' | 'cancelled'
  }[]
}

const won = (value: number) => value.toLocaleString('ko-KR')
const labels: Record<Source, string> = { cj: 'CJ프레시웨이', shinsegae: '신세계푸드' }
const today = () => new Date().toLocaleDateString('sv-SE')

export default function SupplierPayablePanel({ period, isAdmin }: { period: string; isAdmin: boolean }) {
  const [data, setData] = useState<PayableView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!period) return
    const response = await fetch(`/api/settlement/supplier-payable?period=${encodeURIComponent(period)}`)
    const json = (await response.json().catch(() => null)) as { success?: boolean; error?: string; payable?: PayableView | null } | null
    if (!response.ok || !json?.success) setError(json?.error ?? '공급자 대금을 불러오지 못했습니다.')
    else {
      setData(json.payable ?? null)
      setError(null)
    }
  }, [period])

  useEffect(() => { void refresh() }, [refresh])

  async function send(payload: Record<string, unknown>, key: string) {
    setBusy(key)
    setError(null)
    try {
      const response = await fetch('/api/settlement/supplier-payable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!response.ok || !json?.success) setError(json?.error ?? '저장하지 못했습니다.')
      else {
        setOpen(null)
        await refresh()
      }
    } finally {
      setBusy(null)
    }
  }

  if (!data) return error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-slate-900">공급자 결제대금</h2>
      <p className="mt-1 text-xs text-slate-500">
        원금은 청구 확정 자료에서 자동 산출되어 잠깁니다. 조정은 사유를 남기고 관리자 승인 후 반영됩니다.
      </p>
      {data.needsReview && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          청구 리비전이 변경되었습니다. 이전 지급·조정 기록을 재검토해 주세요.
        </p>
      )}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {data.summary.rows.map((row) => {
          const payments = data.payments.filter((item) => item.source === row.source && item.status === 'active')
          const adjustments = data.adjustments.filter((item) => item.source === row.source && item.status !== 'cancelled')
          return (
            <article key={row.source} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-slate-900">{labels[row.source]}</h3>
                <span className={`text-sm font-semibold ${row.outstanding !== 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  미지급 {won(row.outstanding)}원
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Fact label="확정 원금" value={row.principal} />
                <Fact label="승인 조정" value={row.adjustment} />
                <Fact label="지급 대상" value={row.payable} />
                <Fact label="누적 지급" value={row.paid} />
              </dl>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setOpen(`${row.source}:payment`)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-white">지급 기록</button>
                <button type="button" onClick={() => setOpen(`${row.source}:adjustment`)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700">조정 요청</button>
              </div>
              {open === `${row.source}:payment` && (
                <MoneyForm
                  withDate
                  defaultAmount={Math.max(row.outstanding, 0)}
                  busy={busy === open}
                  onSubmit={(amount, note, date) => void send({ action: 'add-payment', period, source: row.source, amount, note, paidDate: date }, open)}
                />
              )}
              {open === `${row.source}:adjustment` && (
                <MoneyForm
                  defaultAmount={0}
                  busy={busy === open}
                  onSubmit={(amount, reason) => void send({ action: 'add-adjustment', period, source: row.source, amount, reason }, open)}
                />
              )}
              {(payments.length > 0 || adjustments.length > 0) && (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  {payments.map((item) => <li key={item.id}>지급 {item.paidDate} · {won(item.amount)}원 {item.note ?? ''}</li>)}
                  {adjustments.map((item) => (
                    <li key={item.id} className="flex items-center gap-2">
                      <span>조정 {won(item.amount)}원 · {item.reason} · {item.status === 'approved' ? '승인' : '승인대기'}</span>
                      {isAdmin && item.status === 'draft' && (
                        <button type="button" disabled={busy === item.id} onClick={() => void send({ action: 'approve-adjustment', id: item.id }, item.id)} className="font-medium text-emerald-700">승인</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Fact({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-slate-500">{label}</dt><dd className="mt-0.5 font-medium tabular-nums text-slate-900">{won(value)}원</dd></div>
}

function MoneyForm({ withDate = false, defaultAmount, busy, onSubmit }: {
  withDate?: boolean
  defaultAmount: number
  busy: boolean
  onSubmit: (amount: number, note: string, date: string) => void
}) {
  const [amount, setAmount] = useState(String(defaultAmount))
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today())
  const value = Number(amount.replace(/,/g, ''))
  const valid = Number.isSafeInteger(value) && value !== 0 && (withDate || note.trim().length > 0)
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
      {withDate && <input aria-label="지급일" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs" />}
      <input aria-label="금액" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-xs" />
      <input aria-label={withDate ? '비고' : '조정 사유'} value={note} onChange={(event) => setNote(event.target.value)} placeholder={withDate ? '지급 메모' : '조정 사유(필수)'} className="w-44 rounded border border-slate-300 px-2 py-1 text-xs" />
      <button type="button" disabled={busy || !valid || (withDate && !date)} onClick={() => onSubmit(value, note.trim(), date)} className="rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40">저장</button>
    </div>
  )
}

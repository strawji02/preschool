'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * 수금·지급 관리 (docs §9).
 *
 * 통장을 보면서 입금일자를 넣는 화면이다. 청구액은 **마감 스냅샷에서** 오므로
 * 여기서 금액을 다시 계산하지 않는다.
 *
 * 담당 유치원이 전원 완납되면 **지급 요청 알림**이 맨 위에 뜬다 (docs §9).
 */

interface CollectionRowView {
  source: string
  businessCode: string
  label: string
  partnerId: string | null
  partnerName: string | null
  billed: number
  received: number
  outstanding: number
  receivedDate: string | null
  isFullyReceived: boolean
  receiptCount: number
}

interface PartnerCollectionView {
  partnerId: string
  partnerName: string
  venueCount: number
  receivedCount: number
  billed: number
  received: number
  outstanding: number
  allReceived: boolean
  netPay: number
  paid: number
  unpaid: number
  paidDate: string | null
}

interface EntryView {
  id: string
  amount: number
  note: string | null
}

interface ReceiptEntryView extends EntryView {
  source: string
  businessCode: string
  receivedDate: string
}

interface PayoutEntryView extends EntryView {
  partnerId: string
  paidDate: string
}

interface CollectionResponse {
  period: string
  summary: {
    venues: CollectionRowView[]
    partners: PartnerCollectionView[]
    totals: {
      billed: number
      received: number
      outstanding: number
      netPay: number
      paid: number
      unpaid: number
    }
    readyToPay: PartnerCollectionView[]
  }
  receipts: ReceiptEntryView[]
  payouts: PayoutEntryView[]
}

const won = (n: number) => n.toLocaleString('ko-KR')
const SOURCE_LABEL: Record<string, string> = { shinsegae: '신세계', cj: 'CJ' }

/** 오늘 날짜 — 입금일 기본값. 통장을 보면서 그날 입력하는 게 대부분이다 */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

export default function CollectionWorkspace({
  periods,
  initialPeriod,
}: {
  /** 마감된 달 목록 (최신순) */
  periods: string[]
  initialPeriod: string | null
}) {
  const [period, setPeriod] = useState(initialPeriod ?? '')
  const [data, setData] = useState<CollectionResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!period) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/settlement/collection?period=${encodeURIComponent(period)}`)
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
        collection?: CollectionResponse | null
      } | null
      if (!res.ok || !json?.success) {
        setError(json?.error ?? '조회에 실패했습니다.')
        return
      }
      setData(json.collection ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function send(payload: Record<string, unknown>, key: string) {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch('/api/settlement/collection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null
      if (!res.ok || !json?.success) {
        setError(json?.error ?? '저장에 실패했습니다.')
        return
      }
      setOpenKey(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  if (periods.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-sm text-gray-600">아직 마감된 달이 없습니다.</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          입금을 기록하려면 청구액이 확정돼 있어야 합니다. 정산 화면에서 확정·마감을
          먼저 해주세요.
        </p>
      </div>
    )
  }

  const s = data?.summary
  const receiptsOf = (row: CollectionRowView) =>
    (data?.receipts ?? []).filter(
      (r) => r.source === row.source && r.businessCode === row.businessCode
    )
  const payoutsOf = (p: PartnerCollectionView) =>
    (data?.payouts ?? []).filter((x) => x.partnerId === p.partnerId)

  return (
    <div className="space-y-6">
      {/* 기간 선택 — 라벨이 없으면 상태 배지처럼 보인다 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-gray-400">조회 기간</span>
        {periods.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              p === period
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {p.split('-')[0]}년 {Number(p.split('-')[1])}월
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {loading && !s && <p className="text-xs text-gray-400">불러오는 중…</p>}

      {s && (
        <>
          {/* ── 지급 요청 알림 (docs §9) ── */}
          {s.readyToPay.length > 0 && (
            <section className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6">
              <h2 className="font-semibold text-emerald-900">
                지급 요청 — {s.readyToPay.length}명
              </h2>
              <p className="mt-1 text-xs text-emerald-800">
                담당 유치원 <strong>전원 입금이 완료</strong>됐고 아직 지급하지 않았습니다.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-emerald-900">
                {s.readyToPay.map((p) => (
                  <li key={p.partnerId} className="flex flex-wrap gap-2">
                    <span className="font-medium">{p.partnerName}</span>
                    <span className="text-xs">
                      유치원 {p.venueCount}곳 전원 완납 · 미지급{' '}
                      <span className="font-semibold tabular-nums">{won(p.unpaid)}</span>원
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── 합계 ── */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">현금 현황</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="청구 합계" value={s.totals.billed} />
              <Fact label="수금" value={s.totals.received} />
              <Fact
                label="미수금"
                value={s.totals.outstanding}
                alert={s.totals.outstanding > 0}
              />
              <Fact label="미지급 (영업자)" value={s.totals.unpaid} alert={s.totals.unpaid > 0} />
            </div>
          </section>

          {/* ── 유치원별 입금 ── */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">
              유치원별 입금
              <span className="ml-2 text-xs font-normal text-gray-400">
                {s.venues.filter((v) => v.isFullyReceived).length}/{s.venues.length} 완납
              </span>
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              입금일자만 넣으면 청구액 전액으로 기록됩니다. 부분 입금이면 금액을 고치세요.
            </p>

            <ul className="mt-4 space-y-2">
              {s.venues.map((v) => {
                const key = `r:${v.source}:${v.businessCode}`
                const mine = receiptsOf(v)
                return (
                  <li key={key} className="rounded-xl border border-gray-200 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900">{v.label}</span>
                        {v.isFullyReceived ? (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">
                            완납 {v.receivedDate}
                          </span>
                        ) : (
                          <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">
                            미수 {won(v.outstanding)}
                          </span>
                        )}
                        <span className="ml-2 text-xs text-gray-400">
                          {SOURCE_LABEL[v.source] ?? v.source} · {v.partnerName ?? '담당없음'} ·
                          청구 {won(v.billed)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenKey(openKey === key ? null : key)}
                        className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-50"
                      >
                        입금 기록
                      </button>
                    </div>

                    {mine.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        {mine.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center gap-2">
                            <span className="tabular-nums">{r.receivedDate}</span>
                            <span className="tabular-nums font-medium">{won(r.amount)}원</span>
                            {r.note && <span className="text-gray-400">{r.note}</span>}
                            <button
                              type="button"
                              disabled={busy === `d:${r.id}`}
                              onClick={() =>
                                void send({ action: 'delete-receipt', id: r.id }, `d:${r.id}`)
                              }
                              className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {openKey === key && (
                      <EntryForm
                        dateLabel="입금일자"
                        defaultAmount={v.outstanding > 0 ? v.outstanding : v.billed}
                        busy={busy === key}
                        onSubmit={(date, amount, note) =>
                          void send(
                            {
                              action: 'add-receipt',
                              period,
                              source: v.source,
                              businessCode: v.businessCode,
                              receivedDate: date,
                              amount,
                              note,
                            },
                            key
                          )
                        }
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </section>

          {/* ── 영업자별 지급 ── */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">영업자별 지급</h2>
            <p className="mt-1 text-xs text-gray-500">
              담당 유치원이 전원 완납되면 위에 지급 요청이 뜹니다.
            </p>

            <ul className="mt-4 space-y-2">
              {s.partners.map((p) => {
                const key = `p:${p.partnerId}`
                const mine = payoutsOf(p)
                return (
                  <li key={key} className="rounded-xl border border-gray-200 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-medium text-gray-900">{p.partnerName}</span>
                        <span
                          className={`ml-2 rounded px-1.5 py-0.5 text-[11px] ${
                            p.allReceived
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          수금 {p.receivedCount}/{p.venueCount}
                        </span>
                        {p.unpaid === 0 && p.netPay > 0 && (
                          <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-800">
                            지급완료 {p.paidDate}
                          </span>
                        )}
                        <span className="ml-2 text-xs text-gray-400">
                          실지급 {won(p.netPay)} · 미지급 {won(p.unpaid)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenKey(openKey === key ? null : key)}
                        className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-50"
                      >
                        지급 기록
                      </button>
                    </div>

                    {mine.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        {mine.map((x) => (
                          <li key={x.id} className="flex flex-wrap items-center gap-2">
                            <span className="tabular-nums">{x.paidDate}</span>
                            <span className="tabular-nums font-medium">{won(x.amount)}원</span>
                            {x.note && <span className="text-gray-400">{x.note}</span>}
                            <button
                              type="button"
                              disabled={busy === `d:${x.id}`}
                              onClick={() =>
                                void send({ action: 'delete-payout', id: x.id }, `d:${x.id}`)
                              }
                              className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {openKey === key && (
                      <EntryForm
                        dateLabel="지급일자"
                        defaultAmount={p.unpaid > 0 ? p.unpaid : p.netPay}
                        busy={busy === key}
                        onSubmit={(date, amount, note) =>
                          void send(
                            {
                              action: 'add-payout',
                              period,
                              partnerId: p.partnerId,
                              paidDate: date,
                              amount,
                              note,
                            },
                            key
                          )
                        }
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

/** 입금·지급 공통 입력 — 날짜와 금액만 받는다 */
function EntryForm({
  dateLabel,
  defaultAmount,
  busy,
  onSubmit,
}: {
  dateLabel: string
  defaultAmount: number
  busy: boolean
  onSubmit: (date: string, amount: number, note: string | null) => void
}) {
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState(String(defaultAmount))
  const [note, setNote] = useState('')
  const parsed = Number(amount.replace(/,/g, ''))
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed) && parsed !== 0

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">{dateLabel}</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">금액</span>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-36 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-gray-500 focus:outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-500">비고 (선택)</span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 1차 입금"
          className="w-40 rounded border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        />
      </label>
      <button
        type="button"
        disabled={busy || !valid}
        onClick={() => onSubmit(date, Math.trunc(parsed), note.trim() || null)}
        className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? '저장 중…' : '저장'}
      </button>
    </div>
  )
}

function Fact({
  label,
  value,
  alert,
}: {
  label: string
  value: number
  alert?: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          alert ? 'text-red-600' : 'text-gray-900'
        }`}
      >
        {won(value)}
      </p>
    </div>
  )
}

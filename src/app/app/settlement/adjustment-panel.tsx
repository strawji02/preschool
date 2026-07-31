'use client'

import { useMemo, useState } from 'react'

/**
 * 품목 조정 패널 — docs/systems/settlement/조정.md §18
 *
 * ★ **금액을 손으로 치지 않는다.** 거래명세서 품목을 검색해서 고르면 날짜·상품코드·
 * 단가·과세구분이 전부 따라온다. 사람이 넣는 건 수량·사유·요청자뿐이라 오타로
 * 엉뚱한 금액이 빠질 여지가 없다.
 *
 * 조정 없이 마감하면 그냥 청구되므로, **목록이 항상 보여야 한다** — 접어 두지 않는다.
 */

export interface StatementItem {
  date: string
  businessName: string
  restaurantName: string
  productCode: string
  productName: string
  unit: string
  quantity: number
  unitPrice: number
  tax: { taxableSupply: number; vat: number; exempt: number; total: number }
}

export interface AdjustmentRow {
  id: string
  kind: 'exclude' | 'move'
  businessName: string
  restaurantName: string
  itemDate: string
  productCode: string
  productName: string
  unit: string
  quantity: number
  targetRestaurantName: string | null
  reason: string
  requestedBy: string
  createdBy: string
  createdAt: string
}

interface Props {
  period: string
  items: readonly StatementItem[]
  adjustments: readonly AdjustmentRow[]
  /** 조정 합계 (제외분만). 이동은 사업장 합계를 바꾸지 않는다. */
  total: number
  locked: boolean
  /** 저장·삭제 후 재분석 */
  onChanged: () => void
}

const won = (n: number) => n.toLocaleString('ko-KR')

export default function AdjustmentPanel({
  period,
  items,
  adjustments,
  total,
  locked,
  onChanged,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<StatementItem | null>(null)
  const [kind, setKind] = useState<'exclude' | 'move'>('exclude')
  const [quantity, setQuantity] = useState('')
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [requestedBy, setRequestedBy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 품목 검색 — 상품명·식당명·날짜 어디로든 찾을 수 있게 한다.
   * 요청은 "7/6 순두부"처럼 오므로 날짜와 이름을 같이 치면 바로 나와야 한다.
   */
  const hits = useMemo(() => {
    const q = query.trim()
    if (q.length < 2) return []
    const terms = q.split(/\s+/)
    return items
      .filter((it) => {
        const hay = `${it.date} ${it.restaurantName} ${it.productName} ${it.productCode}`
        return terms.every((t) => hay.includes(t))
      })
      .slice(0, 30) // 너무 많으면 고르기 어렵다. 검색어를 좁히게 유도한다.
  }, [items, query])

  /** 이동 대상 후보 — **같은 사업장의 다른 식당**만 (사업장 합계를 지키기 위해) */
  const moveTargets = useMemo(() => {
    if (!picked) return []
    const names = new Set<string>()
    for (const it of items) {
      if (it.businessName === picked.businessName && it.restaurantName !== picked.restaurantName) {
        names.add(it.restaurantName)
      }
    }
    return [...names].sort()
  }, [items, picked])

  function reset() {
    setPicked(null)
    setQuery('')
    setQuantity('')
    setTarget('')
    setReason('')
    setRequestedBy('')
    setKind('exclude')
    setError(null)
  }

  async function save() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/settlement/adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          kind,
          businessName: picked.businessName,
          restaurantName: picked.restaurantName,
          itemDate: picked.date,
          productCode: picked.productCode,
          productName: picked.productName,
          unit: picked.unit,
          quantity: Number(quantity),
          targetRestaurantName: kind === 'move' ? target : null,
          reason,
          requestedBy,
        }),
      })
      const json = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        setError(json.error ?? '저장에 실패했습니다.')
        return
      }
      reset()
      setOpen(false)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/settlement/adjustment?id=${encodeURIComponent(id)}&period=${period}`,
        { method: 'DELETE' }
      )
      const json = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) {
        setError(json.error ?? '삭제에 실패했습니다.')
        return
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  /** 고른 품목과 수량으로 실제 빠질 금액 — 저장 전에 눈으로 확인시킨다 */
  const preview = useMemo(() => {
    const q = Number(quantity)
    if (!picked || !Number.isFinite(q) || q <= 0) return null
    if (q === picked.quantity) return picked.tax.total
    const supply = Math.round((picked.unitPrice * q) / 10) * 10
    return picked.tax.taxableSupply > 0 ? supply + supply / 10 : supply
  }, [picked, quantity])

  const canSave =
    picked !== null &&
    Number(quantity) > 0 &&
    Number(quantity) <= picked.quantity &&
    reason.trim() !== '' &&
    requestedBy.trim() !== '' &&
    (kind === 'exclude' || target !== '')

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-gray-900">3. 품목 조정</h2>
        {!locked && items.length > 0 && (
          <button
            type="button"
            onClick={() => (open ? reset() : null) ?? setOpen(!open)}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            {open ? '취소' : '조정 추가'}
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-gray-500">
        원천 파일은 고치지 않습니다. 여기 기록한 만큼만 유치원 청구에서 빼고, 그 부담은
        해당 영업파트너가 집니다.
      </p>

      {items.length === 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
          CJ 거래명세서를 함께 올려야 품목을 골라 조정할 수 있습니다.
        </p>
      )}

      {/* ── 추가 폼 ── */}
      {open && !locked && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-gray-500">
              품목 찾기 — 날짜·식당·상품명을 띄어쓰기로 함께 칠 수 있습니다 (예: <code>07-06 순두부</code>)
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPicked(null)
              }}
              placeholder="07-06 순두부"
              className="w-full rounded border border-gray-300 px-3 py-1.5"
            />
          </label>

          {!picked && hits.length > 0 && (
            <ul className="mt-2 max-h-64 divide-y divide-gray-200 overflow-y-auto rounded border border-gray-200 bg-white">
              {hits.map((it) => (
                <li key={`${it.date}|${it.restaurantName}|${it.productCode}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(it)
                      setQuantity(String(it.quantity))
                    }}
                    className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                  >
                    <span className="text-gray-500">{it.date}</span>{' '}
                    <span className="text-gray-700">{it.restaurantName}</span>
                    <br />
                    <span className="font-medium text-gray-900">{it.productName}</span>{' '}
                    <span className="text-gray-500">
                      {it.quantity}
                      {it.unit} · {won(it.tax.total)}원 ·{' '}
                      {it.tax.taxableSupply > 0 ? '과세' : '면세'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!picked && query.trim().length >= 2 && hits.length === 0 && (
            <p className="mt-2 text-xs text-gray-500">찾는 품목이 없습니다.</p>
          )}

          {picked && (
            <div className="mt-3 space-y-3">
              <p className="rounded-lg bg-white px-3 py-2 text-xs">
                <span className="text-gray-500">{picked.date}</span>{' '}
                <span className="text-gray-700">{picked.restaurantName}</span>
                <br />
                <span className="font-medium text-gray-900">{picked.productName}</span>{' '}
                <span className="text-gray-500">
                  원천 {picked.quantity}
                  {picked.unit} · 단가 {won(picked.unitPrice)}원 ·{' '}
                  {picked.tax.taxableSupply > 0 ? '과세' : '면세'}
                </span>
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-gray-500">처리</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as 'exclude' | 'move')}
                    className="rounded border border-gray-300 px-3 py-1.5"
                  >
                    <option value="exclude">정산 제외 (본인부담)</option>
                    <option value="move">식당 이동</option>
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1 block text-xs text-gray-500">
                    수량 (최대 {picked.quantity}
                    {picked.unit})
                  </span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={picked.quantity}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-28 rounded border border-gray-300 px-3 py-1.5"
                  />
                </label>

                {kind === 'move' && (
                  <label className="text-sm">
                    <span className="mb-1 block text-xs text-gray-500">이동할 식당</span>
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      className="rounded border border-gray-300 px-3 py-1.5"
                    >
                      <option value="">선택</option>
                      {moveTargets.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {preview !== null && (
                  <p className="text-sm">
                    <span className="text-xs text-gray-500">
                      {kind === 'exclude' ? '청구에서 빠질 금액' : '옮길 금액'}
                    </span>
                    <br />
                    <span className="font-semibold text-gray-900">{won(preview)}원</span>
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-gray-500">요청자</span>
                  <input
                    type="text"
                    value={requestedBy}
                    onChange={(e) => setRequestedBy(e.target.value)}
                    placeholder="김영수"
                    className="rounded border border-gray-300 px-3 py-1.5"
                  />
                </label>
                <label className="flex-1 text-sm">
                  <span className="mb-1 block text-xs text-gray-500">사유</span>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="정산제외 요청(본인부담)"
                    className="w-full rounded border border-gray-300 px-3 py-1.5"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void save()}
                disabled={!canSave || busy}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '저장 중…' : '저장하고 다시 분석'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {/* ── 처리된 내용 ── */}
      {adjustments.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">조정 없음 — 원천 그대로 청구합니다.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2 pr-3">처리</th>
                <th className="py-2 pr-3">날짜</th>
                <th className="py-2 pr-3">식당 / 품목</th>
                <th className="py-2 pr-3 text-right">수량</th>
                <th className="py-2 pr-3">사유 / 요청자</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 ${
                        a.kind === 'exclude'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {a.kind === 'exclude' ? '제외' : '이동'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-500">{a.itemDate}</td>
                  <td className="py-2 pr-3">
                    <span className="text-gray-500">{a.restaurantName}</span>
                    {a.targetRestaurantName && (
                      <span className="text-blue-700"> → {a.targetRestaurantName}</span>
                    )}
                    <br />
                    <span className="font-medium text-gray-900">{a.productName}</span>
                  </td>
                  <td className="py-2 pr-3 text-right text-gray-700">
                    {a.quantity}
                    {a.unit}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">
                    {a.reason}
                    <br />
                    <span className="text-gray-400">{a.requestedBy}</span>
                  </td>
                  <td className="py-2 text-right">
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => void remove(a.id)}
                        disabled={busy}
                        className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > 0 && (
            <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
              유치원 청구에서 <span className="font-semibold">{won(total)}원</span>이
              빠졌습니다. 그만큼 해당 영업파트너의 지급액이 줄어듭니다 (본사 적립금은
              불변).
            </p>
          )}
        </div>
      )}
    </section>
  )
}

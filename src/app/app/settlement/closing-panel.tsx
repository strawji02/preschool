'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * 월 마감 (docs §8, §14-1).
 *
 * ★ 마감의 목적은 **과거 정산을 고정**하는 것이다. 담당 영업자를 나중에 바꿔도
 * 마감된 달의 내역서·지급명세서·계산서는 그대로여야 한다.
 *
 * 그래서 저장할 때 그 달의 전체 상태를 스냅샷으로 굳히고, 다시 저장하면
 * **새 리비전을 쌓는다** — 덮어쓰지 않는다. 이력이 아래 표에 그대로 보인다.
 */

export type ClosingStatusValue = 'draft' | 'confirmed' | 'closed'

export interface ClosingTotalsView {
  revenue: number
  costOfSales: number
  marketingCost: number
  grossMargin: number
  platformFee: number
  vatDiff: number
  businessDeduction: number
  partnerPreTax: number
  withholding: number
  partnerNetPay: number
  declared: number
  hqShare: number
  operatingProfit: number
  salesVat: number
  purchaseVat: number
  vatPayable: number
  vatDiffGap: number
}

export interface ClosingView {
  period: string
  status: ClosingStatusValue
  revision: number
  totals: ClosingTotalsView
  confirmedAt: string | null
  confirmedBy: string | null
  closedAt: string | null
  closedBy: string | null
  updatedAt: string
  /** 마감 해제 횟수. 0보다 크면 마감 후 수정이 있었다 */
  reopenCount: number
}

export interface ClosingRevisionView {
  revision: number
  status: ClosingStatusValue
  /** `save` = 확정·마감 저장 / `reopen` = 마감 해제 */
  action: 'save' | 'reopen'
  reason: string | null
  createdAt: string
  createdBy: string | null
}

const won = (n: number) => n.toLocaleString('ko-KR')

const STATUS_LABEL: Record<ClosingStatusValue, string> = {
  draft: '작성중',
  confirmed: '확정',
  closed: '마감',
}

const STATUS_STYLE: Record<ClosingStatusValue, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-800',
  closed: 'bg-emerald-100 text-emerald-800',
}

function when(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`
}

export default function ClosingPanel({
  period,
  canClose,
  memoPendingCount,
  isAdmin,
  onSave,
  onStatusChange,
}: {
  /** `YYYY-MM` */
  period: string
  /** 필수 게이트를 모두 통과했는지. 서버도 다시 검사한다 */
  canClose: boolean
  /** 처리되지 않은 상시 정산 메모 수 */
  memoPendingCount: number
  /** 마감 해제 권한 (docs §8 — admin만) */
  isAdmin: boolean
  /** 저장 실행 — 파일·공제·분할을 붙여 보내는 건 부모가 한다 */
  onSave: (action: 'confirm' | 'close', reason: string | null) => Promise<boolean>
  /** 현재 상태를 부모에게 알린다 — 입력 잠금과 재확정 안내에 쓴다 */
  onStatusChange: (status: ClosingStatusValue) => void
}) {
  const [closing, setClosing] = useState<ClosingView | null>(null)
  const [revisions, setRevisions] = useState<ClosingRevisionView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'confirm' | 'close' | 'reopen' | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/settlement/closing?period=${encodeURIComponent(period)}`)
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        closing?: ClosingView | null
        revisions?: ClosingRevisionView[]
      } | null
      if (json?.success) {
        setClosing(json.closing ?? null)
        setRevisions(json.revisions ?? [])
        onStatusChange(json.closing?.status ?? 'draft')
      }
    } finally {
      setLoading(false)
    }
  }, [period, onStatusChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save(action: 'confirm' | 'close') {
    setBusy(action)
    try {
      const ok = await onSave(action, reason.trim() || null)
      if (ok) {
        setReason('')
        await refresh()
      }
    } finally {
      setBusy(null)
    }
  }

  /** 마감 해제 (docs §8) — admin만, 사유 필수 */
  async function reopen() {
    const why = reason.trim()
    if (why === '') return
    setBusy('reopen')
    setError(null)
    try {
      const res = await fetch('/api/settlement/closing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, reason: why }),
      })
      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; error?: string }
        | null
      if (!res.ok || !json?.success) {
        setError(json?.error ?? '마감 해제에 실패했습니다.')
        return
      }
      setReason('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '마감 해제 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const status: ClosingStatusValue = closing?.status ?? 'draft'
  const isClosed = status === 'closed'
  /** 마감 후 재저장은 이유를 반드시 남긴다 (docs §8) */
  const needsReason = closing !== null
  const reasonMissing = needsReason && reason.trim() === ''

  return (
    <section id="settlement-closing" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-900">
          8. 월 마감
          <span
            className={`ml-3 rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
          {closing && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              {period} · 리비전 {closing.revision}
            </span>
          )}
          {closing && closing.reopenCount > 0 && (
            <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
              마감 해제 {closing.reopenCount}회
            </span>
          )}
        </h2>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        마감하면 그 달의 <strong>담당 영업자·수수료율·공제·분할신고까지 통째로 굳습니다.</strong>{' '}
        나중에 담당자를 바꿔도 마감된 달의 내역서는 달라지지 않습니다.
        <br />
        다시 저장하면 덮어쓰지 않고 <span className="font-medium">새 리비전</span>이 쌓입니다.
      </p>

      {closing && (
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
          <div className="flex justify-between">
            <dt>확정</dt>
            <dd className="tabular-nums">
              {when(closing.confirmedAt)}
              {closing.confirmedBy && ` · ${closing.confirmedBy}`}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt>마감</dt>
            <dd className="tabular-nums">
              {when(closing.closedAt)}
              {closing.closedBy && ` · ${closing.closedBy}`}
            </dd>
          </div>
        </dl>
      )}

      {/* ── 확정된 재무 요약 (docs §13) ── */}
      {closing && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[560px] text-right text-sm">
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-2 text-left text-gray-600">매출 (계산서 발행분)</td>
                <td className="py-2 tabular-nums">{won(closing.totals.revenue)}</td>
              </tr>
              <tr>
                <td className="py-2 text-left text-gray-600">매출원가</td>
                <td className="py-2 tabular-nums">− {won(closing.totals.costOfSales)}</td>
              </tr>
              <tr className="font-medium">
                <td className="py-2 text-left">총마진</td>
                <td className="py-2 tabular-nums">{won(closing.totals.grossMargin)}</td>
              </tr>
              <tr>
                <td className="py-2 text-left text-gray-600">영업자 세전 지급액</td>
                <td className="py-2 tabular-nums">− {won(closing.totals.partnerPreTax)}</td>
              </tr>
              <tr className="font-medium">
                <td className="py-2 text-left">
                  본사 몫
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    적립금 {won(closing.totals.platformFee)} + 부가세차액{' '}
                    {won(closing.totals.vatDiff)} + 공제{' '}
                    {won(closing.totals.businessDeduction)}
                  </span>
                </td>
                <td className="py-2 tabular-nums">{won(closing.totals.hqShare)}</td>
              </tr>
              <tr>
                <td className="py-2 text-left text-gray-600">마케팅비 (본사 자체 소비분)</td>
                <td className="py-2 tabular-nums">− {won(closing.totals.marketingCost)}</td>
              </tr>
              <tr className="border-t-2 border-gray-300 text-base font-semibold">
                <td className="py-2 text-left">영업이익</td>
                <td className="py-2 tabular-nums text-gray-900">
                  {won(closing.totals.operatingProfit)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Fact
              label="부가세 납부"
              value={closing.totals.vatPayable}
              hint={`매출세액 ${won(closing.totals.salesVat)} − 매입세액 ${won(
                closing.totals.purchaseVat
              )}`}
            />
            <Fact
              label="원천세 (익월 10일)"
              value={closing.totals.withholding}
              hint={`사업소득 신고액 ${won(closing.totals.declared)}`}
            />
            <Fact
              label="영업자 실지급"
              value={closing.totals.partnerNetPay}
              hint="세전 − 원천세"
            />
          </div>

          {closing.totals.vatDiffGap !== 0 && (
            <p className="mt-3 text-xs leading-relaxed text-gray-400">
              대조: 영업자에게 회수한 부가세차액이 실제 납부액보다{' '}
              <span className="font-medium text-gray-600">
                {won(closing.totals.vatDiffGap)}원
              </span>{' '}
              많습니다 — 마케팅비에 딸린 매입세액 공제분입니다. 이상 항목이 아닙니다.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {/* ── 저장 / 해제 ── */}
      <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
        {isClosed ? (
          <>
            <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <p className="font-medium">이 달은 마감되었습니다 — 수정할 수 없습니다.</p>
              <p className="mt-1 text-xs leading-relaxed">
                공제·분할신고 입력이 잠겼습니다. 산출물(계산서·내역서)은 계속 받을 수
                있습니다.
                {isAdmin
                  ? ' 고쳐야 하면 아래에서 마감을 해제하세요 — 이력에 남습니다.'
                  : ' 고쳐야 하면 관리자에게 마감 해제를 요청하세요.'}
              </p>
            </div>

            {isAdmin && (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block text-xs text-gray-500">
                    마감 해제 사유 (필수) — 세무 문서가 바뀌는 일이라 이력에 남습니다
                  </span>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="예: 세무사 확인 결과 이동현 공제 누락"
                    className="w-full rounded border border-gray-300 px-3 py-1.5 focus:border-gray-500 focus:outline-none"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void reopen()}
                    disabled={busy !== null || reason.trim() === ''}
                    className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'reopen' ? '해제 중…' : '마감 해제'}
                  </button>
                  {reason.trim() === '' && (
                    <span className="text-xs text-amber-700">해제 사유를 적어 주세요</span>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {needsReason && (
              <label className="block text-sm">
                <span className="mb-1 block text-xs text-gray-500">
                  다시 저장하는 이유 (필수) — 저장 이력으로 남습니다
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="예: 김중영 사업자공제 누락분 반영"
                  className="w-full rounded border border-gray-300 px-3 py-1.5 focus:border-gray-500 focus:outline-none"
                />
              </label>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save('confirm')}
                disabled={busy !== null || !canClose || reasonMissing}
                className="rounded-lg border border-gray-900 px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'confirm' ? '저장 중…' : '확정'}
              </button>
              <button
                type="button"
                onClick={() => void save('close')}
                disabled={busy !== null || !canClose || reasonMissing}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'close' ? '저장 중…' : '마감'}
              </button>
              {!canClose && (
                <span className="text-xs text-red-600">
                  {memoPendingCount > 0
                    ? `정산 메모 미확인 ${memoPendingCount}건을 처리해야 확정할 수 있습니다`
                    : '위 필수 항목을 모두 해결해야 마감할 수 있습니다'}
                </span>
              )}
              {canClose && reasonMissing && (
                <span className="text-xs text-amber-700">
                  다시 저장하는 이유를 적어 주세요
                </span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-gray-400">
              <strong>확정</strong>하면 보고서·계산서가 만들어지고 금액은 계속 고칠 수
              있습니다. <strong>마감</strong>하면 더 이상 수정할 수 없습니다.
            </p>
          </>
        )}
      </div>

      {/* ── 이력 ── */}
      {revisions.length > 0 && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-medium text-gray-900">
            저장 이력 {revisions.length}건
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-gray-600">
            {revisions.map((r) => (
              <li key={r.revision} className="flex flex-wrap gap-2">
                <span className="tabular-nums text-gray-400">#{r.revision}</span>
                {r.action === 'reopen' ? (
                  <span className="rounded bg-red-100 px-1.5 font-medium text-red-700">
                    마감 해제
                  </span>
                ) : (
                  <span className={`rounded px-1.5 ${STATUS_STYLE[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                )}
                <span className="tabular-nums">{when(r.createdAt)}</span>
                {r.createdBy && <span className="text-gray-400">{r.createdBy}</span>}
                {r.reason && <span className="text-gray-500">— {r.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading && !closing && (
        <p className="mt-4 text-xs text-gray-400">마감 상태를 불러오는 중…</p>
      )}
    </section>
  )
}

function Fact({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{won(value)}</p>
      <p className="mt-0.5 text-xs text-gray-400">{hint}</p>
    </div>
  )
}

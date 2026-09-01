'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileCheck2,
  History,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'

interface Summary {
  totalVersions: number
  newProposalCount: number
  reissueCount: number
  bothChangedCount: number
  statementOnlyChangedCount: number
  amountOnlyChangedCount: number
  neitherChangedCount: number
  kindergartenCount: number
}

interface DashboardRow {
  id: string
  proposalId: string
  sessionId: string
  kindergartenId: string
  kindergartenName: string
  targetPeriod: string
  officialVersionNo: number
  issueFormat: string
  statementChanged: boolean | null
  proposalAmountChanged: boolean | null
  statementDiff: Record<string, number>
  amountDiff: Record<string, number>
  amountSnapshot: Record<string, number>
  changeReasons: string[]
  issuedAt: string
  issuerId: string | null
  issuerName: string
  issuerEmail: string
}

interface Issuer {
  id: string
  name: string
  email: string
}

interface DashboardData {
  month: string
  officialStartAt: string
  summary: Summary
  rows: DashboardRow[]
  issuers: Issuer[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

interface DetailVersion {
  id: string
  rawVersionNo: number
  versionNo: number
  issueFormat: string
  statementChanged: boolean | null
  proposalAmountChanged: boolean | null
  statementDiff: Record<string, number>
  amountDiff: Record<string, number>
  amountSnapshot: Record<string, number>
  changeReasons: string[]
  issuedAt: string
  issuer: Issuer | null
}

type ChangeType = 'all' | 'new' | 'reissue' | 'both' | 'statement_only' | 'amount_only' | 'neither'

const CHANGE_OPTIONS: Array<{ value: ChangeType; label: string }> = [
  { value: 'all', label: '전체 발행' },
  { value: 'new', label: '신규' },
  { value: 'reissue', label: '전체 재발행' },
  { value: 'both', label: '명세·금액 변경' },
  { value: 'statement_only', label: '명세만 변경' },
  { value: 'amount_only', label: '금액만 변경' },
  { value: 'neither', label: '변경 없음' },
]

function currentKstMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
  }).format(new Date())
}

function won(value: number | undefined): string {
  return `${Math.round(value ?? 0).toLocaleString('ko-KR')}원`
}

function kstDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

function monthLabel(value: string): string {
  const [year, month] = value.split('-')
  return `${year}년 ${Number(month)}월`
}

function formatLabel(value: string): string {
  return value === 'pptx' ? 'PPTX' : value === 'pdf_print' ? 'PDF/인쇄' : value
}

function changeLabel(row: Pick<DashboardRow, 'officialVersionNo' | 'statementChanged' | 'proposalAmountChanged'>) {
  if (row.officialVersionNo === 1) return { label: '신규 발행', style: 'bg-sky-50 text-sky-700 ring-sky-200' }
  if (row.statementChanged && row.proposalAmountChanged) return { label: '명세·금액 변경', style: 'bg-violet-50 text-violet-700 ring-violet-200' }
  if (row.statementChanged) return { label: '명세만 변경', style: 'bg-amber-50 text-amber-800 ring-amber-200' }
  if (row.proposalAmountChanged) return { label: '금액만 변경', style: 'bg-rose-50 text-rose-700 ring-rose-200' }
  return { label: '변경 없음', style: 'bg-slate-100 text-slate-600 ring-slate-200' }
}

function MetricCard({ label, value, note, tone = 'slate' }: {
  label: string
  value: number
  note: string
  tone?: 'slate' | 'sky' | 'emerald' | 'violet'
}) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-900',
    sky: 'border-sky-200 bg-sky-50/60 text-sky-950',
    emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-950',
    violet: 'border-violet-200 bg-violet-50/60 text-violet-950',
  }
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value.toLocaleString('ko-KR')}</p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
    </div>
  )
}

export function ProposalHistoryDashboard() {
  const [month, setMonth] = useState(currentKstMonth)
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [changeType, setChangeType] = useState<ChangeType>('all')
  const [issuerId, setIssuerId] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<DashboardRow | null>(null)
  const [versions, setVersions] = useState<DetailVersion[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const loadDashboard = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      month,
      search,
      change_type: changeType,
      issuer_id: issuerId,
      page: String(page),
      page_size: '20',
    })
    try {
      const response = await fetch(`/api/comparison/proposals/dashboard?${params}`, { signal })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || '현황을 불러오지 못했습니다.')
      setData(result.dashboard)
    } catch (fetchError) {
      if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
      setError(fetchError instanceof Error ? fetchError.message : '현황을 불러오지 못했습니다.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [changeType, issuerId, month, page, search])

  useEffect(() => {
    const controller = new AbortController()
    loadDashboard(controller.signal)
    return () => controller.abort()
  }, [loadDashboard])

  const openDetail = async (row: DashboardRow) => {
    setSelected(row)
    setVersions([])
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/comparison/proposals?session_id=${encodeURIComponent(row.sessionId)}`)
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || '상세 이력을 불러오지 못했습니다.')
      setVersions(result.versions ?? [])
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : '상세 이력을 불러오지 못했습니다.')
    } finally {
      setDetailLoading(false)
    }
  }

  const applySearch = () => {
    setPage(1)
    setSearch(searchDraft.trim())
  }

  const summary = data?.summary

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-slate-900 text-white shadow-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <Link href="/calc-food" className="flex items-center gap-2 text-sm text-slate-300 transition hover:text-white">
              <ArrowLeft size={18} /> 비교 시스템
            </Link>
            <div className="h-6 w-px bg-slate-700" />
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold">
                <History size={19} className="text-sky-300" /> 제안서 현황
              </h1>
              <p className="mt-0.5 text-xs text-slate-400">공식 시작 이후 실제 발행만 집계합니다.</p>
            </div>
          </div>
          <button
            onClick={() => loadDashboard()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> 새로고침
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-screen-2xl space-y-6 px-5 py-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-semibold text-slate-500">
              조회 월
              <input
                type="month"
                value={month}
                onChange={(event) => { setMonth(event.target.value); setPage(1) }}
                className="block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="min-w-48 space-y-1 text-xs font-semibold text-slate-500">
              변경 유형
              <select
                value={changeType}
                onChange={(event) => { setChangeType(event.target.value as ChangeType); setPage(1) }}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500"
              >
                {CHANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="min-w-44 space-y-1 text-xs font-semibold text-slate-500">
              발행 담당자
              <select
                value={issuerId}
                onChange={(event) => { setIssuerId(event.target.value); setPage(1) }}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500"
              >
                <option value="">전체 담당자</option>
                {(data?.issuers ?? []).map((issuer) => <option key={issuer.id} value={issuer.id}>{issuer.name}</option>)}
              </select>
            </label>
            <div className="min-w-64 flex-1 space-y-1">
              <span className="text-xs font-semibold text-slate-500">유치원 검색</span>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') applySearch() }}
                    placeholder="유치원명 입력"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  />
                </div>
                <button onClick={applySearch} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">검색</button>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="발행 유치원" value={summary?.kindergartenCount ?? 0} note={`${monthLabel(month)} 중복 제거`} tone="sky" />
          <MetricCard label="신규 제안서" value={summary?.newProposalCount ?? 0} note="공식 첫 발행" tone="emerald" />
          <MetricCard label="재발행" value={summary?.reissueCount ?? 0} note="공식 2차 이상" tone="violet" />
          <MetricCard label="전체 발행 버전" value={summary?.totalVersions ?? 0} note="신규와 재발행 합계" />
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['명세·금액 변경', summary?.bothChangedCount ?? 0, 'border-violet-200 bg-violet-50 text-violet-800'],
            ['명세만 변경', summary?.statementOnlyChangedCount ?? 0, 'border-amber-200 bg-amber-50 text-amber-800'],
            ['금액만 변경', summary?.amountOnlyChangedCount ?? 0, 'border-rose-200 bg-rose-50 text-rose-800'],
            ['변경 없음', summary?.neitherChangedCount ?? 0, 'border-slate-200 bg-slate-50 text-slate-700'],
          ].map(([label, value, style]) => (
            <div key={String(label)} className={`flex items-center justify-between rounded-xl border px-4 py-3 ${style}`}>
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xl font-bold tabular-nums">{Number(value).toLocaleString('ko-KR')}</span>
            </div>
          ))}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">유치원별 발행 이력</h2>
              <p className="mt-1 text-xs text-slate-400">행을 선택하면 공식 버전 타임라인과 변경 근거를 확인할 수 있습니다.</p>
            </div>
            <span className="text-sm text-slate-500">총 {data?.total.toLocaleString('ko-KR') ?? 0}건</span>
          </div>

          {loading ? (
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 size={18} className="animate-spin" /> 현황을 불러오는 중…
            </div>
          ) : !data?.rows.length ? (
            <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
              <FileCheck2 size={38} className="text-slate-300" />
              <p className="mt-4 font-medium text-slate-700">조건에 맞는 공식 발행 기록이 없습니다.</p>
              <p className="mt-1 text-sm text-slate-400">기존 자료와 과거 추정치는 표시하지 않습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">유치원</th>
                    <th className="px-4 py-3 text-center font-semibold">버전</th>
                    <th className="px-4 py-3 text-left font-semibold">변경 유형</th>
                    <th className="px-4 py-3 text-right font-semibold">월 제안금액</th>
                    <th className="px-4 py-3 text-right font-semibold">직전 대비</th>
                    <th className="px-4 py-3 text-left font-semibold">담당자</th>
                    <th className="px-4 py-3 text-left font-semibold">발행시각</th>
                    <th className="px-5 py-3 text-center font-semibold">상세</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((row) => {
                    const change = changeLabel(row)
                    const delta = row.officialVersionNo === 1 ? null : row.amountDiff.monthlyProposedAmount ?? 0
                    return (
                      <tr key={row.id} className="transition hover:bg-sky-50/40">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-900">{row.kindergartenName}</p>
                          <p className="mt-1 text-xs text-slate-400">기준 {row.targetPeriod || '미지정'} · {formatLabel(row.issueFormat)}</p>
                        </td>
                        <td className="px-4 py-4 text-center font-semibold tabular-nums text-slate-700">v{row.officialVersionNo}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${change.style}`}>{change.label}</span>
                        </td>
                        <td className="px-4 py-4 text-right font-semibold tabular-nums text-slate-800">{won(row.amountSnapshot.monthlyProposedAmount)}</td>
                        <td className={`px-4 py-4 text-right font-medium tabular-nums ${delta == null ? 'text-slate-400' : delta > 0 ? 'text-rose-600' : delta < 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {delta == null ? '최초' : `${delta > 0 ? '+' : ''}${won(delta)}`}
                        </td>
                        <td className="px-4 py-4 text-slate-600">{row.issuerName}</td>
                        <td className="px-4 py-4 whitespace-nowrap text-xs text-slate-500">{kstDateTime(row.issuedAt)}</td>
                        <td className="px-5 py-4 text-center">
                          <button onClick={() => openDetail(row)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky-400 hover:text-sky-700">상세 보기</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
            <p className="text-xs text-slate-400">
              공식 집계 시작 {data ? kstDateTime(data.officialStartAt) : '확인 중'}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={!data || data.page <= 1 || loading}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                aria-label="이전 페이지"
              ><ChevronLeft size={16} /></button>
              <span className="min-w-20 text-center text-sm tabular-nums text-slate-600">{data?.page ?? 1} / {data?.pageCount ?? 1}</span>
              <button
                onClick={() => setPage((value) => Math.min(data?.pageCount ?? value, value + 1))}
                disabled={!data || data.page >= data.pageCount || loading}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                aria-label="다음 페이지"
              ><ChevronRight size={16} /></button>
            </div>
          </div>
        </section>
      </main>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45" role="dialog" aria-modal="true" aria-label="제안서 버전 상세">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-slate-50 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <p className="text-xs font-semibold text-sky-700">공식 발행 이력</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">{selected.kindergartenName}</h2>
                <p className="mt-1 text-sm text-slate-500">기준 {selected.targetPeriod || '미지정'}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="상세 닫기"><X size={20} /></button>
            </div>
            <div className="space-y-4 p-6">
              {detailLoading ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" /> 상세 이력을 불러오는 중…</div>
              ) : versions.length === 0 ? (
                <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">공식 버전 상세가 없습니다.</p>
              ) : versions.map((version) => {
                const change = changeLabel({ officialVersionNo: version.versionNo, statementChanged: version.statementChanged, proposalAmountChanged: version.proposalAmountChanged })
                return (
                  <article key={version.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">v{version.versionNo}</span>
                        <div>
                          <p className="font-semibold text-slate-800">{kstDateTime(version.issuedAt)}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{formatLabel(version.issueFormat)} · {version.issuer?.name ?? '시스템'}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${change.style}`}>{change.label}</span>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs text-slate-400">월 기존금액</p>
                        <p className="mt-1 font-semibold tabular-nums">{won(version.amountSnapshot.monthlyExistingAmount)}</p>
                      </div>
                      <div className="rounded-xl bg-sky-50 p-3">
                        <p className="text-xs text-sky-600">월 제안금액</p>
                        <p className="mt-1 font-semibold tabular-nums text-sky-900">{won(version.amountSnapshot.monthlyProposedAmount)}</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <p className="text-xs text-emerald-600">월 절감액</p>
                        <p className="mt-1 font-semibold tabular-nums text-emerald-900">{won(version.amountSnapshot.monthlySavings)}</p>
                      </div>
                    </div>
                    {version.versionNo > 1 && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
                          <p className="flex items-center gap-1.5 font-semibold text-slate-700"><SlidersHorizontal size={14} /> 거래명세표 변경</p>
                          <p className="mt-2 text-xs">추가 {version.statementDiff.addedCount ?? 0} · 삭제 {version.statementDiff.removedCount ?? 0} · 수정 {version.statementDiff.modifiedCount ?? 0}</p>
                          <p className="mt-1 text-xs">총액 증감 {won(version.statementDiff.totalDelta)}</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-600">
                          <p className="flex items-center gap-1.5 font-semibold text-slate-700"><Clock3 size={14} /> 제안금액 변경</p>
                          <p className="mt-2 text-xs">월 제안금액 증감 {won(version.amountDiff.monthlyProposedAmount)}</p>
                          <p className="mt-1 text-xs">공급율 {Number(version.amountSnapshot.supplyRate ?? 0).toFixed(2)}배</p>
                        </div>
                      </div>
                    )}
                    {version.changeReasons.length > 0 && <p className="mt-4 text-xs text-slate-500">변경 사유: {version.changeReasons.join(', ')}</p>}
                  </article>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

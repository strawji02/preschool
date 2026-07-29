'use client'

import { useMemo, useRef, useState } from 'react'
// ⚠️ 클라이언트 전용 배럴을 쓴다. 메인 배럴은 Supabase service_role 접근 코드를
// 함께 내보내므로 브라우저 번들에 서버 코드가 끌려 들어간다.
import {
  calcSettlement,
  type PartnerType,
  type SettlementResult,
} from '@/features/settlement/client'

/**
 * 정산 작업 화면.
 *
 * 사업자공제(Q)를 바꿀 때마다 서버를 왕복하지 않는다 — 산식이 순수 함수라
 * 브라우저에서 그대로 돌린다. 다운로드 시점에만 서버가 같은 산식으로 다시 계산한다.
 */

interface AnalyzedPartner {
  partnerId: string
  partnerName: string
  partnerType: PartnerType
  venueCount: number
  costTotal: number
  costVat: number
  priceTotal: number
  priceVat: number
}

interface AnalyzeResponse {
  success: boolean
  error?: string
  partners: AnalyzedPartner[]
  excluded: { businessName: string; costTotal: number; priceTotal: number }[]
  unmapped: { source: string; businessCode: string; businessName: string; costTotal: number }[]
  sources: {
    shinsegae: { fileName: string; sheetName: string; venueCount: number } | null
    cj: { fileName: string; sheetName: string; venueCount: number } | null
  }
  warnings: string[]
  errors: string[]
  canClose: boolean
}

const won = (n: number) => n.toLocaleString('ko-KR')

export default function SettlementWorkspace() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null)
  const [deductions, setDeductions] = useState<Record<string, number>>({})
  const [period, setPeriod] = useState(defaultPeriod())
  const [busy, setBusy] = useState<'analyze' | 'download' | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** 공제액을 반영한 산식 결과 — 입력이 바뀌면 즉시 다시 계산된다 */
  const settlements = useMemo(() => {
    const map = new Map<string, SettlementResult>()
    for (const p of analysis?.partners ?? []) {
      map.set(
        p.partnerId,
        calcSettlement({
          costTotal: p.costTotal,
          costVat: p.costVat,
          priceTotal: p.priceTotal,
          priceVat: p.priceVat,
          partnerType: p.partnerType,
          businessDeduction: deductions[p.partnerId] ?? 0,
        })
      )
    }
    return map
  }, [analysis, deductions])

  function buildFormData(): FormData {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    return fd
  }

  async function analyze() {
    if (files.length === 0) {
      setError('엑셀 파일을 선택해 주세요.')
      return
    }
    setBusy('analyze')
    setError(null)
    setAnalysis(null)
    try {
      const res = await fetch('/api/settlement/analyze', {
        method: 'POST',
        body: buildFormData(),
      })
      const json: AnalyzeResponse = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error ?? '분석에 실패했습니다.')
        return
      }
      setAnalysis(json)
      setDeductions({})
    } catch (e) {
      setError(e instanceof Error ? e.message : '분석 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    setBusy('download')
    setError(null)
    try {
      const fd = buildFormData()
      fd.append('deductions', JSON.stringify(deductions))
      fd.append('period', period)

      const res = await fetch('/api/settlement/report', { method: 'POST', body: fd })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        setError(json?.error ?? '내역서 생성에 실패했습니다.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `정산내역서_${period || '기간미지정'}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : '다운로드 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  const totals = useMemo(() => {
    let preTax = 0
    let netPay = 0
    let declared = 0
    for (const s of settlements.values()) {
      preTax += s.preTax
      netPay += s.netPay
      declared += s.declared
    }
    return { preTax, netPay, declared }
  }, [settlements])

  return (
    <div className="mt-8 space-y-6">
      {/* 업로드 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">1. 원천 파일 업로드</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".xlsx,.xls,.xlsm"
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []))
              setAnalysis(null)
            }}
            className="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-gray-700 hover:file:bg-gray-50"
          />
          <button
            type="button"
            onClick={analyze}
            disabled={busy !== null || files.length === 0}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'analyze' ? '분석 중…' : '분석'}
          </button>
        </div>
        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-gray-500">
            {files.map((f) => (
              <li key={f.name}>
                {f.name} · {(f.size / 1024).toFixed(0)}KB
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {analysis && (
        <>
          {/* 판별 결과 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">2. 판별된 원천 시트</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <SourceCard label="신세계" src={analysis.sources.shinsegae} />
              <SourceCard label="CJ" src={analysis.sources.cj} />
            </dl>

            {analysis.excluded.length > 0 && (
              <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
                정산 제외 {analysis.excluded.length}건 —{' '}
                {analysis.excluded.map((e) => e.businessName).join(', ')} (원가{' '}
                {won(analysis.excluded.reduce((s, e) => s + e.costTotal, 0))}원)
              </p>
            )}

            {analysis.unmapped.length > 0 && (
              <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <p className="font-medium">
                  담당 영업자가 지정되지 않은 사업장 {analysis.unmapped.length}건 — 마감할 수 없습니다
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {analysis.unmapped.map((u) => (
                    <li key={`${u.source}:${u.businessCode}`}>
                      {u.source}:{u.businessCode} {u.businessName} (원가 {won(u.costTotal)}원)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.warnings.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {analysis.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </section>

          {/* 정산 결과 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">3. 영업자별 정산</h2>
            <p className="mt-1 text-xs text-gray-500">
              사업자공제는 매월 수기 입력입니다. 값을 바꾸면 즉시 재계산됩니다.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[860px] text-right text-sm">
                <thead className="border-b border-gray-200 text-xs text-gray-500">
                  <tr>
                    <th className="py-2 text-left font-medium">영업자</th>
                    <th className="py-2 font-medium">원가합계</th>
                    <th className="py-2 font-medium">단가합계</th>
                    <th className="py-2 font-medium">적립금</th>
                    <th className="py-2 font-medium">부가세차액</th>
                    <th className="py-2 font-medium">사업자공제</th>
                    <th className="py-2 font-medium">세전</th>
                    <th className="py-2 font-medium">신고액</th>
                    <th className="py-2 font-medium">실지급</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analysis.partners.map((p) => {
                    const s = settlements.get(p.partnerId)
                    if (!s) return null
                    return (
                      <tr key={p.partnerId}>
                        <td className="py-2 text-left">
                          <span className="font-medium text-gray-900">{p.partnerName}</span>
                          {p.partnerType === 'cofounder' && (
                            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                              코파운더
                            </span>
                          )}
                          <span className="ml-2 text-xs text-gray-400">
                            식당 {p.venueCount}
                          </span>
                        </td>
                        <td className="py-2 tabular-nums">{won(p.costTotal)}</td>
                        <td className="py-2 tabular-nums">{won(p.priceTotal)}</td>
                        <td className="py-2 tabular-nums">{won(s.platformFee)}</td>
                        <td className="py-2 tabular-nums">{won(s.vatDiff)}</td>
                        <td className="py-2">
                          <input
                            type="number"
                            min={0}
                            step={10}
                            value={deductions[p.partnerId] ?? 0}
                            onChange={(e) =>
                              setDeductions((prev) => ({
                                ...prev,
                                [p.partnerId]: Number(e.target.value) || 0,
                              }))
                            }
                            className="w-28 rounded border border-gray-300 px-2 py-1 text-right tabular-nums focus:border-gray-500 focus:outline-none"
                          />
                        </td>
                        <td className="py-2 tabular-nums">{won(s.preTax)}</td>
                        <td className="py-2 tabular-nums">{won(s.declared)}</td>
                        <td className="py-2 font-semibold tabular-nums text-gray-900">
                          {won(s.netPay)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t-2 border-gray-300 text-sm font-semibold">
                  <tr>
                    <td className="py-2 text-left">합계</td>
                    <td colSpan={5} />
                    <td className="py-2 tabular-nums">{won(totals.preTax)}</td>
                    <td className="py-2 tabular-nums">{won(totals.declared)}</td>
                    <td className="py-2 tabular-nums text-gray-900">{won(totals.netPay)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {[...settlements.values()].some((s) => s.warnings.length > 0) && (
              <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">
                {[...settlements.entries()].flatMap(([id, s]) =>
                  s.warnings.map((w, i) => {
                    const name = analysis.partners.find((p) => p.partnerId === id)?.partnerName
                    return <li key={`${id}-${i}`}>{name}: {w}</li>
                  })
                )}
              </ul>
            )}
          </section>

          {/* 다운로드 */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="font-semibold text-gray-900">4. 내역서 다운로드</h2>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs text-gray-500">정산 기간</span>
                <input
                  type="text"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  placeholder="26년6월"
                  className="rounded border border-gray-300 px-3 py-1.5 focus:border-gray-500 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={download}
                disabled={busy !== null || !analysis.canClose}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'download' ? '생성 중…' : '엑셀 다운로드'}
              </button>
              {!analysis.canClose && (
                <span className="text-xs text-red-600">
                  매핑 누락을 해결해야 내역서를 만들 수 있습니다
                </span>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-gray-500">
              기존 <code className="rounded bg-gray-100 px-1">집계표_정산용</code> 시트와 같은
              레이아웃으로 만듭니다. 열 위치가 동일하니 나란히 놓고 대조해 보세요.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function SourceCard({
  label,
  src,
}: {
  label: string
  src: { fileName: string; sheetName: string; venueCount: number } | null
}) {
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <dt className="text-xs text-gray-500">{label}</dt>
      {src ? (
        <dd className="mt-1 text-sm">
          <span className="font-medium text-gray-900">{src.sheetName}</span>
          <span className="ml-2 text-xs text-gray-400">사업장×식당 {src.venueCount}건</span>
          <div className="mt-0.5 truncate text-xs text-gray-400">{src.fileName}</div>
        </dd>
      ) : (
        <dd className="mt-1 text-sm text-red-600">찾지 못했습니다</dd>
      )}
    </div>
  )
}

/** 이번 달 기준 기본 기간 라벨 (예: 26년7월) */
function defaultPeriod(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  return `${yy}년${now.getMonth() + 1}월`
}

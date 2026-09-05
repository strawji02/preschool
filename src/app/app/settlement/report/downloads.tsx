'use client'

import { useState } from 'react'

/**
 * 확정·마감된 달의 산출물 다시 받기 (docs §8-2).
 *
 * 지금까지 다운로드는 **업로드 화면에만** 있었다. 브라우저를 닫았다 열면 분석
 * 결과가 사라져 계산서도 내역서도 받을 수 없었다 — 세무사가 며칠 뒤 "그 파일
 * 다시 주세요"라고 하면 원천 엑셀을 찾아 다시 올려야 했다.
 *
 * 더 나쁜 건 그사이 마스터가 바뀌었을 때다. 다시 올리면 **다른 파일이 나온다.**
 * 여기서는 마감 스냅샷으로만 만들므로 언제 받아도 같은 파일이다.
 */

type Kind = 'taxable' | 'exempt' | 'report' | 'partner-all' | `partner:${string}`
type Venue = {
  source: 'shinsegae' | 'cj'
  businessCode: string
  businessName: string
}
type BusyKey = Kind | 'venue-all' | `venue:${'shinsegae' | 'cj'}:${string}`

const LABEL: Record<'taxable' | 'exempt' | 'report' | 'partner-all', string> = {
  taxable: '세금계산서 (과세)',
  exempt: '계산서 (면세)',
  report: '정산 내역서',
  'partner-all': '파트너 정산서 전체',
}

export default function ReportDownloads({
  period,
  taxableCount,
  exemptCount,
  partners,
  closingRevision,
  statementVenues,
}: {
  /** `YYYY-MM` */
  period: string
  taxableCount: number
  exemptCount: number
  partners: { partnerId: string; partnerName: string }[]
  closingRevision: number
  statementVenues: Venue[]
}) {
  const [busy, setBusy] = useState<BusyKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function download(kind: Kind) {
    setBusy(kind)
    setError(null)
    try {
      const url = kind === 'partner-all'
        ? `/api/settlement/partner-report?period=${period}`
        : kind.startsWith('partner:')
          ? `/api/settlement/partner-report?period=${period}&partnerId=${encodeURIComponent(kind.slice(8))}`
        : kind === 'report'
          ? `/api/settlement/report?period=${period}`
          : `/api/settlement/invoice?period=${period}&kind=${kind}`
      const res = await fetch(url)

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        const label = kind.startsWith('partner:') ? '파트너 정산서' : LABEL[kind as keyof typeof LABEL]
        setError(json?.error ?? `${label}를 만들지 못했습니다.`)
        return
      }

      // 파일명은 서버가 정한다 — 업로드 경로와 같은 이름이어야 한다
      const blob = await res.blob()
      const name = fileNameOf(res.headers.get('Content-Disposition'))
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = name ?? `${period}.xlsx`
      a.click()
      URL.revokeObjectURL(href)
    } catch (e) {
      setError(e instanceof Error ? e.message : '다운로드 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function downloadVenue(venue: Venue) {
    const key = `venue:${venue.source}:${venue.businessCode}` as const
    setBusy(key)
    setError(null)
    try {
      const form = new FormData()
      form.append('period', period)
      form.append('source', venue.source)
      form.append('businessCode', venue.businessCode)
      form.append('priceBookPeriod', period)
      form.append('closingRevision', String(closingRevision))
      const res = await fetch('/api/settlement/venue-statement', { method: 'POST', body: form })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? `${venue.businessName} 거래명세표를 만들지 못했습니다.`)
        return
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = fileNameOf(res.headers.get('Content-Disposition')) ??
        `거래명세표_${venue.businessName}_${period}.xlsx`
      a.click()
      URL.revokeObjectURL(href)
    } catch (e) {
      setError(e instanceof Error ? e.message : '거래명세표 다운로드 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  async function downloadAllVenues() {
    setBusy('venue-all')
    setError(null)
    try {
      const form = new FormData()
      form.append('period', period)
      form.append('all', 'true')
      form.append('priceBookPeriod', period)
      form.append('closingRevision', String(closingRevision))
      const res = await fetch('/api/settlement/venue-statement', { method: 'POST', body: form })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? '유치원 거래명세표 ZIP을 만들지 못했습니다.')
        return
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = fileNameOf(res.headers.get('Content-Disposition')) ??
        `${period}_유치원_거래명세표_전체.zip`
      a.click()
      URL.revokeObjectURL(href)
    } catch (e) {
      setError(e instanceof Error ? e.message : '거래명세표 ZIP 다운로드 중 오류가 발생했습니다.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6">
      <h2 className="font-semibold text-gray-900">산출물 다시 받기</h2>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        <strong className="font-medium text-gray-700">확정한 그 시점의 값</strong>으로
        만듭니다. 원천 파일을 다시 올릴 필요가 없고, 나중에 담당자나 수수료율이 바뀌어도
        같은 파일이 나옵니다.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void download('taxable')}
          disabled={busy !== null || taxableCount === 0}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'taxable' ? '생성 중…' : `세금계산서 ${taxableCount}장`}
        </button>
        <button
          type="button"
          onClick={() => void download('exempt')}
          disabled={busy !== null || exemptCount === 0}
          className="rounded-lg border border-gray-900 px-4 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'exempt' ? '생성 중…' : `계산서 ${exemptCount}장`}
        </button>
        <button
          type="button"
          onClick={() => void download('report')}
          disabled={busy !== null}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'report' ? '생성 중…' : '정산 내역서'}
        </button>
        <button
          type="button"
          onClick={() => void download('partner-all')}
          disabled={busy !== null || partners.length === 0}
          className="rounded-lg border border-teal-600 px-4 py-2 text-sm font-medium text-teal-800 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'partner-all' ? '생성 중…' : `파트너 정산서 ZIP (${partners.length}명)`}
        </button>
      </div>

      {partners.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {partners.map((partner) => (
            <button
              key={partner.partnerId}
              type="button"
              onClick={() => void download(`partner:${partner.partnerId}`)}
              disabled={busy !== null}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === `partner:${partner.partnerId}` ? '생성 중…' : partner.partnerName}
            </button>
          ))}
        </div>
      )}

      {statementVenues.length > 0 && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-600">유치원 거래명세표</p>
          <button
            type="button"
            onClick={() => void downloadAllVenues()}
            disabled={busy !== null}
            className="mt-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'venue-all'
              ? 'ZIP 생성 중…'
              : `유치원 거래명세표 ZIP (${statementVenues.length}곳)`}
          </button>
          <p className="mt-1 text-xs text-gray-500">
            유치원별 엑셀은 각각 분리된 상태로 ZIP 파일 하나에 담깁니다.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {statementVenues.map((venue) => {
              const key = `venue:${venue.source}:${venue.businessCode}` as const
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void downloadVenue(venue)}
                  disabled={busy !== null}
                  className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                >
                  {busy === key ? '생성 중…' : `${venue.businessName} (${venue.source === 'cj' ? 'CJ' : '신세계'})`}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-400">
        관리자 내역서에는 <span className="font-medium text-gray-600">집계표_정산용</span> ·{' '}
        <span className="font-medium text-gray-600">사업자공제 상세</span> ·{' '}
        <span className="font-medium text-gray-600">사업소득 신고내역</span> 시트가 함께
        들어 있고, 해당 데이터가 있으면 조정·외부 사입 상세가 추가됩니다. 지급명세서의
        주민번호 칸은 비어 있습니다.
        <br />파트너 정산서는 요약·유치원별 상세·공제 근거만 담은 독립 파일입니다.
        <br />유치원 거래명세표는 마감 리비전과 보관 원천의 청구 합계가 일치할 때만
        다시 생성됩니다. 전체 ZIP과 유치원별 개별 파일을 모두 받을 수 있습니다.
      </p>
    </section>
  )
}

/** `attachment; filename*=UTF-8''...` 에서 파일명을 꺼낸다 */
function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return null
  }
}

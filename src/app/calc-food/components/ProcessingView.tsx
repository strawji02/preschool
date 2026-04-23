'use client'

/**
 * 명세서 처리 진행률 UI (2026-04-24)
 *
 * 기능:
 * - 경과 시간 (mm:ss) 실시간 갱신
 * - 예상 남은 시간 — 초반엔 페이지당 15s 기본 추정, 진행하며 실측 평균으로 보정
 * - 재시도 라운드 표시 (1차/재시도 N라운드)
 * - 무료 Gemini 티어 기준 14장 평균 3~8분 예상
 */
import { useEffect, useState } from 'react'
import { FileText, Loader2, Clock, RotateCcw } from 'lucide-react'

interface ProcessingViewProps {
  fileName: string
  currentPage: number
  totalPages: number
  startedAt: number | null     // epoch ms — 업로드 시작 시각
  retryRound?: number           // 0=1차, 1+=재시도 라운드
  failedPages?: number          // 재시도 중인 페이지 수
}

const DEFAULT_SEC_PER_PAGE = 15   // 순차 + 5s 간격 + OCR/매칭 감안한 초기 추정

function formatDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '-'
  const mm = Math.floor(totalSec / 60)
  const ss = Math.floor(totalSec % 60)
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function ProcessingView({
  fileName,
  currentPage,
  totalPages,
  startedAt,
  retryRound = 0,
  failedPages = 0,
}: ProcessingViewProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0
  const elapsedSec = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0

  // 예상 남은 시간: 실측 평균으로 보정 (최소 2페이지 완료 후)
  let secPerPage = DEFAULT_SEC_PER_PAGE
  if (retryRound === 0 && currentPage >= 2 && elapsedSec > 0) {
    secPerPage = elapsedSec / currentPage
  }
  const remainingPages = Math.max(0, totalPages - currentPage)
  const estimatedRemainingSec = remainingPages * secPerPage

  const isRetrying = retryRound > 0

  return (
    <div className="flex min-h-[calc(100vh-200px)] flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="relative mb-6">
            <div className="rounded-full bg-blue-100 p-6">
              {isRetrying ? (
                <RotateCcw size={48} className="text-amber-600" />
              ) : (
                <FileText size={48} className="text-blue-600" />
              )}
            </div>
            <div className="absolute -bottom-1 -right-1 rounded-full bg-white p-1">
              <Loader2 size={24} className="animate-spin text-blue-600" />
            </div>
          </div>

          <h3 className="mb-2 text-xl font-semibold text-gray-900">
            {isRetrying
              ? `실패 페이지 재시도 중 (${retryRound}차)`
              : '명세서 분석 중'}
          </h3>
          <p className="max-w-full truncate text-center text-gray-500" title={fileName}>
            {fileName}
          </p>
          {isRetrying && (
            <p className="mt-1 text-xs text-amber-700">
              Gemini API rate limit 회복을 기다린 후 {failedPages}개 페이지 재처리 중
            </p>
          )}
        </div>

        <div className="mb-4">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-gray-600">
              {currentPage} / {totalPages} 페이지
            </span>
            <span className="font-medium text-blue-600">{progress}%</span>
          </div>

          <div className="h-3 overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isRetrying ? 'bg-amber-500' : 'bg-blue-600'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* 시간 정보 — 경과 / 예상 남은 시간 */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
            <div className="mb-1 flex items-center justify-center gap-1 text-[11px] text-gray-500">
              <Clock size={12} />
              <span>경과 시간</span>
            </div>
            <div className="text-lg font-semibold text-gray-900">
              {formatDuration(elapsedSec)}
            </div>
          </div>
          <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
            <div className="mb-1 flex items-center justify-center gap-1 text-[11px] text-gray-500">
              <Clock size={12} />
              <span>남은 시간 (예상)</span>
            </div>
            <div className="text-lg font-semibold text-gray-900">
              {remainingPages > 0 ? `약 ${formatDuration(estimatedRemainingSec)}` : '마무리 중'}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-500">
          AI가 명세서의 품목과 단가를 분석하고 있습니다
          <br />
          <span className="text-gray-400">
            Gemini 무료 티어 rate limit 회피를 위해 페이지당 5초 대기
          </span>
        </p>
      </div>
    </div>
  )
}

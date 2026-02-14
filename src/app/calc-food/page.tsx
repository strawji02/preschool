'use client'

import dynamic from 'next/dynamic'
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useAuditSession } from './hooks/useAuditSession'

// SSR 비활성화 - PDF.js가 클라이언트에서만 동작
const UploadZone = dynamic(() => import('./components/UploadZone').then(mod => ({ default: mod.UploadZone })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

const ProcessingView = dynamic(() => import('./components/ProcessingView').then(mod => ({ default: mod.ProcessingView })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

const AnalysisDashboard = dynamic(() => import('./components/AnalysisDashboard').then(mod => ({ default: mod.AnalysisDashboard })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

const SplitView = dynamic(() => import('./components/SplitView').then(mod => ({ default: mod.SplitView })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

function LoadingFallback() {
  return (
    <div className="flex min-h-[calc(100vh-200px)] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
    </div>
  )
}

export default function CalcFoodPage() {
  const {
    state,
    processFiles,
    setCurrentPage,
    updateItemMatch,
    reset,
    // 2-Step Workflow
    selectCandidate,
    confirmItem,
    confirmAllAutoMatched,
    proceedToReport,
    backToMatching,
    scenarios,
    confirmationStats,
    // 재분석
    reanalyze,
    isReanalyzing,
  } = useAuditSession()

  return (
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 */}
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft size={20} />
              <span>홈으로</span>
            </Link>

            <div className="h-6 w-px bg-gray-300" />

            <h1 className="text-lg font-semibold text-gray-900">식자재 단가 비교</h1>

            {/* 현재 단계 표시 */}
            {state.status === 'analysis' && (
              <>
                <div className="h-6 w-px bg-gray-300" />
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-sm font-medium ${
                    state.currentStep === 'matching'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {state.currentStep === 'matching' ? '1. 매칭 확인' : '2. 리포트'}
                  </span>
                </div>
              </>
            )}
          </div>

          {state.status !== 'empty' && (
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <RefreshCw size={16} />
              새로 시작
            </button>
          )}
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main>
        {state.status === 'empty' && <UploadZone onFileSelect={processFiles} />}

        {state.status === 'processing' && (
          <ProcessingView
            fileName={state.fileName || ''}
            currentPage={state.processingPage}
            totalPages={state.totalPages}
          />
        )}

        {/* 매칭 단계: SplitView 사용 */}
        {state.status === 'analysis' && state.currentStep === 'matching' && (
          <div className="h-[calc(100vh-64px)]">
            <SplitView
              items={state.items}
              pages={state.pages}
              supplierName={state.supplierName || '업체'}
              onSelectCandidate={selectCandidate}
              onConfirmItem={confirmItem}
              onConfirmAllAutoMatched={confirmAllAutoMatched}
              onProceedToReport={proceedToReport}
            />
          </div>
        )}

        {/* 리포트 단계: AnalysisDashboard 사용 */}
        {state.status === 'analysis' && state.currentStep === 'report' && (
          <AnalysisDashboard
            currentStep={state.currentStep}
            pages={state.pages}
            currentPage={state.currentPage}
            onPageSelect={setCurrentPage}
            items={state.items}
            fileName={state.fileName || '명세서'}
            confirmationStats={confirmationStats}
            totalPages={state.totalPages}
            scenarios={scenarios}
            // Matching step callbacks
            onSelectCandidate={selectCandidate}
            onConfirmItem={confirmItem}
            onConfirmAllAutoMatched={confirmAllAutoMatched}
            onProceedToReport={proceedToReport}
            onItemMatchUpdate={updateItemMatch}
            onReanalyze={reanalyze}
            isReanalyzing={isReanalyzing}
            // Report step callbacks
            onBackToMatching={backToMatching}
          />
        )}

        {state.status === 'error' && (
          <div className="flex min-h-[calc(100vh-200px)] flex-col items-center justify-center p-8">
            <div className="rounded-lg bg-red-50 p-8 text-center">
              <h3 className="mb-2 text-lg font-semibold text-red-900">오류가 발생했습니다</h3>
              <p className="mb-4 text-red-600">{state.error}</p>
              <button
                onClick={reset}
                className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
              >
                다시 시도
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

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

const PrecisionMatchingView = dynamic(
  () =>
    import('./components/PrecisionMatchingView').then((mod) => ({
      default: mod.PrecisionMatchingView,
    })),
  {
    ssr: false,
    loading: () => <LoadingFallback />,
  },
)

const ExcelPreview = dynamic(() => import('./components/ExcelPreview').then(mod => ({ default: mod.ExcelPreview })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

const ImagePreview = dynamic(() => import('./components/ImagePreview').then(mod => ({ default: mod.ImagePreview })), {
  ssr: false,
  loading: () => <LoadingFallback />,
})

const SessionList = dynamic(() => import('./components/SessionList').then(mod => ({ default: mod.SessionList })), {
  ssr: false,
  loading: () => null,
})

const WorkflowStepper = dynamic(() => import('./components/WorkflowStepper').then(mod => ({ default: mod.WorkflowStepper })), {
  ssr: false,
  loading: () => null,
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
    autoExcludeUnmatched,
    proceedToReport,
    backToMatching,
    scenarios,
    confirmationStats,
    // 재분석
    reanalyze,
    isReanalyzing,
    // 엑셀 담당자 확인 (2026-04-21 추가)
    confirmAndAnalyzeExcel,
    updateExcelPreviewItem,
    removeExcelPreviewItem,
    updateExcelPreviewSupplier,
    clearExcelPreview,
    // 비교 제외 / 업체명 수정 (2026-04-21)
    toggleExclude,
    updateSupplierName,
    // PDF/이미지 담당자 확인 (2026-04-23)
    confirmImagePreview,
    // 세션 저장/이어가기/추가 업로드 (2026-04-26)
    loadSession,
    extendSession,
    replacePage,
    // Phase 1 검수 단계 (2026-04-26): 행 수정/삭제/추가, OCR 합계 수정
    updateItem,
    removeItem,
    addItem,
    updatePageOcrTotal,
    // Phase 2 페이지별 검수 완료 토글 (2026-04-26)
    togglePageReviewed,
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

            <h1 className="text-lg font-semibold text-gray-900">
              식자재 단가 비교
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({process.env.NEXT_PUBLIC_BUILD_TIME || '빌드 시간'})
              </span>
            </h1>
            {/* Phase 2: 단계 표시는 WorkflowStepper로 이동 */}
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

      {/* 검수 워크플로우 단계 표시 (2026-04-26) */}
      <WorkflowStepper status={state.status} currentStep={state.currentStep} />

      {/* 메인 콘텐츠 */}
      <main>
        {state.status === 'empty' && (
          <>
            <UploadZone onFileSelect={processFiles} />
            <SessionList onSelect={loadSession} />
          </>
        )}

        {/* 엑셀 담당자 확인 단계 (2026-04-21 추가) */}
        {state.status === 'excel_preview' && state.excelPreview && (
          <ExcelPreview
            preview={state.excelPreview}
            onSupplierNameChange={updateExcelPreviewSupplier}
            onItemChange={updateExcelPreviewItem}
            onItemRemove={removeExcelPreviewItem}
            onCancel={clearExcelPreview}
            onConfirm={confirmAndAnalyzeExcel}
          />
        )}

        {/* PDF/이미지 담당자 확인 단계 (2026-04-23 추가) */}
        {state.status === 'image_preview' && (
          <ImagePreview
            items={state.items}
            fileName={state.fileName || ''}
            supplierName={state.supplierName || '업체'}
            pageTotals={state.pageTotals}
            pageSourceFiles={state.pageSourceFiles}
            totalPages={state.totalPages}
            sessionId={state.sessionId}
            pages={state.pages}
            onSupplierNameChange={updateSupplierName}
            onCancel={reset}
            onConfirm={confirmImagePreview}
            onExtendUpload={extendSession}
            onUpdateItem={updateItem}
            onRemoveItem={removeItem}
            onAddItem={addItem}
            onUpdatePageOcrTotal={updatePageOcrTotal}
            onTogglePageReviewed={togglePageReviewed}
            onReplacePage={replacePage}
          />
        )}

        {state.status === 'processing' && (
          <ProcessingView
            fileName={state.fileName || ''}
            currentPage={state.processingPage}
            totalPages={state.totalPages}
            startedAt={state.processingStartedAt}
            retryRound={state.processingRetryRound}
            failedPages={state.processingFailedPages}
          />
        )}

        {/* 매칭 단계: PrecisionMatchingView (3분할 풀스크린, 2026-05-04) */}
        {state.status === 'analysis' && state.currentStep === 'matching' && (
          <div className="h-[calc(100vh-64px)]">
            <PrecisionMatchingView
              items={state.items}
              pages={state.pages}
              supplierName={state.supplierName || '업체'}
              onSelectCandidate={selectCandidate}
              onConfirmItem={confirmItem}
              onConfirmAllAutoMatched={confirmAllAutoMatched}
              onAutoExcludeUnmatched={autoExcludeUnmatched}
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
            supplierName={state.supplierName}
            onToggleExclude={toggleExclude}
            onUpdateSupplierName={updateSupplierName}
            sessionId={state.sessionId}
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

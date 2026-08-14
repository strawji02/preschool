'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { ArrowLeft, RefreshCw, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { COMPARISON_VERSION } from '@/features/shared/version'
import { useAuditSession } from './hooks/useAuditSession'
import { SessionScopeProvider } from './hooks/useSessionScope'
import { PriceBookPeriodPicker, formatPeriodLabel } from './components/PriceBookPeriodPicker'
import { InvoiceReviewModal } from './components/InvoiceReviewModal'

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
    // 신세계 단가 기준월 (comparison.md §9)
    priceBookPeriod,
    setPriceBookPeriod,
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
    resolveConflict,
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

  // 거래명세표 재확인/수정 모달 (매칭/보고서 단계에서 사용)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

  return (
    /*
      세션 id를 화면 전체가 공유한다 (comparison.md §9). 품목 검색·상세 API가
      **세션 기준월 단가**로 답해야 하는데, 그 API를 부르는 자리가 6곳에
      흩어져 있고 어느 것도 세션 id를 받지 않는다.
    */
    <SessionScopeProvider sessionId={state.sessionId}>
    <div className="min-h-screen bg-gray-100">
      {/* 헤더 — PDF/인쇄 시 숨김 (제안서 본문만 출력되도록) */}
      <header className="bg-white shadow-sm print:hidden">
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
              {/*
                ⚠️ 예전에는 `NEXT_PUBLIC_BUILD_TIME`(빌드 시각)을 찍었다. 정산만
                고쳐서 배포해도 이 값이 바뀌어, 비교 시스템 사용자에게 "뭐가
                바뀌었나?" 하고 찾아보게 만드는 거짓 신호였다.
                이제 **비교 시스템이 마지막으로 바뀐 시각**을 쓴다 (docs §16).
              */}
              <span
                className="ml-2 text-xs font-normal tabular-nums text-gray-400"
                title={`커밋 ${COMPARISON_VERSION.sha}`}
              >
                {COMPARISON_VERSION.version} · {COMPARISON_VERSION.at} 배포
              </span>
            </h1>
            {/* Phase 2: 단계 표시는 WorkflowStepper로 이동 */}

            {/*
              ★ 진행 중에는 **바꿀 수 없다** (comparison.md §9). 매칭이 이미 그 달
              단가로 후보를 저장했으므로, 지금 바꿔도 계산된 절감액은 안 바뀐다.
              그런데도 고를 수 있게 두면 "바꿨는데 왜 그대로냐"가 된다.
            */}
            {state.status !== 'empty' && (
              <div
                className="flex items-center gap-1.5 rounded-md bg-gray-100 px-2.5 py-1 text-xs text-gray-600"
                title={
                  priceBookPeriod
                    ? `${priceBookPeriod} 신세계 단가표로 비교합니다 (세션 시작 시 확정)`
                    : 'products 테이블 단가로 비교합니다 — 2026-05-09 이후 갱신되지 않았습니다'
                }
              >
                <span className="text-gray-400">단가 기준</span>
                <span className="font-medium">
                  {priceBookPeriod ? formatPeriodLabel(priceBookPeriod) : '신세계 DB'}
                </span>
              </div>
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

      {/* 검수 워크플로우 단계 표시 (2026-04-26) — PDF/인쇄 시 숨김 */}
      <div className="print:hidden">
        <WorkflowStepper status={state.status} currentStep={state.currentStep} />
      </div>

      {/* 메인 콘텐츠 */}
      <main>
        {state.status === 'empty' && (
          <>
            {/*
              ★ **업로드 앞에** 고른다 (comparison.md §9). 매칭이 시작되면 후보
              단가가 그때 값으로 저장되므로, 뒤에서 바꿔도 이미 계산된 절감액은
              바뀌지 않는다.
            */}
            <div className="px-4 pt-4">
              <PriceBookPeriodPicker value={priceBookPeriod} onChange={setPriceBookPeriod} />
            </div>
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
              sessionId={state.sessionId ?? undefined}
              onSelectCandidate={selectCandidate}
              onConfirmItem={confirmItem}
              onConfirmAllAutoMatched={confirmAllAutoMatched}
              onAutoExcludeUnmatched={autoExcludeUnmatched}
              onProceedToReport={proceedToReport}
              onToggleExclude={toggleExclude}
              onResolveConflict={resolveConflict}
              onReload={() => state.sessionId && loadSession(state.sessionId)}
              onOpenInvoiceReview={() => setInvoiceModalOpen(true)}
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
            onOpenInvoiceReview={() => setInvoiceModalOpen(true)}
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

      {/* 거래명세표 재확인/수정 모달 (2026-05-10) — 매칭/보고서 단계에서 트리거 */}
      <InvoiceReviewModal
        isOpen={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        items={state.items}
        fileName={state.fileName || ''}
        supplierName={state.supplierName || '업체'}
        pageTotals={state.pageTotals}
        pageSourceFiles={state.pageSourceFiles}
        totalPages={state.totalPages}
        sessionId={state.sessionId}
        pages={state.pages}
        onSupplierNameChange={updateSupplierName}
        onUpdateItem={updateItem}
        onRemoveItem={removeItem}
        onAddItem={addItem}
        onUpdatePageOcrTotal={updatePageOcrTotal}
        onTogglePageReviewed={togglePageReviewed}
        onReplacePage={replacePage}
        onExtendUpload={extendSession}
      />
    </div>
    </SessionScopeProvider>
  )
}

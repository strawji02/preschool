'use client'

import type { ComparisonItem, MatchCandidate, Supplier, SupplierMatch, SupplierScenario } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import type { AnalysisStep } from '../hooks/useAuditSession'
import { MatchingView } from './MatchingStep'
import { ReportView } from './ReportStep'

interface AnalysisDashboardProps {
  currentStep: AnalysisStep
  pages: PageImage[]
  currentPage: number
  onPageSelect: (page: number) => void
  items: ComparisonItem[]
  fileName: string
  confirmationStats: {
    total: number
    confirmed: number
    unconfirmed: number
  }
  totalPages: number
  scenarios: {
    cj: SupplierScenario
    ssg: SupplierScenario
  }
  // Matching step callbacks
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirmItem: (itemId: string) => void
  onConfirmAllAutoMatched: () => void
  onProceedToReport: () => void
  onItemMatchUpdate: (itemId: string, product: MatchCandidate, supplier: Supplier) => void
  onReanalyze?: (pageNumber: number) => void
  isReanalyzing?: boolean
  // Report step callbacks
  onBackToMatching: () => void
  // 2026-04-21: 비교 제외, 업체명 수정
  supplierName?: string | null
  onToggleExclude?: (itemId: string, reason?: string) => void
  onUpdateSupplierName?: (name: string) => void
  // 제안서 모드 (2026-04-27)
  sessionId?: string | null
  /** 거래명세표 재확인/수정 모달 트리거 (2026-05-10) */
  onOpenInvoiceReview?: () => void
}

export function AnalysisDashboard({
  currentStep,
  pages,
  currentPage,
  onPageSelect,
  items,
  fileName,
  confirmationStats,
  totalPages,
  scenarios,
  onSelectCandidate,
  onConfirmItem,
  onConfirmAllAutoMatched,
  onProceedToReport,
  onItemMatchUpdate,
  onReanalyze,
  isReanalyzing,
  onBackToMatching,
  supplierName,
  onToggleExclude,
  onUpdateSupplierName,
  sessionId,
  onOpenInvoiceReview,
}: AnalysisDashboardProps) {
  if (currentStep === 'matching') {
    return (
      <MatchingView
        pages={pages}
        currentPage={currentPage}
        onPageSelect={onPageSelect}
        items={items}
        fileName={fileName}
        confirmationStats={confirmationStats}
        totalPages={totalPages}
        onSelectCandidate={onSelectCandidate}
        onConfirmItem={onConfirmItem}
        onConfirmAllAutoMatched={onConfirmAllAutoMatched}
        onProceedToReport={onProceedToReport}
        onItemMatchUpdate={onItemMatchUpdate}
        onReanalyze={onReanalyze}
        isReanalyzing={isReanalyzing}
      />
    )
  }

  return (
    <ReportView
      pages={pages}
      currentPage={currentPage}
      onPageSelect={onPageSelect}
      items={items}
      fileName={fileName}
      supplierName={supplierName}
      scenarios={scenarios}
      onBackToMatching={onBackToMatching}
      onToggleExclude={onToggleExclude}
      onUpdateSupplierName={onUpdateSupplierName}
      sessionId={sessionId}
      onOpenInvoiceReview={onOpenInvoiceReview}
    />
  )
}

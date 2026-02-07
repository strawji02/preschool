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
}

export function AnalysisDashboard({
  currentStep,
  pages,
  currentPage,
  onPageSelect,
  items,
  fileName,
  confirmationStats,
  scenarios,
  onSelectCandidate,
  onConfirmItem,
  onConfirmAllAutoMatched,
  onProceedToReport,
  onItemMatchUpdate,
  onReanalyze,
  isReanalyzing,
  onBackToMatching,
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
      scenarios={scenarios}
      onBackToMatching={onBackToMatching}
    />
  )
}

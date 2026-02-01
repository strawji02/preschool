'use client'

import { useState } from 'react'
import type { ComparisonItem, MatchCandidate, Supplier } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import type { SessionStats } from '../hooks/useAuditSession'
import { InvoiceViewer } from './InvoiceViewer'
import { SummaryHeader } from './SummaryHeader'
import { AnalysisGrid } from './AnalysisGrid'
import { ProductSearchModal } from './ProductSearchModal'

interface AnalysisDashboardProps {
  pages: PageImage[]
  currentPage: number
  onPageSelect: (page: number) => void
  items: ComparisonItem[]
  stats: SessionStats
  fileName: string
  onItemMatchUpdate: (itemId: string, product: MatchCandidate, supplier: Supplier) => void
}

export function AnalysisDashboard({
  pages,
  currentPage,
  onPageSelect,
  items,
  stats,
  fileName,
  onItemMatchUpdate,
}: AnalysisDashboardProps) {
  const [searchItem, setSearchItem] = useState<ComparisonItem | null>(null)
  const [searchSupplier, setSearchSupplier] = useState<Supplier | undefined>(undefined)

  const handleSearchClick = (item: ComparisonItem, supplier: Supplier) => {
    setSearchItem(item)
    setSearchSupplier(supplier)
  }

  const handleProductSelect = (itemId: string, product: MatchCandidate, supplier: Supplier) => {
    onItemMatchUpdate(itemId, product, supplier)
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* 좌측: 이미지 뷰어 (50%) */}
      <div className="w-1/2 border-r">
        <InvoiceViewer pages={pages} currentPage={currentPage} onPageSelect={onPageSelect} />
      </div>

      {/* 우측: 분석 결과 (50%) */}
      <div className="flex w-1/2 flex-col">
        <SummaryHeader stats={stats} fileName={fileName} />
        <div className="flex-1 overflow-hidden">
          <AnalysisGrid items={items} onSearchClick={handleSearchClick} />
        </div>
      </div>

      {/* 검색 모달 */}
      {searchItem && (
        <ProductSearchModal
          item={searchItem}
          initialSupplier={searchSupplier}
          isOpen={!!searchItem}
          onClose={() => {
            setSearchItem(null)
            setSearchSupplier(undefined)
          }}
          onSelect={handleProductSelect}
        />
      )}
    </div>
  )
}

'use client'

import { useState } from 'react'
import type { ComparisonItem, MatchCandidate, Supplier, SupplierMatch } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import { InvoiceViewer } from '../InvoiceViewer'
import { ProductSearchModal } from '../ProductSearchModal'
import { MatchingHeader } from './MatchingHeader'
import { MatchingGrid } from './MatchingGrid'

interface MatchingViewProps {
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
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirmItem: (itemId: string) => void
  onConfirmAllAutoMatched: () => void
  onProceedToReport: () => void
  onItemMatchUpdate: (itemId: string, product: MatchCandidate, supplier: Supplier) => void
  onReanalyze?: (pageNumber: number) => void
  isReanalyzing?: boolean
}

export function MatchingView({
  pages,
  currentPage,
  onPageSelect,
  items,
  fileName,
  confirmationStats,
  totalPages,
  onSelectCandidate,
  onConfirmItem,
  onConfirmAllAutoMatched,
  onProceedToReport,
  onItemMatchUpdate,
  onReanalyze,
  isReanalyzing,
}: MatchingViewProps) {
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
        <InvoiceViewer
          pages={pages}
          currentPage={currentPage}
          onPageSelect={onPageSelect}
          onReanalyze={onReanalyze}
          isReanalyzing={isReanalyzing}
        />
      </div>

      {/* 우측: 매칭 그리드 (50%) */}
      <div className="flex w-1/2 flex-col">
        <MatchingHeader
          fileName={fileName}
          confirmationStats={confirmationStats}
          items={items}
          totalPages={totalPages}
          onConfirmAllAutoMatched={onConfirmAllAutoMatched}
          onProceedToReport={onProceedToReport}
        />
        <div className="flex-1 overflow-hidden">
          <MatchingGrid
            items={items}
            onSelectCandidate={onSelectCandidate}
            onConfirm={onConfirmItem}
            onSearchClick={handleSearchClick}
          />
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

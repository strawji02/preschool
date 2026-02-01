'use client'

import { useState } from 'react'
import type { AuditItemResponse, MatchCandidate } from '@/types/audit'
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
  items: AuditItemResponse[]
  stats: SessionStats
  fileName: string
  onItemUpdate: (itemId: string, updates: Partial<AuditItemResponse>) => void
}

export function AnalysisDashboard({
  pages,
  currentPage,
  onPageSelect,
  items,
  stats,
  fileName,
  onItemUpdate,
}: AnalysisDashboardProps) {
  const [searchItem, setSearchItem] = useState<AuditItemResponse | null>(null)

  const handleSearchClick = (item: AuditItemResponse) => {
    setSearchItem(item)
  }

  const handleProductSelect = (itemId: string, product: MatchCandidate) => {
    onItemUpdate(itemId, {
      matched_product: {
        id: product.id,
        product_name: product.product_name,
        standard_price: product.standard_price,
        supplier: product.supplier,
      },
      match_status: 'manual_matched',
      match_score: product.match_score,
      loss_amount: Math.max(0, items.find(i => i.id === itemId)!.extracted_unit_price - product.standard_price) * items.find(i => i.id === itemId)!.extracted_quantity,
    })
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
          isOpen={!!searchItem}
          onClose={() => setSearchItem(null)}
          onSelect={handleProductSelect}
        />
      )}
    </div>
  )
}

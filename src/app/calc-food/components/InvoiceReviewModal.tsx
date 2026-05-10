'use client'

/**
 * 거래명세표 재확인/수정 모달 (2026-05-10)
 *
 * 매칭/보고서 단계에서 검수자가 명세표를 다시 확인하거나 수정할 수 있도록 함.
 * ImagePreview 컴포넌트를 그대로 모달 안에 띄움 — 검수 중 사용한 동일한 화면.
 *
 * 변경 가능 항목:
 *  - 행 수정/추가/삭제 (onUpdateItem/onAddItem/onRemoveItem)
 *  - 페이지 OCR 합계 수정 (onUpdatePageOcrTotal)
 *  - 페이지 검수 완료 토글 (onTogglePageReviewed)
 *  - 페이지 재촬영 (onReplacePage)
 *
 * 닫기:
 *  - 우상단 X 버튼
 *  - ESC 키
 *  - 오버레이 클릭
 *  - ImagePreview의 onConfirm/onCancel 모두 모달 닫기로 매핑
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { ImagePreview } from './ImagePreview'
import type { ComparisonItem } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import type { PageTotal } from '../hooks/useAuditSession'

interface InvoiceReviewModalProps {
  isOpen: boolean
  onClose: () => void
  // ImagePreview에 전달할 데이터
  items: ComparisonItem[]
  fileName: string
  supplierName: string
  pageTotals: PageTotal[]
  pageSourceFiles: string[]
  totalPages: number
  sessionId?: string | null
  pages?: PageImage[]
  // 콜백
  onSupplierNameChange: (name: string) => void
  onUpdateItem?: (itemId: string, patch: Partial<ComparisonItem>) => void
  onRemoveItem?: (itemId: string) => void
  onAddItem?: Parameters<typeof ImagePreview>[0]['onAddItem']
  onUpdatePageOcrTotal?: (pageNumber: number, ocrTotal: number | null) => void
  onTogglePageReviewed?: (pageNumber: number) => void
  onReplacePage?: (pageNumber: number, file: File) => Promise<void> | void
  onExtendUpload?: (files: File[]) => void
}

export function InvoiceReviewModal({
  isOpen,
  onClose,
  items,
  fileName,
  supplierName,
  pageTotals,
  pageSourceFiles,
  totalPages,
  sessionId,
  pages,
  onSupplierNameChange,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  onUpdatePageOcrTotal,
  onTogglePageReviewed,
  onReplacePage,
  onExtendUpload,
}: InvoiceReviewModalProps) {
  // ESC 키로 닫기
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    // body scroll 잠금
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      {/* 오버레이 클릭 시 닫기 */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* 모달 본체 */}
      <div className="relative flex max-h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl bg-gray-100 shadow-2xl">
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between border-b bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-gray-900">📄 거래명세표 재확인 · 수정</h2>
            <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-800">
              수정 시 매칭 결과에 영향
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            title="닫기 (ESC)"
          >
            <X size={16} /> 닫기
          </button>
        </div>

        {/* ImagePreview 본체 — 스크롤 가능 */}
        <div className="flex-1 overflow-y-auto bg-gray-100">
          <ImagePreview
            items={items}
            fileName={fileName}
            supplierName={supplierName}
            pageTotals={pageTotals}
            pageSourceFiles={pageSourceFiles}
            totalPages={totalPages}
            sessionId={sessionId}
            pages={pages}
            onSupplierNameChange={onSupplierNameChange}
            onCancel={onClose}
            onConfirm={onClose}
            onExtendUpload={onExtendUpload}
            onUpdateItem={onUpdateItem}
            onRemoveItem={onRemoveItem}
            onAddItem={onAddItem}
            onUpdatePageOcrTotal={onUpdatePageOcrTotal}
            onTogglePageReviewed={onTogglePageReviewed}
            onReplacePage={onReplacePage}
          />
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ComparisonItem, SupplierMatch, Supplier } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import type { PanelFocus, ProgressStatus } from './types'
import { InvoicePanel } from './InvoicePanel'
import { SearchPanel } from './SearchPanel'
import { ProgressBar } from './ProgressBar'
import { PdfModal } from './PdfModal'

interface SplitViewProps {
  items: ComparisonItem[]
  pages?: PageImage[] // PDF 페이지 이미지 (선택적)
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirmItem: (itemId: string) => void
  onConfirmAllAutoMatched: () => void
  onProceedToReport: () => void
}

export function SplitView({
  items,
  pages = [],
  onSelectCandidate,
  onConfirmItem,
  onConfirmAllAutoMatched,
  onProceedToReport,
}: SplitViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [focusedPanel, setFocusedPanel] = useState<PanelFocus>('left')
  const [selectedResultIndex, setSelectedResultIndex] = useState(0)
  
  // PDF 모달 상태
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false)
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1)
  const [pdfViewItemIndex, setPdfViewItemIndex] = useState<number | null>(null)

  // 현재 선택된 품목
  const currentItem = items[selectedIndex] || null

  // 진행 상태 계산
  const progressStatus: ProgressStatus = {
    total: items.length,
    completed: items.filter(i => i.is_confirmed).length,
    autoConfirmed: items.filter(i => i.is_confirmed && i.match_status === 'auto_matched').length,
    manualReview: items.filter(i => !i.is_confirmed && i.match_status === 'pending').length,
  }

  // 다음 미확정 항목으로 이동
  const moveToNextUnconfirmed = useCallback(() => {
    const nextIndex = items.findIndex((item, idx) => idx > selectedIndex && !item.is_confirmed)
    if (nextIndex !== -1) {
      setSelectedIndex(nextIndex)
    } else {
      // 처음부터 다시 검색
      const firstUnconfirmed = items.findIndex(item => !item.is_confirmed)
      if (firstUnconfirmed !== -1 && firstUnconfirmed !== selectedIndex) {
        setSelectedIndex(firstUnconfirmed)
      }
    }
  }, [items, selectedIndex])

  // 상품 선택 핸들러 (선택만, 확정은 별도)
  const handleSelectProduct = useCallback((product: SupplierMatch) => {
    if (!currentItem) return
    onSelectCandidate(currentItem.id, 'CJ', product)
  }, [currentItem, onSelectCandidate])

  // 현재 품목 확정 핸들러
  const handleConfirmCurrentItem = useCallback(() => {
    if (!currentItem) return
    onConfirmItem(currentItem.id)
    moveToNextUnconfirmed()
  }, [currentItem, onConfirmItem, moveToNextUnconfirmed])

  // PDF 보기 핸들러
  const handleViewPdf = useCallback((itemIndex: number) => {
    if (pages.length === 0) return
    setPdfViewItemIndex(itemIndex)
    // 해당 아이템의 페이지 번호 찾기 (페이지 정보가 있다면)
    // 기본적으로 첫 페이지 표시
    setPdfCurrentPage(1)
    setIsPdfModalOpen(true)
  }, [pages.length])

  // 키보드 이벤트 핸들러
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 필드에서는 일부 단축키 무시
      const isInputFocused = document.activeElement?.tagName === 'INPUT'

      // Tab: 패널 전환
      if (e.key === 'Tab') {
        e.preventDefault()
        setFocusedPanel(prev => prev === 'left' ? 'right' : 'left')
        return
      }

      // 좌측 패널 포커스 시
      if (focusedPanel === 'left') {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            setSelectedIndex(prev => Math.max(0, prev - 1))
            break
          case 'ArrowDown':
            e.preventDefault()
            setSelectedIndex(prev => Math.min(items.length - 1, prev + 1))
            break
          case 'Enter':
            e.preventDefault()
            if (currentItem && !currentItem.is_confirmed) {
              onConfirmItem(currentItem.id)
              moveToNextUnconfirmed()
            }
            break
        }
      }

      // 우측 패널 포커스 시 (입력 필드 외부)
      if (focusedPanel === 'right' && !isInputFocused) {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault()
            setSelectedResultIndex(prev => Math.max(0, prev - 1))
            break
          case 'ArrowDown':
            e.preventDefault()
            setSelectedResultIndex(prev => prev + 1)
            break
          case 'Enter':
            e.preventDefault()
            // 선택된 검색 결과 확정 (SearchPanel에서 처리)
            break
        }
      }

      // Esc: 검색어 초기화 (SearchPanel에서 처리)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedPanel, items.length, currentItem, selectedIndex, onConfirmItem, moveToNextUnconfirmed])

  // 모든 자동 매칭 확정 가능 여부
  const hasUnconfirmedAutoMatched = items.some(
    i => !i.is_confirmed && i.match_status === 'auto_matched'
  )

  // 모두 확정 완료 여부
  const allConfirmed = items.every(i => i.is_confirmed)

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* 진행률 표시 */}
      <ProgressBar status={progressStatus} />

      {/* 스플릿 뷰 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 좌측 패널: 거래명세서 (40%) */}
        <div
          className={cn(
            'w-[40%] border-r-2 bg-white transition-all',
            focusedPanel === 'left'
              ? 'border-blue-500'
              : 'border-gray-200'
          )}
          onClick={() => setFocusedPanel('left')}
        >
          <InvoicePanel
            items={items}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            isFocused={focusedPanel === 'left'}
            onViewPdf={pages.length > 0 ? handleViewPdf : undefined}
          />
        </div>

        {/* 우측 패널: CJ 스마트 검색 (60%) */}
        <div
          className={cn(
            'flex-1 bg-white transition-all',
            focusedPanel === 'right'
              ? 'ring-2 ring-inset ring-orange-500'
              : ''
          )}
          onClick={() => setFocusedPanel('right')}
        >
          <SearchPanel
            item={currentItem}
            isFocused={focusedPanel === 'right'}
            onSelectProduct={handleSelectProduct}
            onConfirmItem={handleConfirmCurrentItem}
            selectedResultIndex={selectedResultIndex}
            onSelectResultIndex={setSelectedResultIndex}
          />
        </div>
      </div>

      {/* 하단 액션 바 */}
      <div className="flex items-center justify-between border-t bg-white px-6 py-4">
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <kbd className="rounded bg-gray-100 px-2 py-1 text-xs">↑↓</kbd>
          <span>이동</span>
          <kbd className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs">Tab</kbd>
          <span>패널전환</span>
          <kbd className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs">Enter</kbd>
          <span>확정</span>
          <kbd className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs">Esc</kbd>
          <span>검색초기화</span>
        </div>

        <div className="flex items-center gap-3">
          {/* 자동 매칭 일괄 확정 */}
          {hasUnconfirmedAutoMatched && (
            <button
              onClick={onConfirmAllAutoMatched}
              className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-green-700 hover:bg-green-100"
            >
              <CheckCircle size={18} />
              자동매칭 일괄 확정
            </button>
          )}

          {/* 다음 단계 */}
          <button
            onClick={onProceedToReport}
            disabled={!allConfirmed}
            className={cn(
              'flex items-center gap-2 rounded-lg px-6 py-2 font-medium transition-colors',
              allConfirmed
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'cursor-not-allowed bg-gray-200 text-gray-500'
            )}
          >
            {allConfirmed ? '리포트 생성' : `${progressStatus.total - progressStatus.completed}개 미확정`}
            <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* PDF 모달 */}
      <PdfModal
        isOpen={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        pages={pages}
        currentPage={pdfCurrentPage}
        onPageChange={setPdfCurrentPage}
        highlightRowIndex={pdfViewItemIndex ?? undefined}
      />
    </div>
  )
}

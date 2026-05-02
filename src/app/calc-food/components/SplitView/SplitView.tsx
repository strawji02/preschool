'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { CheckCircle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ComparisonItem, SupplierMatch, Supplier } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import type { PanelFocus, ProgressStatus } from './types'
import { InvoicePanel } from './InvoicePanel'
import { SearchPanel } from './SearchPanel'
import { ProgressBar } from './ProgressBar'
import { PdfModal } from './PdfModal'
import { PrecisionView } from '../PrecisionView'

interface SplitViewProps {
  items: ComparisonItem[]
  pages?: PageImage[] // PDF 페이지 이미지 (선택적)
  supplierName?: string // 파일명에서 추출한 공급업체명
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirmItem: (itemId: string, supplier?: Supplier) => void
  onConfirmAllAutoMatched: () => void
  onAutoExcludeUnmatched?: () => void
  onProceedToReport: () => void
}

export function SplitView({
  items,
  pages = [],
  supplierName = '업체',
  onSelectCandidate,
  onConfirmItem,
  onConfirmAllAutoMatched,
  onAutoExcludeUnmatched,
  onProceedToReport,
}: SplitViewProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [focusedPanel, setFocusedPanel] = useState<PanelFocus>('left')
  const [selectedResultIndex, setSelectedResultIndex] = useState(0)

  // 좌/우 패널 너비 비율 (초기 40% : 60%)
  const [leftPct, setLeftPct] = useState(40)
  const containerRef = useRef<HTMLDivElement>(null)
  const isResizingRef = useRef(false)

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.max(20, Math.min(75, pct)))
    }
    const onUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  
  // PDF 모달 상태
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false)
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1)
  const [pdfViewItemIndex, setPdfViewItemIndex] = useState<number | null>(null)

  // 정밀 검수 모달 상태 (스티치 가이드, 2026-05-04)
  const [precisionItemId, setPrecisionItemId] = useState<string | null>(null)
  const precisionItem = precisionItemId ? items.find((i) => i.id === precisionItemId) ?? null : null

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
  // itemId를 직접 받아서 비동기 문제 방지 (검색 중 아이템 변경 시 잘못된 아이템에 저장되는 버그 수정)
  const handleSelectProduct = useCallback((product: SupplierMatch, supplier: Supplier, itemId: string) => {
    onSelectCandidate(itemId, supplier, product)
  }, [onSelectCandidate])

  // 매칭 제거 핸들러 (변경 버튼) - supplier 파라미터 추가
  const handleClearMatch = useCallback((supplier: Supplier) => {
    if (!currentItem) return
    const emptyMatch: SupplierMatch = {
      id: '',
      product_name: '',
      standard_price: 0,
      match_score: 0,
      unit_normalized: undefined,
      spec_quantity: undefined,
      spec_unit: undefined,
    }
    // 해당 supplier의 매칭만 제거
    onSelectCandidate(currentItem.id, supplier, emptyMatch)
  }, [currentItem, onSelectCandidate])

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
            if (currentItem) {
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

  // 자동 확정 가능 여부: 매칭 후보가 있는 미확정 품목 존재 시
  const hasUnconfirmedAutoMatched = items.some(
    i => !i.is_confirmed && (i.cj_match || i.ssg_match)
  )

  // 매칭 없는 미확정 품목 수 (자동 제외 대상)
  const unmatchedUnconfirmedCount = items.filter(
    i => !i.is_confirmed && !i.cj_match && !i.ssg_match
  ).length

  // 모두 확정 완료 여부
  const allConfirmed = items.every(i => i.is_confirmed)

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* 진행률 표시 */}
      <ProgressBar status={progressStatus} />

      {/* 스플릿 뷰 */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* 좌측 패널: 거래명세서 */}
        <div
          className={cn(
            'border-r bg-white transition-colors overflow-hidden',
            focusedPanel === 'left'
              ? 'border-blue-500'
              : 'border-gray-200'
          )}
          style={{ width: `${leftPct}%`, flexShrink: 0 }}
          onClick={() => setFocusedPanel('left')}
        >
          <InvoicePanel
            items={items}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            isFocused={focusedPanel === 'left'}
            onViewPdf={pages.length > 0 ? handleViewPdf : undefined}
            invoiceSupplierName={supplierName}
          />
        </div>

        {/* 리사이저 핸들 */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={handleResizerMouseDown}
          onDoubleClick={() => setLeftPct(40)}
          className="relative flex w-1 cursor-col-resize items-center justify-center bg-gray-200 hover:bg-blue-400 transition-colors"
          title="드래그로 크기 조정 (더블클릭하면 기본값 복원)"
        >
          {/* 드래그 영역을 넓혀 UX 향상 (시각적 핸들은 좁게) */}
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>

        {/* 우측 패널: 신세계 검색 */}
        <div
          className={cn(
            'flex-1 bg-white transition-all overflow-hidden',
            focusedPanel === 'right'
              ? 'ring-2 ring-inset ring-green-500'
              : ''
          )}
          onClick={() => setFocusedPanel('right')}
        >
          <SearchPanel
            item={currentItem}
            isFocused={focusedPanel === 'right'}
            onSelectProduct={handleSelectProduct}
            onConfirmItem={onConfirmItem}
            onClearMatch={handleClearMatch}
            onMoveToNext={moveToNextUnconfirmed}
            selectedResultIndex={selectedResultIndex}
            onSelectResultIndex={setSelectedResultIndex}
            invoiceSupplierName={supplierName}
            onOpenPrecision={() => currentItem && setPrecisionItemId(currentItem.id)}
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

          {/* 매칭 없는 품목 자동 제외 */}
          {unmatchedUnconfirmedCount > 0 && onAutoExcludeUnmatched && (
            <button
              onClick={onAutoExcludeUnmatched}
              className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-amber-700 hover:bg-amber-100"
              title="매칭 결과 없는 품목을 보고서 비교에서 제외 처리 (별지로 표시)"
            >
              비교 불가 {unmatchedUnconfirmedCount}개 자동 제외
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

      {/* 정밀 검수 모달 (스티치 가이드, 2026-05-04) */}
      {precisionItem && (
        <PrecisionView
          item={precisionItem}
          onClose={() => setPrecisionItemId(null)}
          onSelectCandidate={(candidate) => {
            onSelectCandidate(precisionItem.id, 'SHINSEGAE', candidate)
          }}
          onExclude={() => {
            // 비교 제외는 부모가 처리해야 함 — onAutoExcludeUnmatched는 일괄 처리라
            // 단일 항목 제외는 미구현. 일단 모달 닫기 + 사용자에게 안내.
            window.alert('단일 품목 비교 제외는 보고서 단계의 행 메뉴에서 가능합니다.')
            setPrecisionItemId(null)
          }}
          onConfirm={async (adjustments) => {
            // 1. 조정값 DB 저장 (PATCH /api/audit-items/[id])
            try {
              await fetch(`/api/audit-items/${precisionItem.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  adjusted_quantity: adjustments.adjusted_quantity,
                  adjusted_unit_weight_g: adjustments.adjusted_unit_weight_g,
                  adjusted_pack_unit: adjustments.adjusted_pack_unit,
                  precision_reviewed_at: new Date().toISOString(),
                }),
              })
            } catch (e) {
              console.warn('정밀 검수 조정값 저장 실패:', e)
            }
            // 2. 매칭 확정
            onConfirmItem(precisionItem.id, 'SHINSEGAE')
            setPrecisionItemId(null)
          }}
        />
      )}
    </div>
  )
}

'use client'

/**
 * PDF/이미지 거래명세표 담당자 확인 UI (2026-04-23 v2)
 *
 * 지원 시나리오:
 * - 유치원에서 업체의 1개월치 거래명세표를 PDF/이미지 여러 장으로 받음
 * - 사진 14장 등 페이지 수가 가변적
 * - 각 거래명세표 하단의 "합계" 금액과 1개월치 전체 합계 금액을 담당자가 검증
 *
 * UX:
 * 1. 상단 KPI: 총 파일 수 / 총 페이지 수 / 총 품목 수 / 1개월 총합계 / 불일치 페이지 수
 * 2. 페이지별 섹션: OCR footer 합계 vs 품목 합산 비교, 불일치면 경고
 * 3. 각 섹션 내 품목 테이블 (No/품목명/규격/단위/수량/단가/공급가액/세액/총액)
 * 4. "매칭 시작" 버튼 → SplitView 진입 (편집은 다음 단계에서)
 */
import { useRef, useState } from 'react'
import {
  ArrowLeft, CheckCircle2, AlertCircle, FileText, PlusCircle,
  Edit3, Trash2, Check, X, Plus, Image as ImageIcon, Camera, Loader2,
} from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem } from '@/types/audit'
import type { PageImage } from '@/lib/pdf-processor'
import type { PageTotal } from '../hooks/useAuditSession'
import { PageImageViewer } from './PageImageViewer'

interface ImagePreviewProps {
  items: ComparisonItem[]
  fileName: string
  supplierName: string
  pageTotals: PageTotal[]           // 페이지별 OCR footer 합계
  pageSourceFiles: string[]         // 페이지 번호(0-index) → 원본 파일명
  totalPages: number                // 총 페이지 수 (items 안에 없을 수도 있는 빈 페이지 고려)
  // 스캔 이미지 뷰어 (2026-04-26): sessionId가 있으면 검수자가 페이지 헤더 클릭 시 원본 표시
  sessionId?: string | null
  pages?: PageImage[]               // 새 OCR 직후 base64 dataUrl (저장된 세션 진입은 빈 배열 → API에서 fetch)
  onSupplierNameChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
  // 기존 세션에 페이지 추가 업로드 (저장된 세션에서 진입한 경우만 의미 있음, 2026-04-26)
  onExtendUpload?: (files: File[]) => void
  // Phase 1 검수 단계 — 행 수정/삭제/추가 + OCR 합계 수정 (2026-04-26)
  onUpdateItem?: (itemId: string, patch: Partial<ComparisonItem>) => void
  onRemoveItem?: (itemId: string) => void
  onAddItem?: (
    pageNumber: number,
    sourceFile: string | null,
    data: {
      extracted_name: string
      extracted_spec?: string
      extracted_unit?: string
      extracted_quantity: number
      extracted_unit_price: number
      extracted_supply_amount?: number
      extracted_tax_amount?: number
      extracted_total_price?: number
    },
  ) => void
  onUpdatePageOcrTotal?: (pageNumber: number, ocrTotal: number | null) => void
  // Phase 2: 페이지별 검수 완료 토글 (2026-04-26)
  onTogglePageReviewed?: (pageNumber: number) => void
  // 페이지 재촬영 — 같은 page_number의 items + 이미지 교체 (2026-04-26)
  onReplacePage?: (pageNumber: number, file: File) => Promise<void> | void
}

// 합계가 "수량×단가 (면세)" 또는 "수량×단가 + 10% 부가세 (과세)" 중 하나와 일치해야 정상
const isRowValid = (supply: number, total: number) => {
  if (Math.abs(supply - total) <= 1) return true                  // 면세
  if (Math.abs(Math.round(supply * 1.1) - total) <= 1) return true // 10% 과세
  return false
}

// 페이지 합계 검증: OCR footer 합계 vs 품목 합산 (1원 오차 허용)
const isPageTotalValid = (ocrTotal: number | null, itemsSum: number) => {
  if (ocrTotal == null) return true  // OCR이 footer를 못 읽었으면 검증 불가 → 통과로 간주
  return Math.abs(ocrTotal - itemsSum) <= 1
}

export function ImagePreview({
  items,
  fileName,
  supplierName,
  pageTotals,
  pageSourceFiles,
  totalPages,
  sessionId,
  pages,
  onSupplierNameChange,
  onCancel,
  onConfirm,
  onExtendUpload,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  onUpdatePageOcrTotal,
  onTogglePageReviewed,
  onReplacePage,
}: ImagePreviewProps) {
  // 페이지 이미지 뷰어 모달 상태 (2026-04-26)
  const [viewerPageNumber, setViewerPageNumber] = useState<number | null>(null)
  const [editingSupplier, setEditingSupplier] = useState(false)
  const [supplierDraft, setSupplierDraft] = useState(supplierName)
  const [isDragOver, setIsDragOver] = useState(false)
  const extendInputRef = useRef<HTMLInputElement | null>(null)
  // dragenter/leave가 자식 요소 진입 시 깜빡임을 일으키므로 카운터로 안정화
  const dragCounter = useRef(0)

  // 드래그앤드롭 핸들러 (저장된 세션에서만 활성화 — onExtendUpload prop이 있을 때) (2026-04-26)
  const handleDragEnter = (e: React.DragEvent) => {
    if (!onExtendUpload) return
    e.preventDefault()
    e.stopPropagation()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounter.current += 1
    setIsDragOver(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    if (!onExtendUpload) return
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setIsDragOver(false)
  }
  const handleDragOver = (e: React.DragEvent) => {
    if (!onExtendUpload) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }
  const handleDrop = (e: React.DragEvent) => {
    if (!onExtendUpload) return
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragOver(false)
    const dropped = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf' || f.type.startsWith('image/'),
    )
    if (dropped.length > 0) onExtendUpload(dropped)
  }

  const saveSupplier = () => {
    const trimmed = supplierDraft.trim()
    if (trimmed && trimmed !== supplierName) {
      onSupplierNameChange(trimmed)
    }
    setEditingSupplier(false)
  }

  const itemTotal = (i: ComparisonItem) =>
    i.extracted_total_price ?? i.extracted_unit_price * i.extracted_quantity

  // 전체 합계
  const grandTotal = items.reduce((s, i) => s + itemTotal(i), 0)

  // 행 단위 불일치 카운트
  const rowMismatchCount = items.filter((i) => {
    if (i.extracted_total_price == null) return false
    const supply = i.extracted_unit_price * i.extracted_quantity
    return !isRowValid(supply, i.extracted_total_price)
  }).length

  // 페이지별 그룹핑
  const pageGroups = new Map<number, ComparisonItem[]>()
  for (const item of items) {
    const p = item.page_number ?? 1
    if (!pageGroups.has(p)) pageGroups.set(p, [])
    pageGroups.get(p)!.push(item)
  }

  // totalPages 기준으로 빈 페이지(OCR 결과 0개)도 섹션에 표시 (사용자가 "이 페이지는 왜 비었지?" 인지 가능)
  const allPageNumbers = Array.from(
    new Set<number>([
      ...Array.from({ length: totalPages }, (_, i) => i + 1),
      ...pageGroups.keys(),
    ]),
  ).sort((a, b) => a - b)

  // 페이지 검증 집계
  const pageVerifyResults = allPageNumbers.map((page) => {
    const pageItems = pageGroups.get(page) ?? []
    const itemsSum = pageItems.reduce((s, i) => s + itemTotal(i), 0)
    const pt = pageTotals.find((t) => t.page === page)
    const ocrTotal = pt?.ocr_total ?? null
    const sourceFile = pt?.source_file ?? pageSourceFiles[page - 1] ?? null
    return {
      page,
      items: pageItems,
      itemsSum,
      ocrTotal,
      sourceFile,
      valid: isPageTotalValid(ocrTotal, itemsSum),
      hasOcrTotal: ocrTotal != null,
      reviewed: pt?.reviewed ?? false,
    }
  })

  const pageMismatchCount = pageVerifyResults.filter((r) => !r.valid).length
  const filesInvolved = new Set(pageSourceFiles.filter(Boolean)).size || 1
  const reviewedCount = pageVerifyResults.filter((r) => r.reviewed).length
  const allReviewed = reviewedCount === allPageNumbers.length && allPageNumbers.length > 0

  // Phase 3: 빠른 네비게이션 — 다음 불일치/미검수 페이지로 스크롤 (2026-04-26)
  const scrollToPage = (pageNum: number) => {
    const el = document.getElementById(`audit-page-${pageNum}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const findNextIssue = (): number | null => {
    // 우선순위: 불일치 > 미검수
    const next = pageVerifyResults.find((r) => !r.valid && r.hasOcrTotal)
    if (next) return next.page
    const nextUnreviewed = pageVerifyResults.find((r) => !r.reviewed)
    return nextUnreviewed ? nextUnreviewed.page : null
  }

  // Phase 3: 전체 페이지 일괄 검수 완료 (2026-04-26)
  const markAllReviewed = () => {
    if (!onTogglePageReviewed) return
    for (const r of pageVerifyResults) {
      if (!r.reviewed) onTogglePageReviewed(r.page)
    }
  }

  return (
    <div
      className="relative mx-auto max-w-6xl px-4 py-6 lg:px-6"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 드래그 중 오버레이 (추가 업로드 시각 피드백) */}
      {isDragOver && onExtendUpload && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-500/20 backdrop-blur-sm">
          <div className="rounded-2xl border-4 border-dashed border-blue-500 bg-white px-12 py-10 text-center shadow-2xl">
            <PlusCircle size={48} className="mx-auto mb-3 text-blue-600" />
            <h3 className="text-xl font-bold text-blue-900">여기에 파일을 놓으세요</h3>
            <p className="mt-1 text-sm text-blue-700">
              현재 세션에 페이지를 추가합니다 (PDF · 이미지 여러 장 지원)
            </p>
          </div>
        </div>
      )}

      {/* 헤더 카드 */}
      <div className="mb-4 rounded-2xl border-2 border-blue-200 bg-blue-50 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-blue-100 p-3">
              <CheckCircle2 className="text-blue-600" size={32} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-blue-900">거래명세표 확인</h2>
              <p className="text-sm text-blue-700">
                아래 내용이 맞는지 확인하신 후 <strong>매칭 시작</strong>을 눌러주세요
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onExtendUpload && (
              <>
                <button
                  onClick={() => extendInputRef.current?.click()}
                  className="flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
                  title="이 세션에 거래명세표 페이지를 추가합니다 (기존 페이지는 OCR 다시 안 함). 화면에 파일을 드래그해서 놓는 것도 가능합니다."
                >
                  <PlusCircle size={16} />
                  추가 업로드
                </button>
                <span className="hidden text-[11px] text-blue-600 lg:inline">
                  또는 파일을 드래그해서 놓으세요
                </span>
                <input
                  ref={extendInputRef}
                  type="file"
                  multiple
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : []
                    if (files.length > 0) onExtendUpload(files)
                    if (extendInputRef.current) extendInputRef.current.value = ''
                  }}
                />
              </>
            )}
            <button
              onClick={onCancel}
              className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft size={16} />
              다시 업로드
            </button>
          </div>
        </div>

        {/* 업체명 편집 */}
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm text-blue-700">업체명:</span>
          {editingSupplier ? (
            <>
              <input
                value={supplierDraft}
                onChange={(e) => setSupplierDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveSupplier()
                  if (e.key === 'Escape') {
                    setSupplierDraft(supplierName)
                    setEditingSupplier(false)
                  }
                }}
                className="rounded border border-blue-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                autoFocus
              />
              <button
                onClick={saveSupplier}
                className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
              >
                저장
              </button>
              <button
                onClick={() => {
                  setSupplierDraft(supplierName)
                  setEditingSupplier(false)
                }}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                취소
              </button>
            </>
          ) : (
            <>
              <span className="font-semibold text-blue-900">{supplierName}</span>
              <button
                onClick={() => {
                  setSupplierDraft(supplierName)
                  setEditingSupplier(true)
                }}
                className="text-xs text-blue-600 underline hover:text-blue-800"
              >
                수정
              </button>
            </>
          )}
          <span className="ml-4 truncate text-xs text-blue-700" title={fileName}>
            파일: {fileName}
          </span>
        </div>
      </div>

      {/* 요약 KPI */}
      <div className="mb-4 grid grid-cols-5 gap-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">파일 / 페이지</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatNumber(filesInvolved)} / {formatNumber(allPageNumbers.length)}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">총 품목</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{formatNumber(items.length)}</p>
        </div>
        <div className="rounded-xl border-2 border-blue-400 bg-blue-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-blue-700">1개월 합계 금액</p>
          <p className="mt-1 text-2xl font-bold text-blue-900">{formatCurrency(grandTotal)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">합계 검증</p>
          <p
            className={cn(
              'mt-1 text-2xl font-bold',
              pageMismatchCount > 0 ? 'text-red-600' : 'text-green-600',
            )}
          >
            {pageMismatchCount > 0 ? `${pageMismatchCount}개 불일치` : '✓ 일치'}
          </p>
          {pageMismatchCount > 0 && (
            <button
              onClick={() => {
                const next = pageVerifyResults.find((r) => !r.valid && r.hasOcrTotal)
                if (next) scrollToPage(next.page)
              }}
              className="mt-1 text-[11px] text-blue-600 underline hover:text-blue-800"
            >
              다음 불일치로 이동 →
            </button>
          )}
        </div>
        <div className={cn(
          'rounded-xl border-2 p-4 shadow-sm',
          allReviewed ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-white',
        )}>
          <p className={cn('text-xs font-medium', allReviewed ? 'text-green-700' : 'text-gray-500')}>
            검수 진행률
          </p>
          <p className={cn(
            'mt-1 text-2xl font-bold',
            allReviewed ? 'text-green-900' : 'text-gray-900',
          )}>
            {reviewedCount} / {allPageNumbers.length}
          </p>
          {!allReviewed && onTogglePageReviewed && (
            <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
              <button
                onClick={() => {
                  const next = findNextIssue()
                  if (next) scrollToPage(next)
                }}
                className="text-left text-blue-600 underline hover:text-blue-800"
              >
                다음 미검수로 이동 →
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`미검수 페이지 ${allPageNumbers.length - reviewedCount}개를 모두 검수 완료로 표시하시겠습니까?`)) {
                    markAllReviewed()
                  }
                }}
                className="text-left text-green-700 underline hover:text-green-900"
              >
                전체 검수 완료
              </button>
            </div>
          )}
        </div>
      </div>

      {/* OCR 안내 */}
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <AlertCircle size={18} className="shrink-0" />
        <span>
          PDF/이미지는 OCR로 자동 인식된 결과입니다. 각 페이지의 OCR 합계와 품목 합산이 다르면
          빨간 배지로 표시됩니다. 품목 편집은 다음 단계(매칭 확인)에서 행별로 가능합니다.
        </span>
      </div>

      {/* 회전 이미지 안내 (행 누락 방지) — 2026-05-04 */}
      {pageMismatchCount > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <AlertCircle size={18} className="shrink-0" />
          <span>
            <strong>회전된 사진에서 행 누락이 자주 발생합니다.</strong>{' '}
            페이지 번호 클릭 → 사이드 패널의 ↺/↻ 회전 버튼으로 정방향 조정 →{' '}
            페이지 헤더의 <strong>[📷 재촬영]</strong>으로 같은 사진을 다시 업로드하면 OCR 인식률이 개선됩니다.
          </span>
        </div>
      )}

      {/* 행 단위 경고 배너 */}
      {rowMismatchCount > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
          <AlertCircle size={18} className="shrink-0" />
          <span>
            수량 × 단가 ≠ 총액 (부가세 10% 고려) 인 행이 {rowMismatchCount}개 있습니다.
            해당 행은 빨간색으로 표시됩니다.
          </span>
        </div>
      )}

      {/* 페이지별 섹션 */}
      <div className="space-y-4">
        {pageVerifyResults.map((result) => (
          <PageSection
            key={result.page}
            result={result}
            onUpdateItem={onUpdateItem}
            onRemoveItem={onRemoveItem}
            onAddItem={onAddItem}
            onUpdatePageOcrTotal={onUpdatePageOcrTotal}
            onTogglePageReviewed={onTogglePageReviewed}
            onViewImage={sessionId ? (n) => setViewerPageNumber(n) : undefined}
            onReplacePage={onReplacePage}
          />
        ))}
      </div>

      {/* 원본 스캔 이미지 모달 (2026-04-26) */}
      {viewerPageNumber != null && sessionId && (
        <PageImageViewer
          key={viewerPageNumber}
          sessionId={sessionId}
          pageNumber={viewerPageNumber}
          fileName={pageSourceFiles[viewerPageNumber - 1] || undefined}
          dataUrl={pages?.find((p) => p.pageNumber === viewerPageNumber)?.dataUrl}
          onClose={() => setViewerPageNumber(null)}
        />
      )}

      {/* 하단 액션 영역 */}
      <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="text-sm">
          {allReviewed ? (
            <span className="flex items-center gap-2 text-green-700">
              <CheckCircle2 size={18} />
              <strong>모든 페이지 검수 완료</strong> · 매칭을 시작할 수 있습니다
            </span>
          ) : (
            <span className="text-amber-700">
              <strong>{allPageNumbers.length - reviewedCount}개 페이지</strong> 검수 미완료 ·
              각 페이지 헤더의 <em>"검수 완료"</em> 체크박스를 눌러 진행 상태를 표시하세요
              {pageMismatchCount > 0 && ' (불일치 페이지부터 우선 수정 권장)'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            다시 업로드
          </button>
          <button
            onClick={() => {
              if (!allReviewed) {
                if (!window.confirm(
                  `검수 미완료 페이지가 ${allPageNumbers.length - reviewedCount}개 있습니다.\n그래도 매칭을 시작하시겠습니까?`,
                )) return
              }
              onConfirm()
            }}
            className={cn(
              'flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold shadow-sm transition',
              allReviewed
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'bg-blue-600 text-white hover:bg-blue-700',
            )}
          >
            <CheckCircle2 size={18} />
            {allReviewed ? '검수 완료 → 매칭 시작' : `매칭 시작 (${formatNumber(items.length)}개)`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 페이지별 섹션 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

interface PageSectionProps {
  result: {
    page: number
    items: ComparisonItem[]
    itemsSum: number
    ocrTotal: number | null
    sourceFile: string | null
    valid: boolean
    hasOcrTotal: boolean
    reviewed: boolean
  }
  onUpdateItem?: (itemId: string, patch: Partial<ComparisonItem>) => void
  onRemoveItem?: (itemId: string) => void
  onAddItem?: (
    pageNumber: number,
    sourceFile: string | null,
    data: {
      extracted_name: string
      extracted_spec?: string
      extracted_unit?: string
      extracted_quantity: number
      extracted_unit_price: number
      extracted_supply_amount?: number
      extracted_tax_amount?: number
      extracted_total_price?: number
    },
  ) => void
  onUpdatePageOcrTotal?: (pageNumber: number, ocrTotal: number | null) => void
  onTogglePageReviewed?: (pageNumber: number) => void
  // 원본 스캔 이미지 표시 트리거 (2026-04-26)
  onViewImage?: (pageNumber: number) => void
  // 페이지 재촬영 (2026-04-26)
  onReplacePage?: (pageNumber: number, file: File) => Promise<void> | void
}

// 행 편집/추가용 임시 폼 상태
interface RowDraft {
  extracted_name: string
  extracted_spec: string
  extracted_unit: string
  extracted_quantity: number
  extracted_unit_price: number
  extracted_supply_amount: number
  extracted_tax_amount: number
  extracted_total_price: number
  // 자동 계산 모드 (단가×수량 → 공급가액/총액 자동, 세액은 0=면세 / 10%=과세)
  taxMode: 'free' | 'taxable' | 'manual'
}

function emptyDraft(): RowDraft {
  return {
    extracted_name: '',
    extracted_spec: '',
    extracted_unit: '',
    extracted_quantity: 1,
    extracted_unit_price: 0,
    extracted_supply_amount: 0,
    extracted_tax_amount: 0,
    extracted_total_price: 0,
    taxMode: 'free',
  }
}

function draftFromItem(item: ComparisonItem): RowDraft {
  const supply = item.extracted_supply_amount ?? item.extracted_unit_price * item.extracted_quantity
  const tax = item.extracted_tax_amount ?? 0
  const total = item.extracted_total_price ?? supply + tax
  // 면세/과세 자동 판별
  let taxMode: RowDraft['taxMode'] = 'manual'
  if (Math.abs(supply - total) <= 1) taxMode = 'free'
  else if (Math.abs(Math.round(supply * 1.1) - total) <= 1) taxMode = 'taxable'
  return {
    extracted_name: item.extracted_name,
    extracted_spec: item.extracted_spec ?? '',
    extracted_unit: item.extracted_unit ?? '',
    extracted_quantity: item.extracted_quantity,
    extracted_unit_price: item.extracted_unit_price,
    extracted_supply_amount: supply,
    extracted_tax_amount: tax,
    extracted_total_price: total,
    taxMode,
  }
}

// 자동 계산: 단가/수량/세금모드를 기반으로 공급가액/세액/총액 자동 산출
function recalcDraft(d: RowDraft): RowDraft {
  const supply = Math.round(d.extracted_unit_price * d.extracted_quantity)
  if (d.taxMode === 'free') {
    return { ...d, extracted_supply_amount: supply, extracted_tax_amount: 0, extracted_total_price: supply }
  }
  if (d.taxMode === 'taxable') {
    const tax = Math.round(supply * 0.1)
    return { ...d, extracted_supply_amount: supply, extracted_tax_amount: tax, extracted_total_price: supply + tax }
  }
  // manual: 사용자가 직접 입력 (자동 계산 안 함)
  return d
}

function PageSection({
  result,
  onUpdateItem,
  onRemoveItem,
  onAddItem,
  onUpdatePageOcrTotal,
  onTogglePageReviewed,
  onViewImage,
  onReplacePage,
}: PageSectionProps) {
  const { page, items, itemsSum, ocrTotal, sourceFile, valid, hasOcrTotal, reviewed } = result
  const editable = !!onUpdateItem
  const canAddRow = !!onAddItem

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RowDraft | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [editingOcrTotal, setEditingOcrTotal] = useState(false)
  const [ocrTotalDraft, setOcrTotalDraft] = useState<string>('')
  const [replacing, setReplacing] = useState(false)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)

  const handleReplaceClick = () => {
    if (replacing) return
    replaceInputRef.current?.click()
  }
  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onReplacePage) return
    if (e.target) e.target.value = ''  // 다음에 같은 파일 선택해도 onChange 발생하도록
    if (!window.confirm(
      `페이지 ${page}의 OCR 결과를 새 사진으로 교체하시겠습니까?\n` +
      `기존 ${items.length}개 행과 합계 정보가 새 OCR 결과로 덮어씌워집니다.`
    )) return
    setReplacing(true)
    try {
      await onReplacePage(page, file)
    } finally {
      setReplacing(false)
    }
  }

  const itemTotal = (i: ComparisonItem) =>
    i.extracted_total_price ?? i.extracted_unit_price * i.extracted_quantity

  const startEdit = (item: ComparisonItem) => {
    setEditingItemId(item.id)
    setDraft(draftFromItem(item))
    setAddingNew(false)
  }

  const startAdd = () => {
    setAddingNew(true)
    setDraft(emptyDraft())
    setEditingItemId(null)
  }

  const cancelEditOrAdd = () => {
    setEditingItemId(null)
    setAddingNew(false)
    setDraft(null)
  }

  const saveEdit = () => {
    if (!draft || !editingItemId || !onUpdateItem) return
    const calc = recalcDraft(draft)
    onUpdateItem(editingItemId, {
      extracted_name: calc.extracted_name,
      extracted_spec: calc.extracted_spec || undefined,
      extracted_unit: calc.extracted_unit || undefined,
      extracted_quantity: calc.extracted_quantity,
      extracted_unit_price: calc.extracted_unit_price,
      extracted_supply_amount: calc.extracted_supply_amount,
      extracted_tax_amount: calc.extracted_tax_amount,
      extracted_total_price: calc.extracted_total_price,
    })
    cancelEditOrAdd()
  }

  const saveAdd = () => {
    if (!draft || !onAddItem) return
    if (!draft.extracted_name.trim()) return
    const calc = recalcDraft(draft)
    onAddItem(page, sourceFile, {
      extracted_name: calc.extracted_name,
      extracted_spec: calc.extracted_spec || undefined,
      extracted_unit: calc.extracted_unit || undefined,
      extracted_quantity: calc.extracted_quantity,
      extracted_unit_price: calc.extracted_unit_price,
      extracted_supply_amount: calc.extracted_supply_amount,
      extracted_tax_amount: calc.extracted_tax_amount,
      extracted_total_price: calc.extracted_total_price,
    })
    cancelEditOrAdd()
  }

  const startEditOcrTotal = () => {
    setEditingOcrTotal(true)
    setOcrTotalDraft(ocrTotal != null ? String(ocrTotal) : '')
  }

  const saveOcrTotal = () => {
    if (!onUpdatePageOcrTotal) return
    const v = ocrTotalDraft.trim()
    const num = v === '' ? null : Number(v)
    if (num != null && (Number.isNaN(num) || num < 0)) return
    onUpdatePageOcrTotal(page, num)
    setEditingOcrTotal(false)
  }

  return (
    <div
      id={`audit-page-${page}`}
      className={cn(
        'overflow-hidden rounded-xl border-2 bg-white shadow-sm scroll-mt-24',
        reviewed ? 'border-green-400' : !valid ? 'border-red-300' : 'border-gray-200',
      )}
    >
      {/* 페이지 헤더 */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 border-b px-4 py-3 text-sm',
          reviewed ? 'bg-green-50' : !valid ? 'bg-red-50' : 'bg-gray-50',
        )}
      >
        {/* 페이지 검수 완료 체크박스 (Phase 2) */}
        {onTogglePageReviewed && (
          <label
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-xs hover:border-green-300 hover:bg-white"
            title="이 페이지 검수 완료로 표시"
          >
            <input
              type="checkbox"
              checked={reviewed}
              onChange={() => onTogglePageReviewed(page)}
              className="h-4 w-4 cursor-pointer accent-green-600"
            />
            <span className={cn('font-medium', reviewed ? 'text-green-700' : 'text-gray-600')}>
              {reviewed ? '검수 완료' : '검수 완료'}
            </span>
          </label>
        )}

        {onViewImage ? (
          <button
            onClick={() => onViewImage(page)}
            className="group/img flex items-center gap-2 rounded-md px-1.5 py-0.5 font-semibold text-gray-900 hover:bg-blue-100 hover:text-blue-900"
            title="원본 스캔 이미지 보기"
          >
            <ImageIcon size={16} className="text-blue-500 group-hover/img:text-blue-700" />
            <span>페이지 {page}</span>
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 opacity-0 transition group-hover/img:opacity-100">
              원본 보기
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2 font-semibold text-gray-900">
            <FileText size={16} className="text-gray-500" />
            <span>페이지 {page}</span>
          </div>
        )}

        {sourceFile && (
          onViewImage ? (
            <button
              onClick={() => onViewImage(page)}
              className="truncate rounded text-xs text-blue-600 underline-offset-2 hover:text-blue-800 hover:underline"
              title={`${sourceFile} 원본 이미지 보기`}
            >
              {sourceFile}
            </button>
          ) : (
            <span className="truncate text-xs text-gray-500" title={sourceFile}>
              {sourceFile}
            </span>
          )
        )}

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] text-gray-500">품목</div>
            <div className="font-semibold text-gray-900">{formatNumber(items.length)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-500">품목 합산</div>
            <div className="font-semibold text-gray-900">{formatCurrency(itemsSum)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-500">OCR 합계</div>
            {editingOcrTotal ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={ocrTotalDraft}
                  onChange={(e) => setOcrTotalDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveOcrTotal()
                    if (e.key === 'Escape') setEditingOcrTotal(false)
                  }}
                  placeholder="없음"
                  className="w-24 rounded border border-blue-300 px-2 py-0.5 text-right text-sm focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
                <button onClick={saveOcrTotal} className="rounded p-1 text-green-600 hover:bg-green-50">
                  <Check size={14} />
                </button>
                <button onClick={() => setEditingOcrTotal(false)} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-1">
                <span className="font-semibold text-gray-900">
                  {hasOcrTotal ? formatCurrency(ocrTotal ?? 0) : '없음'}
                </span>
                {onUpdatePageOcrTotal && (
                  <button
                    onClick={startEditOcrTotal}
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                    title="OCR 합계 수정"
                  >
                    <Edit3 size={11} />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!hasOcrTotal ? (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                OCR 합계 없음
              </span>
            ) : valid ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                ✓ 일치
              </span>
            ) : (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                ⚠ 불일치 (Δ{formatCurrency(Math.abs((ocrTotal ?? 0) - itemsSum))})
              </span>
            )}
            {/* 페이지 재촬영 버튼 (2026-04-26): 같은 page_number의 items + 이미지 교체 */}
            {onReplacePage && (
              <>
                <button
                  onClick={handleReplaceClick}
                  disabled={replacing}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition',
                    replacing
                      ? 'cursor-wait border-gray-300 bg-gray-100 text-gray-500'
                      : 'border-orange-300 bg-orange-50 text-orange-700 hover:border-orange-400 hover:bg-orange-100',
                  )}
                  title={`페이지 ${page} 다시 촬영하여 OCR 재실행`}
                >
                  {replacing ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> 재처리 중…
                    </>
                  ) : (
                    <>
                      <Camera size={12} /> 재촬영
                    </>
                  )}
                </button>
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleReplaceFile}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* 품목 테이블 */}
      {items.length === 0 && !addingNew ? (
        <div className="flex items-center justify-between px-4 py-6">
          <span className="text-sm text-gray-500">
            이 페이지에서 추출된 품목이 없습니다. (OCR 실패 또는 빈 페이지)
          </span>
          {canAddRow && (
            <button
              onClick={startAdd}
              className="flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50"
            >
              <Plus size={14} /> 행 추가
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[860px]">
          <div className="grid grid-cols-[32px_minmax(120px,2.2fr)_minmax(72px,1.1fr)_44px_52px_72px_84px_72px_88px_48px] gap-2 border-b bg-gray-50/60 px-3 py-1.5 text-xs font-medium text-gray-600">
            <div className="text-center">No</div>
            <div>품목명</div>
            <div>규격</div>
            <div className="text-center">단위</div>
            <div className="text-right">수량</div>
            <div className="text-right">단가</div>
            <div className="text-right">공급가액</div>
            <div className="text-right">세액</div>
            <div className="text-right">총액</div>
            <div className="text-center">{editable ? '액션' : ''}</div>
          </div>
          <div>
            {items.map((item, idx) => {
              const isEditing = editingItemId === item.id
              if (isEditing && draft) {
                return (
                  <RowEditor
                    key={item.id}
                    draft={draft}
                    setDraft={setDraft}
                    onSave={saveEdit}
                    onCancel={cancelEditOrAdd}
                    no={idx + 1}
                    originalName={item.extracted_name}
                  />
                )
              }
              const supply = item.extracted_unit_price * item.extracted_quantity
              const rowMismatch =
                item.extracted_total_price != null &&
                !isRowValid(supply, item.extracted_total_price)
              const displayTotal = itemTotal(item)
              const displaySupply = item.extracted_supply_amount ?? supply
              const derivedTax =
                item.extracted_total_price != null
                  ? Math.max(0, item.extracted_total_price - displaySupply)
                  : 0
              const displayTax = item.extracted_tax_amount ?? derivedTax

              return (
                <div
                  key={item.id}
                  className={cn(
                    'group grid items-center grid-cols-[32px_minmax(120px,2.2fr)_minmax(72px,1.1fr)_44px_52px_72px_84px_72px_88px_48px] gap-2 border-b px-3 py-2 text-sm last:border-0',
                    rowMismatch ? 'bg-red-50' : 'hover:bg-gray-50',
                  )}
                >
                  <div className="text-center text-gray-500">{idx + 1}</div>
                  <div
                    className="line-clamp-2 break-words leading-snug"
                    title={item.extracted_name}
                  >
                    {item.extracted_name}
                  </div>
                  <div
                    className="line-clamp-2 break-words leading-snug text-gray-600"
                    title={item.extracted_spec || ''}
                  >
                    {item.extracted_spec || '-'}
                  </div>
                  <div className="text-center text-gray-600">{item.extracted_unit || '-'}</div>
                  <div className="text-right">{formatNumber(item.extracted_quantity)}</div>
                  <div className="text-right">{formatCurrency(item.extracted_unit_price)}</div>
                  <div className="text-right text-gray-700">{formatCurrency(displaySupply)}</div>
                  <div className="text-right text-gray-700">
                    {displayTax > 0 ? formatCurrency(displayTax) : '면세'}
                  </div>
                  <div
                    className={cn(
                      'text-right font-medium',
                      rowMismatch ? 'text-red-700' : 'text-gray-900',
                    )}
                  >
                    {formatCurrency(displayTotal)}
                  </div>
                  <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                    {editable && (
                      <button
                        onClick={() => startEdit(item)}
                        className="rounded p-1 text-blue-600 hover:bg-blue-50"
                        title="수정"
                      >
                        <Edit3 size={14} />
                      </button>
                    )}
                    {onRemoveItem && (
                      <button
                        onClick={() => {
                          if (window.confirm(`"${item.extracted_name}" 행을 삭제하시겠습니까?`)) {
                            onRemoveItem(item.id)
                          }
                        }}
                        className="rounded p-1 text-red-600 hover:bg-red-50"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {addingNew && draft && (
              <RowEditor
                draft={draft}
                setDraft={setDraft}
                onSave={saveAdd}
                onCancel={cancelEditOrAdd}
                no={items.length + 1}
                isNew
              />
            )}
          </div>
          {canAddRow && !addingNew && !editingItemId && (
            <div className="border-t bg-gray-50/60 px-3 py-2">
              <button
                onClick={startAdd}
                className="flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50"
              >
                <Plus size={14} /> 행 추가
              </button>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 행 편집/추가 인풋 그리드 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

interface RowEditorProps {
  draft: RowDraft
  setDraft: (d: RowDraft) => void
  onSave: () => void
  onCancel: () => void
  no: number
  isNew?: boolean
  /** 편집 전 원본 값 (사전 등록 시 wrong 패턴으로 사용, 신규 행 추가 시는 비어있음) */
  originalName?: string
}

function RowEditor({ draft, setDraft, onSave, onCancel, no, isNew, originalName }: RowEditorProps) {
  // 입력 변경 시 자동 계산 — taxMode='manual'일 때만 자동 계산 안 함
  const update = (patch: Partial<RowDraft>) => {
    const merged = { ...draft, ...patch }
    setDraft(recalcDraft(merged))
  }

  // 📚 OCR 보정 사전 등록 — 검수자가 OCR 오인식을 정정한 경우 즉시 등록
  // 다음 OCR부터 자동으로 같은 보정이 적용됨
  const handleRegisterCorrection = async () => {
    const defaultWrong = originalName ?? draft.extracted_name
    const wrong = window.prompt('오인식 텍스트 (거래명세표에 잘못 추출된 표기)', defaultWrong)?.trim()
    if (!wrong) return
    const correct = window.prompt('정확한 표기 (한국 식자재 표준 표기)', draft.extracted_name)?.trim()
    if (!correct) return
    if (wrong === correct) {
      window.alert('오인식과 정확한 표기가 같으면 등록할 수 없습니다.')
      return
    }
    try {
      const res = await fetch('/api/ocr-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wrong, correct, category: 'general', note: '검수자 행 편집 시 등록' }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '등록 실패')
      window.alert(`사전 등록 완료\n  "${wrong}" → "${correct}"\n다음 OCR부터 자동 적용됩니다.`)
    } catch (e) {
      window.alert('사전 등록 실패: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  const showRegisterButton = !isNew && !!originalName && originalName !== draft.extracted_name

  return (
    <div
      className={cn(
        'grid grid-cols-[32px_minmax(120px,2.2fr)_minmax(72px,1.1fr)_44px_52px_72px_84px_72px_88px_48px] gap-2 border-b px-3 py-2 text-sm',
        isNew ? 'bg-blue-50/40' : 'bg-yellow-50/60',
      )}
    >
      <div className="text-center text-gray-500">{no}</div>
      <input
        value={draft.extracted_name}
        onChange={(e) => update({ extracted_name: e.target.value })}
        placeholder="품목명"
        className="rounded border border-gray-300 px-1.5 py-0.5 text-sm focus:border-blue-500 focus:outline-none"
        autoFocus
      />
      <input
        value={draft.extracted_spec}
        onChange={(e) => update({ extracted_spec: e.target.value })}
        placeholder="규격"
        className="rounded border border-gray-300 px-1.5 py-0.5 text-sm focus:border-blue-500 focus:outline-none"
      />
      <input
        value={draft.extracted_unit}
        onChange={(e) => update({ extracted_unit: e.target.value })}
        placeholder="단위"
        className="rounded border border-gray-300 px-1.5 py-0.5 text-center text-sm focus:border-blue-500 focus:outline-none"
      />
      <input
        type="number"
        value={draft.extracted_quantity}
        onChange={(e) => update({ extracted_quantity: Number(e.target.value) || 0 })}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm focus:border-blue-500 focus:outline-none"
      />
      <input
        type="number"
        value={draft.extracted_unit_price}
        onChange={(e) => update({ extracted_unit_price: Number(e.target.value) || 0 })}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm focus:border-blue-500 focus:outline-none"
      />
      <input
        type="number"
        value={draft.extracted_supply_amount}
        onChange={(e) => setDraft({ ...draft, extracted_supply_amount: Number(e.target.value) || 0, taxMode: 'manual' })}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm focus:border-blue-500 focus:outline-none"
        title="자동 계산 (수량×단가). 수동 변경 시 manual 모드 전환"
      />
      <input
        type="number"
        value={draft.extracted_tax_amount}
        onChange={(e) => setDraft({ ...draft, extracted_tax_amount: Number(e.target.value) || 0, taxMode: 'manual' })}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm focus:border-blue-500 focus:outline-none"
      />
      <input
        type="number"
        value={draft.extracted_total_price}
        onChange={(e) => setDraft({ ...draft, extracted_total_price: Number(e.target.value) || 0, taxMode: 'manual' })}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-right text-sm focus:border-blue-500 focus:outline-none"
      />
      <div className="flex items-center justify-center gap-1">
        <button onClick={onSave} className="rounded bg-green-600 p-1 text-white hover:bg-green-700" title="저장">
          <Check size={14} />
        </button>
        <button onClick={onCancel} className="rounded border border-gray-300 bg-white p-1 text-gray-700 hover:bg-gray-50" title="취소">
          <X size={14} />
        </button>
        {showRegisterButton && (
          <button
            onClick={handleRegisterCorrection}
            className="rounded border border-purple-300 bg-purple-50 p-1 text-purple-700 hover:bg-purple-100"
            title="이 보정을 OCR 사전에 등록 (다음 OCR부터 자동 적용)"
          >
            📚
          </button>
        )}
      </div>
      {/* 자동 계산 모드 안내 */}
      <div className="col-span-10 mt-1 flex items-center gap-3 text-[11px] text-gray-600">
        <span>자동 계산:</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={draft.taxMode === 'free'}
            onChange={() => setDraft(recalcDraft({ ...draft, taxMode: 'free' }))}
          />
          면세 (총액 = 단가×수량)
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={draft.taxMode === 'taxable'}
            onChange={() => setDraft(recalcDraft({ ...draft, taxMode: 'taxable' }))}
          />
          과세 10% (총액 = 단가×수량×1.1)
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={draft.taxMode === 'manual'}
            onChange={() => setDraft({ ...draft, taxMode: 'manual' })}
          />
          수동 입력
        </label>
      </div>
    </div>
  )
}

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
import { ArrowLeft, CheckCircle2, AlertCircle, FileText, PlusCircle } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem } from '@/types/audit'
import type { PageTotal } from '../hooks/useAuditSession'

interface ImagePreviewProps {
  items: ComparisonItem[]
  fileName: string
  supplierName: string
  pageTotals: PageTotal[]           // 페이지별 OCR footer 합계
  pageSourceFiles: string[]         // 페이지 번호(0-index) → 원본 파일명
  totalPages: number                // 총 페이지 수 (items 안에 없을 수도 있는 빈 페이지 고려)
  onSupplierNameChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
  // 기존 세션에 페이지 추가 업로드 (저장된 세션에서 진입한 경우만 의미 있음, 2026-04-26)
  onExtendUpload?: (files: File[]) => void
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
  onSupplierNameChange,
  onCancel,
  onConfirm,
  onExtendUpload,
}: ImagePreviewProps) {
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
    }
  })

  const pageMismatchCount = pageVerifyResults.filter((r) => !r.valid).length
  const filesInvolved = new Set(pageSourceFiles.filter(Boolean)).size || 1

  return (
    <div
      className="relative mx-auto max-w-6xl p-6"
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
      <div className="mb-4 grid grid-cols-4 gap-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">파일 수 / 페이지 수</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatNumber(filesInvolved)} / {formatNumber(allPageNumbers.length)}
          </p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">총 품목 수</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{formatNumber(items.length)}</p>
        </div>
        <div className="rounded-xl border-2 border-blue-400 bg-blue-50 p-4 shadow-sm">
          <p className="text-xs font-medium text-blue-700">1개월 합계 금액</p>
          <p className="mt-1 text-2xl font-bold text-blue-900">{formatCurrency(grandTotal)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">페이지 검증</p>
          <p
            className={cn(
              'mt-1 text-2xl font-bold',
              pageMismatchCount > 0 ? 'text-red-600' : 'text-green-600',
            )}
          >
            {pageMismatchCount > 0
              ? `${pageMismatchCount}개 페이지 불일치`
              : '✓ 전체 일치'}
          </p>
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
          <PageSection key={result.page} result={result} />
        ))}
      </div>

      {/* 하단 액션 버튼 */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          다시 업로드
        </button>
        <button
          onClick={onConfirm}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <CheckCircle2 size={18} />
          매칭 시작 ({formatNumber(items.length)}개)
        </button>
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
  }
}

function PageSection({ result }: PageSectionProps) {
  const { page, items, itemsSum, ocrTotal, sourceFile, valid, hasOcrTotal } = result

  const itemTotal = (i: ComparisonItem) =>
    i.extracted_total_price ?? i.extracted_unit_price * i.extracted_quantity

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border-2 bg-white shadow-sm',
        !valid ? 'border-red-300' : 'border-gray-200',
      )}
    >
      {/* 페이지 헤더 */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 border-b px-4 py-3 text-sm',
          !valid ? 'bg-red-50' : 'bg-gray-50',
        )}
      >
        <div className="flex items-center gap-2 font-semibold text-gray-900">
          <FileText size={16} className="text-gray-500" />
          <span>페이지 {page}</span>
        </div>

        {sourceFile && (
          <span className="truncate text-xs text-gray-500" title={sourceFile}>
            {sourceFile}
          </span>
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
          {hasOcrTotal && (
            <div className="text-right">
              <div className="text-[10px] text-gray-500">OCR 합계</div>
              <div className="font-semibold text-gray-900">
                {formatCurrency(ocrTotal ?? 0)}
              </div>
            </div>
          )}
          <div>
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
          </div>
        </div>
      </div>

      {/* 품목 테이블 */}
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-500">
          이 페이지에서 추출된 품목이 없습니다. (OCR 실패 또는 빈 페이지)
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[40px_minmax(140px,1fr)_minmax(110px,160px)_60px_70px_95px_100px_90px_105px] gap-2 border-b bg-gray-50/60 px-3 py-1.5 text-xs font-medium text-gray-600">
            <div className="text-center">No</div>
            <div>품목명</div>
            <div>규격</div>
            <div className="text-center">단위</div>
            <div className="text-right">수량</div>
            <div className="text-right">단가</div>
            <div className="text-right">공급가액</div>
            <div className="text-right">세액</div>
            <div className="text-right">총액</div>
          </div>
          <div>
            {items.map((item, idx) => {
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
                    'grid grid-cols-[40px_minmax(140px,1fr)_minmax(110px,160px)_60px_70px_95px_100px_90px_105px] gap-2 border-b px-3 py-2 text-sm last:border-0',
                    rowMismatch ? 'bg-red-50' : 'hover:bg-gray-50',
                  )}
                >
                  <div className="text-center text-gray-500">{idx + 1}</div>
                  <div className="truncate" title={item.extracted_name}>
                    {item.extracted_name}
                  </div>
                  <div className="truncate text-gray-600" title={item.extracted_spec || ''}>
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
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

'use client'

/**
 * PDF/이미지 거래명세표 담당자 확인 UI (2026-04-23)
 *
 * 엑셀 flow의 ExcelPreview와 동일한 UX 제공:
 * - OCR로 추출된 품목 전체 스크롤 표시 (읽기 전용)
 * - 합계 검증 (수량 × 단가 ≈ 총액) — 불일치 행 빨간 배경
 * - 업체명 inline edit
 * - "매칭 시작" 버튼으로 다음 단계 진입
 *
 * 편집/삭제는 다음 단계(SplitView)에서 행별로 수행
 */
import { useState } from 'react'
import { ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem } from '@/types/audit'

interface ImagePreviewProps {
  items: ComparisonItem[]
  fileName: string
  supplierName: string
  onSupplierNameChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
}

export function ImagePreview({
  items,
  fileName,
  supplierName,
  onSupplierNameChange,
  onCancel,
  onConfirm,
}: ImagePreviewProps) {
  const [editingSupplier, setEditingSupplier] = useState(false)
  const [supplierDraft, setSupplierDraft] = useState(supplierName)

  const saveSupplier = () => {
    const trimmed = supplierDraft.trim()
    if (trimmed && trimmed !== supplierName) {
      onSupplierNameChange(trimmed)
    }
    setEditingSupplier(false)
  }

  // 합계 (OCR은 extracted_total_price가 없을 수 있으므로 단가×수량으로 fallback)
  const itemTotal = (i: ComparisonItem) =>
    i.extracted_total_price ?? i.extracted_unit_price * i.extracted_quantity
  const totalAmount = items.reduce((s, i) => s + itemTotal(i), 0)

  // 수량 × 단가 ≠ 총액인 행 수 (1원 허용)
  const mismatchCount = items.filter((i) => {
    if (i.extracted_total_price == null) return false
    const expected = i.extracted_unit_price * i.extracted_quantity
    return Math.abs(expected - i.extracted_total_price) > 1
  }).length

  return (
    <div className="mx-auto max-w-6xl p-6">
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
          <button
            onClick={onCancel}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            다시 업로드
          </button>
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
          <span className="ml-4 text-xs text-blue-700">파일: {fileName}</span>
        </div>
      </div>

      {/* 요약 KPI */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">총 품목 수</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{formatNumber(items.length)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">거래명세표 총액</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(totalAmount)}</p>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">합계 검증</p>
          <p
            className={cn(
              'mt-1 text-2xl font-bold',
              mismatchCount > 0 ? 'text-red-600' : 'text-green-600',
            )}
          >
            {mismatchCount > 0 ? `${mismatchCount}개 불일치` : '✓ 전체 일치'}
          </p>
        </div>
      </div>

      {/* OCR 안내 */}
      <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <AlertCircle size={18} className="shrink-0" />
        <span>
          PDF/이미지는 OCR로 자동 인식된 결과입니다. 품목명·규격·수량·단가가 원본과 다르면
          다음 단계(매칭 확인)에서 행별로 수정할 수 있습니다.
        </span>
      </div>

      {/* 품목 테이블 — 열: No / 품목명 / 규격 / 수량 / 단가 / 총액 */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="grid grid-cols-[40px_minmax(140px,1fr)_minmax(120px,180px)_80px_100px_110px] gap-2 border-b bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
          <div className="text-center">No</div>
          <div>품목명</div>
          <div>규격</div>
          <div className="text-right">수량</div>
          <div className="text-right">단가</div>
          <div className="text-right">총액</div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {items.map((item, idx) => {
            const expected = item.extracted_unit_price * item.extracted_quantity
            const mismatch =
              item.extracted_total_price != null &&
              Math.abs(expected - item.extracted_total_price) > 1
            const displayTotal = itemTotal(item)

            return (
              <div
                key={item.id}
                className={cn(
                  'grid grid-cols-[40px_minmax(140px,1fr)_minmax(120px,180px)_80px_100px_110px] gap-2 border-b px-3 py-2 text-sm',
                  mismatch ? 'bg-red-50' : 'hover:bg-gray-50',
                )}
              >
                <div className="text-center text-gray-500">{idx + 1}</div>
                <div className="truncate" title={item.extracted_name}>
                  {item.extracted_name}
                </div>
                <div className="truncate text-gray-600" title={item.extracted_spec || ''}>
                  {item.extracted_spec || '-'}
                </div>
                <div className="text-right">{formatNumber(item.extracted_quantity)}</div>
                <div className="text-right">{formatCurrency(item.extracted_unit_price)}</div>
                <div
                  className={cn(
                    'text-right font-medium',
                    mismatch ? 'text-red-700' : 'text-gray-900',
                  )}
                >
                  {formatCurrency(displayTotal)}
                </div>
              </div>
            )
          })}
        </div>

        {mismatchCount > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
            <AlertCircle size={18} className="shrink-0" />
            <span>
              수량 × 단가 ≠ 총액인 행이 {mismatchCount}개 있습니다. OCR 오인식 가능성이 있으니
              다음 단계에서 확인·수정해 주세요.
            </span>
          </div>
        )}
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

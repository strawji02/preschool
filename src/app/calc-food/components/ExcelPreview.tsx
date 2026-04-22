'use client'

/**
 * 엑셀 거래명세표 담당자 확인 UI (2026-04-21)
 *
 * 기능:
 * - 파싱된 품목 전체 스크롤 표시
 * - 합계 검증 (수량 × 단가 = 금액) — 불일치 행 빨간 배경
 * - 업체명 inline edit (파일명에서 자동 추출, 수정 가능)
 * - 각 행 개별 수정 (수량/단가/금액) / 삭제
 * - "매칭 시작" 버튼 — 합계 불일치 1개 이상이면 경고 후 진행 (막지 않음)
 */
import { useState } from 'react'
import { ArrowLeft, CheckCircle2, AlertCircle, Trash2, Edit3, Check, X } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ExcelPreviewData } from '../hooks/useAuditSession'

interface ExcelPreviewProps {
  preview: ExcelPreviewData
  onSupplierNameChange: (name: string) => void
  onItemChange: (rowIndex: number, patch: Partial<ExcelPreviewData['items'][number]>) => void
  onItemRemove: (rowIndex: number) => void
  onCancel: () => void
  onConfirm: (preview: ExcelPreviewData) => void
}

export function ExcelPreview({
  preview,
  onSupplierNameChange,
  onItemChange,
  onItemRemove,
  onCancel,
  onConfirm,
}: ExcelPreviewProps) {
  const [editingSupplier, setEditingSupplier] = useState(false)
  const [supplierDraft, setSupplierDraft] = useState(preview.supplierName)

  const [editingRow, setEditingRow] = useState<number | null>(null)
  const [rowDraft, setRowDraft] = useState<{ quantity: number; unit_price: number; total_price: number } | null>(null)

  const saveSupplier = () => {
    if (supplierDraft.trim() && supplierDraft !== preview.supplierName) {
      onSupplierNameChange(supplierDraft.trim())
    }
    setEditingSupplier(false)
  }

  const startEditRow = (rowIndex: number) => {
    const item = preview.items.find(i => i.row_index === rowIndex)
    if (!item) return
    setEditingRow(rowIndex)
    setRowDraft({
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
    })
  }

  const saveRow = () => {
    if (editingRow === null || !rowDraft) return
    onItemChange(editingRow, rowDraft)
    setEditingRow(null)
    setRowDraft(null)
  }

  const cancelEditRow = () => {
    setEditingRow(null)
    setRowDraft(null)
  }

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

        {/* 업체명 inline edit */}
        <div className="mt-4 flex items-center gap-3">
          <label className="text-sm font-medium text-blue-900">업체명:</label>
          {editingSupplier ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={supplierDraft}
                onChange={(e) => setSupplierDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveSupplier()
                  if (e.key === 'Escape') {
                    setSupplierDraft(preview.supplierName)
                    setEditingSupplier(false)
                  }
                }}
                autoFocus
                className="rounded-lg border border-blue-400 px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={saveSupplier} className="rounded bg-blue-600 p-1 text-white hover:bg-blue-700">
                <Check size={16} />
              </button>
              <button
                onClick={() => {
                  setSupplierDraft(preview.supplierName)
                  setEditingSupplier(false)
                }}
                className="rounded bg-gray-400 p-1 text-white hover:bg-gray-500"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="rounded bg-white px-3 py-1 text-base font-bold text-blue-900 shadow-sm">
                {preview.supplierName}
              </span>
              <button
                onClick={() => setEditingSupplier(true)}
                className="flex items-center gap-1 rounded text-sm text-blue-600 hover:text-blue-800"
              >
                <Edit3 size={14} />
                수정
              </button>
            </div>
          )}
          <span className="text-xs text-blue-700">
            (파일: {preview.fileName})
          </span>
        </div>

        {/* KPI */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Kpi label="총 품목 수" value={`${formatNumber(preview.items.length)}개`} />
          <Kpi label="거래명세표 총액" value={formatCurrency(preview.totalAmount)} highlight />
          <Kpi
            label="합계 검증"
            value={preview.mismatchCount === 0 ? '✓ 전체 일치' : `⚠️ ${preview.mismatchCount}개 불일치`}
            warning={preview.mismatchCount > 0}
          />
        </div>

        {preview.mismatchCount > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
            <AlertCircle size={18} className="shrink-0" />
            <span>
              수량 × 단가 + 세액 ≠ 총액인 행이 {preview.mismatchCount}개 있습니다. 해당 행은 빨간색으로 표시됩니다. 수정하시거나 그대로 진행 가능합니다.
            </span>
          </div>
        )}
      </div>

      {/* 품목 테이블 */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="grid grid-cols-[50px_1fr_160px_70px_80px_90px_110px_50px] gap-2 border-b bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600">
          <div className="text-center">No</div>
          <div>품목명</div>
          <div>규격</div>
          <div className="text-right">수량</div>
          <div>단위</div>
          <div className="text-right">단가</div>
          <div className="text-right">금액</div>
          <div></div>
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          {preview.items.map((item, idx) => {
            // 세액 포함 총액 기준 검증 (명세표 원장과 일치하는지)
            const expected = item.quantity * item.unit_price + (item.tax_amount ?? 0)
            const mismatch = Math.abs(expected - item.total_price) > 1
            const isEditing = editingRow === item.row_index

            return (
              <div
                key={item.row_index}
                className={cn(
                  'grid grid-cols-[50px_1fr_160px_70px_80px_90px_110px_50px] gap-2 border-b px-4 py-2 text-sm',
                  mismatch && 'bg-red-50',
                  isEditing && 'bg-blue-50',
                )}
              >
                <div className="text-center text-gray-500">{idx + 1}</div>
                <div className="truncate" title={item.name}>
                  {item.name}
                </div>
                <div className="truncate text-gray-600" title={item.spec}>
                  {item.spec || '-'}
                </div>
                {isEditing ? (
                  <>
                    <input
                      type="number"
                      value={rowDraft?.quantity ?? 0}
                      onChange={(e) => setRowDraft(p => p ? { ...p, quantity: Number(e.target.value) } : null)}
                      className="rounded border border-blue-400 px-1 text-right"
                      step="0.1"
                    />
                    <div className="text-gray-600">-</div>
                    <input
                      type="number"
                      value={rowDraft?.unit_price ?? 0}
                      onChange={(e) => setRowDraft(p => p ? { ...p, unit_price: Number(e.target.value) } : null)}
                      className="rounded border border-blue-400 px-1 text-right"
                    />
                    <input
                      type="number"
                      value={rowDraft?.total_price ?? 0}
                      onChange={(e) => setRowDraft(p => p ? { ...p, total_price: Number(e.target.value) } : null)}
                      className="rounded border border-blue-400 px-1 text-right"
                    />
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={saveRow} className="rounded bg-blue-600 p-1 text-white hover:bg-blue-700" title="저장">
                        <Check size={12} />
                      </button>
                      <button onClick={cancelEditRow} className="rounded bg-gray-400 p-1 text-white hover:bg-gray-500" title="취소">
                        <X size={12} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-right">{item.quantity}</div>
                    <div className="text-gray-600">-</div>
                    <div className="text-right">{formatCurrency(item.unit_price)}</div>
                    <div className={cn('text-right', mismatch && 'text-red-600 font-medium')}>
                      {formatCurrency(item.total_price)}
                      {mismatch && (
                        <div className="text-xs text-red-500">
                          → {formatCurrency(expected)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => startEditRow(item.row_index)}
                        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        title="수정"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`"${item.name}"을(를) 삭제하시겠습니까?`)) {
                            onItemRemove(item.row_index)
                          }
                        }}
                        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-700"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 액션 */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          취소 (다시 업로드)
        </button>
        <button
          onClick={() => onConfirm(preview)}
          disabled={preview.items.length === 0}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          확인 완료 → 매칭 시작 ({formatNumber(preview.items.length)}개)
        </button>
      </div>
    </div>
  )
}

function Kpi({ label, value, highlight, warning }: { label: string; value: string; highlight?: boolean; warning?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-white p-3 shadow-sm',
        highlight && 'ring-2 ring-blue-400',
        warning && 'ring-2 ring-yellow-400',
      )}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className={cn('mt-1 text-lg font-bold', highlight && 'text-blue-600', warning && 'text-yellow-700')}>
        {value}
      </div>
    </div>
  )
}

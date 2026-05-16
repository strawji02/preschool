'use client'

import { useState } from 'react'
import { ArrowLeft, FileText, Download, Edit3, Check, X, RefreshCw, ClipboardList } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { downloadReportAsExcel } from '@/lib/excel-utils'
import type { ComparisonItem } from '@/types/audit'

interface ReportHeaderProps {
  fileName: string
  supplierName?: string | null
  totalItems: number
  items: ComparisonItem[]
  onBackToMatching: () => void
  onUpdateSupplierName?: (name: string) => void
  /** 거래명세표 재확인 모달 트리거 (2026-05-12) */
  onOpenInvoiceReview?: () => void
  /** 제안서 모드 진입 (2026-05-12) */
  onOpenProposal?: () => void
  /** 공급율 (2026-05-16) — 엑셀 다운로드에 적용 */
  supplyRate?: number
}

export function ReportHeader({
  fileName,
  supplierName,
  totalItems,
  items,
  onBackToMatching,
  onUpdateSupplierName,
  onOpenInvoiceReview,
  onOpenProposal,
  supplyRate = 1,
}: ReportHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(supplierName ?? '')

  const displayName = supplierName ?? fileName.replace(/\.[^/.]+$/, '')

  const save = () => {
    if (onUpdateSupplierName && draft.trim() && draft !== supplierName) {
      onUpdateSupplierName(draft.trim())
    }
    setEditing(false)
  }

  return (
    <div className="border-b border-gray-200 bg-white px-5 py-3">
      <div className="flex items-center justify-between gap-4">
        {/* 좌측 — Back + 업체명/파일 정보 */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBackToMatching}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300 hover:bg-gray-50"
          >
            <ArrowLeft size={14} />
            매칭으로
          </button>

          <div className="h-7 w-px shrink-0 bg-gray-200" />

          <div className="flex min-w-0 items-center gap-2.5">
            <div className="shrink-0 rounded-md bg-blue-50 p-1.5">
              <FileText size={16} className="text-blue-600" />
            </div>
            <div className="min-w-0">
              {editing ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save()
                      if (e.key === 'Escape') {
                        setDraft(supplierName ?? '')
                        setEditing(false)
                      }
                    }}
                    autoFocus
                    className="w-44 rounded border border-blue-400 px-2 py-0.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={save} className="rounded bg-blue-600 p-1 text-white hover:bg-blue-700">
                    <Check size={13} />
                  </button>
                  <button
                    onClick={() => {
                      setDraft(supplierName ?? '')
                      setEditing(false)
                    }}
                    className="rounded bg-gray-400 p-1 text-white hover:bg-gray-500"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-sm font-semibold text-gray-900">
                    {displayName}
                    <span className="ml-1 text-[11px] font-normal text-gray-500">유치원</span>
                  </h2>
                  {onUpdateSupplierName && (
                    <button
                      onClick={() => {
                        setDraft(supplierName ?? '')
                        setEditing(true)
                      }}
                      className="rounded p-0.5 text-gray-400 hover:text-blue-600"
                      title="업체명 수정"
                    >
                      <Edit3 size={12} />
                    </button>
                  )}
                </div>
              )}
              <p className="truncate text-[11px] text-gray-500">
                {fileName} · {formatNumber(totalItems)}개 품목
              </p>
            </div>
          </div>
        </div>

        {/* 우측 — 액션 그룹 (시각 위계 적용)
             tertiary: 명세표 재확인 (ghost)
             secondary: 엑셀 다운로드 (outline)
             primary: 제안서 보기 (filled, 강조) */}
        <div className="flex shrink-0 items-center gap-2">
          {onOpenInvoiceReview && (
            <button
              onClick={onOpenInvoiceReview}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100"
              title="거래명세표 재확인 또는 수정"
            >
              <RefreshCw size={13} />
              명세표 재확인
            </button>
          )}
          <button
            className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
            onClick={() => {
              downloadReportAsExcel(items, (supplierName || fileName).replace(/\.[^/.]+$/, ''), supplyRate)
            }}
          >
            <Download size={13} />
            엑셀
          </button>
          {onOpenProposal && (
            <button
              onClick={onOpenProposal}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
              title="고객 제출용 제안서 (인포그래픽 보고서)"
            >
              <ClipboardList size={13} />
              제안서 보기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

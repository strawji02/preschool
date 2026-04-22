'use client'

import { useState } from 'react'
import { ArrowLeft, FileText, Download, Edit3, Check, X } from 'lucide-react'
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
}

export function ReportHeader({
  fileName,
  supplierName,
  totalItems,
  items,
  onBackToMatching,
  onUpdateSupplierName,
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
    <div className="border-b bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBackToMatching}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            <ArrowLeft size={16} />
            매칭으로 돌아가기
          </button>

          <div className="h-6 w-px bg-gray-300" />

          <div className="flex items-center gap-2">
            <FileText size={20} className="text-blue-600" />
            <div>
              {editing ? (
                <div className="flex items-center gap-2">
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
                    className="rounded border border-blue-400 px-2 py-0.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button onClick={save} className="rounded bg-blue-600 p-1 text-white hover:bg-blue-700">
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setDraft(supplierName ?? '')
                      setEditing(false)
                    }}
                    className="rounded bg-gray-400 p-1 text-white hover:bg-gray-500"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-gray-900">
                    {displayName}
                    <span className="ml-1 text-xs font-normal text-gray-500">유치원</span>
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
                      <Edit3 size={13} />
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-500">
                {fileName} · {formatNumber(totalItems)}개 품목 분석 완료
              </p>
            </div>
          </div>
        </div>

        <button
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          onClick={() => {
            downloadReportAsExcel(items, (supplierName || fileName).replace(/\.[^/.]+$/, ''))
          }}
        >
          <Download size={16} />
          엑셀로 다운로드
        </button>
      </div>
    </div>
  )
}

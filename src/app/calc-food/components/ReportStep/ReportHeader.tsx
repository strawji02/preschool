'use client'

import { ArrowLeft, FileText, Download } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { downloadReportAsExcel } from '@/lib/excel-utils'
import type { ComparisonItem } from '@/types/audit'

interface ReportHeaderProps {
  fileName: string
  totalItems: number
  items: ComparisonItem[]
  onBackToMatching: () => void
}

export function ReportHeader({ fileName, totalItems, items, onBackToMatching }: ReportHeaderProps) {
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
              <h2 className="font-semibold text-gray-900">{fileName}</h2>
              <p className="text-sm text-gray-500">{formatNumber(totalItems)}개 품목 분석 완료</p>
            </div>
          </div>
        </div>

        <button
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          onClick={() => {
            downloadReportAsExcel(items, fileName.replace(/\.[^/.]+$/, ''))
          }}
        >
          <Download size={16} />
          엑셀로 다운로드
        </button>
      </div>
    </div>
  )
}

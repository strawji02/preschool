'use client'

import { FileText, Loader2 } from 'lucide-react'

interface ProcessingViewProps {
  fileName: string
  currentPage: number
  totalPages: number
}

export function ProcessingView({ fileName, currentPage, totalPages }: ProcessingViewProps) {
  const progress = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0

  return (
    <div className="flex min-h-[calc(100vh-200px)] flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="relative mb-6">
            <div className="rounded-full bg-blue-100 p-6">
              <FileText size={48} className="text-blue-600" />
            </div>
            <div className="absolute -bottom-1 -right-1 rounded-full bg-white p-1">
              <Loader2 size={24} className="animate-spin text-blue-600" />
            </div>
          </div>

          <h3 className="mb-2 text-xl font-semibold text-gray-900">명세서 분석 중</h3>
          <p className="text-gray-500">{fileName}</p>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-gray-600">
              {currentPage} / {totalPages} 페이지
            </span>
            <span className="font-medium text-blue-600">{progress}%</span>
          </div>

          <div className="h-3 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <p className="text-center text-sm text-gray-500">
          AI가 명세서의 품목과 단가를 분석하고 있습니다
        </p>
      </div>
    </div>
  )
}

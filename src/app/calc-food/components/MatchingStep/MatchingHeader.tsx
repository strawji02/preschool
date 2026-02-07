'use client'

import { CheckCircle, AlertCircle, ArrowRight, Download } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem } from '@/types/audit'

interface MatchingHeaderProps {
  fileName: string
  confirmationStats: {
    total: number
    confirmed: number
    unconfirmed: number
  }
  items: ComparisonItem[]
  onConfirmAllAutoMatched: () => void
  onProceedToReport: () => void
}

export function MatchingHeader({
  fileName,
  confirmationStats,
  items,
  onConfirmAllAutoMatched,
  onProceedToReport,
}: MatchingHeaderProps) {
  const { total, confirmed, unconfirmed } = confirmationStats
  const progress = total > 0 ? (confirmed / total) * 100 : 0
  const isAllConfirmed = unconfirmed === 0

  const handleExportExcel = async () => {
    try {
      const XLSX = await import('xlsx')

      // 엑셀 데이터 준비
      const data = items.map((item) => {
        const noMatch = item.cj_candidates.length === 0 && item.ssg_candidates.length === 0

        return {
          '품목명': item.extracted_name,
          '규격': item.extracted_spec || '',
          '수량': item.extracted_quantity,
          '내 단가': item.extracted_unit_price,
          'CJ 매칭': item.cj_match?.product_name || (noMatch ? '견적불가' : '미선택'),
          'CJ 단가': item.cj_match?.standard_price || '',
          'SSG 매칭': item.ssg_match?.product_name || (noMatch ? '견적불가' : '미선택'),
          'SSG 단가': item.ssg_match?.standard_price || '',
          '확정여부': item.is_confirmed ? 'O' : 'X',
          '상태': noMatch ? '견적불가' : item.match_status === 'auto_matched' ? '자동' :
                   item.match_status === 'manual_matched' ? '수동' :
                   item.match_status === 'pending' ? '확인필요' : '미매칭',
        }
      })

      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '매칭결과')

      // 견적불가 항목 빨간색 스타일 적용
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        const item = items[R - 1]
        const noMatch = item.cj_candidates.length === 0 && item.ssg_candidates.length === 0

        if (noMatch) {
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C })
            if (!ws[cellAddress]) continue

            ws[cellAddress].s = {
              fill: { fgColor: { rgb: 'FFCCCC' } },
              font: { color: { rgb: 'CC0000' } }
            }
          }
        }
      }

      // 파일 다운로드
      XLSX.writeFile(wb, `${fileName}_매칭결과.xlsx`)
    } catch (error) {
      console.error('엑셀 다운로드 실패:', error)
      alert('엑셀 다운로드에 실패했습니다.')
    }
  }

  return (
    <div className="border-b bg-white p-4">
      {/* 제목 행 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{fileName}</h2>
          <p className="text-sm text-gray-500">
            매칭 결과를 확인하고 각 품목의 공급사 매칭을 확정하세요
          </p>
        </div>

        <div className="flex gap-2">
          {/* 엑셀 다운로드 버튼 */}
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Download size={18} />
            엑셀 다운로드
          </button>

          {/* 분석 완료 버튼 */}
          <button
            onClick={onProceedToReport}
            className={cn(
              'flex items-center gap-2 rounded-lg px-5 py-2.5 font-medium transition-colors',
              isAllConfirmed
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            )}
          >
            분석 완료
            <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* 진행 상황 */}
      <div className="rounded-lg bg-gray-50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isAllConfirmed ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-500" />
            )}
            <span className="font-medium text-gray-900">
              {isAllConfirmed
                ? '모든 품목 확정 완료'
                : `${formatNumber(unconfirmed)}개 품목 확정 필요`}
            </span>
          </div>

          {/* 자동매칭 전체 확정 버튼 */}
          {unconfirmed > 0 && (
            <button
              onClick={onConfirmAllAutoMatched}
              className="rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-200"
            >
              자동매칭 전체 확정
            </button>
          )}
        </div>

        {/* 진행바 */}
        <div className="relative h-2 overflow-hidden rounded-full bg-gray-200">
          <div
            className={cn(
              'absolute left-0 top-0 h-full transition-all duration-300',
              isAllConfirmed ? 'bg-green-500' : 'bg-blue-500'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 상세 통계 */}
        <div className="mt-3 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="text-gray-600">확정됨</span>
            <span className="font-medium">{formatNumber(confirmed)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-gray-300" />
            <span className="text-gray-600">미확정</span>
            <span className="font-medium">{formatNumber(unconfirmed)}</span>
          </div>
          <div className="ml-auto text-gray-500">
            총 {formatNumber(total)}개 품목
          </div>
        </div>
      </div>
    </div>
  )
}

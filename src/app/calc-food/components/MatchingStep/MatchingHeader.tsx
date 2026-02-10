'use client'

import { useState } from 'react'
import { CheckCircle, AlertCircle, ArrowRight, Download, FileCheck } from 'lucide-react'
import { formatNumber, formatCurrency } from '@/lib/format'
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
  totalPages: number
  onConfirmAllAutoMatched: () => void
  onProceedToReport: () => void
}

export function MatchingHeader({
  fileName,
  confirmationStats,
  items,
  totalPages,
  onConfirmAllAutoMatched,
  onProceedToReport,
}: MatchingHeaderProps) {
  const { total, confirmed, unconfirmed } = confirmationStats
  const progress = total > 0 ? (confirmed / total) * 100 : 0
  const isAllConfirmed = unconfirmed === 0
  const [showMissingCheck, setShowMissingCheck] = useState(false)

  // 신뢰도 90% 이상 품목 수 계산
  const highConfidenceCount = items.filter(item => {
    const hasCjHighConfidence = item.cj_match && item.cj_match.match_score >= 0.9
    const hasSsgHighConfidence = item.ssg_match && item.ssg_match.match_score >= 0.9
    return (hasCjHighConfidence || hasSsgHighConfidence) && !item.is_confirmed
  }).length

  // 합계 검증: 수량 × 단가 ≠ 금액인 품목 수 계산
  const totalMismatchCount = items.filter(item => {
    const calculatedTotal = item.extracted_quantity * item.extracted_unit_price
    const extractedTotal = item.extracted_total_price ?? calculatedTotal
    return Math.abs(calculatedTotal - extractedTotal) > 0.01
  }).length

  // 검증 완료 가능 여부: 모두 확정 + 합계 불일치 없음
  const canProceed = isAllConfirmed && totalMismatchCount === 0

  // 누락점검 계산
  const totalExtractedAmount = items.reduce(
    (sum, item) => sum + (item.extracted_unit_price * item.extracted_quantity),
    0
  )

  // 페이지별 아이템 수 계산
  const itemsPerPage = new Map<number, number>()
  items.forEach(item => {
    // item.id는 "page1-0", "page1-1" 형식이라고 가정
    const pageMatch = item.id.match(/page(\d+)/)
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1])
      itemsPerPage.set(pageNum, (itemsPerPage.get(pageNum) || 0) + 1)
    }
  })

  const pagesWithoutItems = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(page => !itemsPerPage.has(page))

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
          {/* 누락점검 버튼 */}
          <button
            onClick={() => setShowMissingCheck(true)}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-4 py-2.5 font-medium transition-colors',
              pagesWithoutItems.length > 0
                ? 'border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                : 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
            )}
          >
            <FileCheck size={18} />
            누락점검
          </button>

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
            disabled={!canProceed}
            className={cn(
              'flex items-center gap-2 rounded-lg px-5 py-2.5 font-medium transition-colors',
              canProceed
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            )}
            title={!canProceed && totalMismatchCount > 0 ? `합계 불일치 ${totalMismatchCount}개 품목 확인 필요` : undefined}
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
            {canProceed ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <AlertCircle className="h-5 w-5 text-yellow-500" />
            )}
            <span className="font-medium text-gray-900">
              {canProceed
                ? '검증 완료 - 분석 진행 가능'
                : totalMismatchCount > 0
                  ? `${formatNumber(totalMismatchCount)}개 품목 합계 불일치 확인 필요`
                  : `${formatNumber(unconfirmed)}개 품목 확정 필요`}
            </span>
          </div>

          {/* 일괄 자동 확정 버튼 (90% 이상) */}
          {highConfidenceCount > 0 && (
            <button
              onClick={onConfirmAllAutoMatched}
              className="rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-200"
            >
              일괄 자동 확정 ({highConfidenceCount}개, 90% 이상)
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
          {totalMismatchCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-red-600">합계 불일치</span>
              <span className="font-medium text-red-600">{formatNumber(totalMismatchCount)}</span>
            </div>
          )}
          <div className="ml-auto text-gray-500">
            총 {formatNumber(total)}개 품목
          </div>
        </div>
      </div>

      {/* 누락점검 모달 */}
      {showMissingCheck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">누락 점검 결과</h3>
              <button
                onClick={() => setShowMissingCheck(false)}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* PDF 페이지 점검 */}
              <div className="rounded-lg border border-gray-200 p-4">
                <h4 className="mb-2 flex items-center gap-2 font-medium text-gray-900">
                  <FileCheck size={16} />
                  PDF 페이지 분석
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">총 페이지 수:</span>
                    <span className="font-medium">{totalPages}페이지</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">분석된 페이지:</span>
                    <span className="font-medium">{totalPages - pagesWithoutItems.length}페이지</span>
                  </div>
                  {pagesWithoutItems.length > 0 && (
                    <div className="mt-2 rounded bg-yellow-50 p-2">
                      <p className="font-medium text-yellow-800">
                        ⚠️ 아이템 없는 페이지: {pagesWithoutItems.join(', ')}
                      </p>
                      <p className="mt-1 text-xs text-yellow-600">
                        표지, 빈 페이지, 또는 인식 실패일 수 있습니다
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* 품목 및 총액 점검 */}
              <div className="rounded-lg border border-gray-200 p-4">
                <h4 className="mb-2 flex items-center gap-2 font-medium text-gray-900">
                  <CheckCircle size={16} />
                  품목 및 총액
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">총 품목 수:</span>
                    <span className="font-medium">{total}개</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">추출된 총액:</span>
                    <span className="font-medium">{formatCurrency(totalExtractedAmount)}</span>
                  </div>
                  <div className="mt-2 rounded bg-blue-50 p-2">
                    <p className="text-xs text-blue-600">
                      💡 명세서의 총액과 비교하여 누락 여부를 확인하세요
                    </p>
                  </div>
                </div>
              </div>

              {/* 페이지별 분포 */}
              <div className="rounded-lg border border-gray-200 p-4">
                <h4 className="mb-2 font-medium text-gray-900">페이지별 품목 수</h4>
                <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                    const count = itemsPerPage.get(page) || 0
                    return (
                      <div key={page} className="flex justify-between">
                        <span className="text-gray-600">페이지 {page}:</span>
                        <span className={cn(
                          'font-medium',
                          count === 0 ? 'text-yellow-600' : 'text-gray-900'
                        )}>
                          {count}개
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowMissingCheck(false)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

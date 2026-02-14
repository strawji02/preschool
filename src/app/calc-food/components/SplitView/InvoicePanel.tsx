'use client'

import { useEffect, useRef } from 'react'
import { Check, AlertCircle, Clock, FileText } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import type { ComparisonItem, SupplierMatch } from '@/types/audit'

// 단위를 g으로 변환
function unitToGrams(unit: string): number {
  const u = unit.toUpperCase()
  if (u === 'KG') return 1000
  if (u === 'G') return 1
  if (u === 'L') return 1000 // 1L ≈ 1kg
  if (u === 'ML') return 1
  return 1
}

// 규격에서 수량과 단위 파싱 (예: "2KG/상" → { quantity: 2, unit: "KG" })
function parseSpec(spec: string | undefined): { quantity: number; unit: string } | null {
  if (!spec) return null
  
  // 패턴: 숫자 + 단위 (KG, G, L, ML 등)
  const match = spec.match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML)/i)
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2].toUpperCase(),
    }
  }
  return null
}

// 동행 총 수량(g) 계산
function calculateInvoiceTotalGrams(item: ComparisonItem): number {
  const specParsed = parseSpec(item.extracted_spec)
  if (specParsed) {
    return specParsed.quantity * unitToGrams(specParsed.unit) * item.extracted_quantity
  }
  // 파싱 실패 시 CJ나 신세계 규격 기준으로 추정
  const match = item.cj_match || item.ssg_match
  if (match?.spec_quantity && match?.spec_unit) {
    return match.spec_quantity * unitToGrams(match.spec_unit) * item.extracted_quantity
  }
  return item.extracted_quantity // fallback
}

// 공급사 필요 수량 계산 (올림)
function calculateSupplierQuantity(invoiceTotalGrams: number, match: SupplierMatch): number {
  if (!match.spec_quantity || !match.spec_unit) return 1
  const matchGrams = match.spec_quantity * unitToGrams(match.spec_unit)
  return Math.ceil(invoiceTotalGrams / matchGrams)
}

// 동행 총 수량 포맷팅 (예: "2kg")
function formatInvoiceTotalQuantity(item: ComparisonItem): string {
  const specParsed = parseSpec(item.extracted_spec)
  if (specParsed) {
    const total = specParsed.quantity * item.extracted_quantity
    return `${total}${specParsed.unit.toLowerCase()}`
  }
  const match = item.cj_match || item.ssg_match
  if (match?.spec_quantity && match?.spec_unit) {
    const total = match.spec_quantity * item.extracted_quantity
    return `${total}${match.spec_unit.toLowerCase()}`
  }
  return '-'
}

interface InvoicePanelProps {
  items: ComparisonItem[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  isFocused: boolean
  onViewPdf?: (itemIndex: number) => void // PDF 보기 콜백
  hasPdfPages?: boolean // PDF 페이지가 있는지 여부
}

export function InvoicePanel({
  items,
  selectedIndex,
  onSelectIndex,
  isFocused,
  onViewPdf,
  hasPdfPages = false,
}: InvoicePanelProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLDivElement>(null)

  // 선택된 항목이 보이도록 스크롤
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      const container = listRef.current
      const element = selectedRef.current
      const containerRect = container.getBoundingClientRect()
      const elementRect = element.getBoundingClientRect()

      if (elementRect.top < containerRect.top) {
        element.scrollIntoView({ block: 'start', behavior: 'smooth' })
      } else if (elementRect.bottom > containerRect.bottom) {
        element.scrollIntoView({ block: 'end', behavior: 'smooth' })
      }
    }
  }, [selectedIndex])

  // 상태 아이콘
  const getStatusIcon = (item: ComparisonItem) => {
    if (item.is_confirmed) {
      return <Check size={16} className="text-green-500" />
    }
    if (item.match_status === 'pending') {
      return <AlertCircle size={16} className="text-amber-500" />
    }
    if (item.match_status === 'unmatched') {
      return <Clock size={16} className="text-gray-400" />
    }
    return <Clock size={16} className="text-blue-500" />
  }

  // 상태 배경색
  const getStatusBg = (item: ComparisonItem, isSelected: boolean) => {
    if (isSelected) {
      return isFocused
        ? 'bg-blue-100 border-blue-500'
        : 'bg-blue-50 border-blue-300'
    }
    if (item.is_confirmed) {
      return 'bg-green-50/50 border-transparent'
    }
    if (item.match_status === 'pending') {
      return 'bg-amber-50/50 border-transparent'
    }
    return 'bg-white border-transparent'
  }

  return (
    <div className="flex h-full flex-col">
      {/* 헤더 */}
      <div className="border-b bg-gray-50 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-800">📄 거래명세서</h2>
        <p className="text-sm text-gray-500">
          ↑↓ 키로 이동 • Enter로 확정 • Tab으로 패널 전환
        </p>
      </div>

      {/* 테이블 헤더 */}
      <div className="grid grid-cols-[40px_1fr_120px_100px_70px_40px_40px] gap-2 border-b bg-gray-100 px-4 py-2 text-sm font-medium text-gray-600">
        <div className="text-center">No</div>
        <div>품명 / 규격</div>
        <div className="text-right">단가 및 수량</div>
        <div className="text-right">총액</div>
        <div className="text-center">(총수량)</div>
        <div className="text-center">원본</div>
        <div className="text-center">상태</div>
      </div>

      {/* 품목 리스트 */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex

          return (
            <div
              key={item.id}
              ref={isSelected ? selectedRef : null}
              onClick={() => onSelectIndex(index)}
              className={cn(
                'cursor-pointer border-b-2 px-4 py-3 transition-all',
                getStatusBg(item, isSelected),
                isSelected && 'ring-1 ring-inset',
                !isSelected && 'hover:bg-gray-50'
              )}
            >
              {/* 상단 그리드 행 */}
              <div className="grid grid-cols-[40px_1fr_120px_100px_70px_40px_40px] gap-2">
                {/* No */}
                <div className="flex items-center justify-center">
                  <span className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium',
                    isSelected
                      ? 'bg-blue-600 text-white'
                      : item.is_confirmed
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                  )}>
                    {index + 1}
                  </span>
                </div>

                {/* 품명 / 규격 */}
                <div className="min-w-0">
                  <p className={cn(
                    'truncate font-medium',
                    isSelected ? 'text-blue-900' : 'text-gray-900'
                  )}>
                    {item.extracted_name}
                  </p>
                  {item.extracted_spec && (
                    <p className="truncate text-sm text-gray-500">
                      {item.extracted_spec}
                    </p>
                  )}
                </div>

                {/* 단가 및 수량 */}
                <div className="flex flex-col items-end justify-center">
                  <span className="font-medium text-gray-900">
                    {formatCurrency(item.extracted_unit_price)}
                  </span>
                  <span className="text-xs text-gray-500">
                    ×{item.extracted_quantity}
                  </span>
                </div>

                {/* 총액 */}
                <div className="flex items-center justify-end">
                  <span className="font-medium text-gray-900">
                    {formatCurrency(item.extracted_unit_price * item.extracted_quantity)}
                  </span>
                </div>

                {/* 총수량 */}
                <div className="flex items-center justify-center text-sm text-gray-600">
                  ({formatInvoiceTotalQuantity(item)})
                </div>

                {/* 원본 보기 버튼 */}
                <div className="flex items-center justify-center">
                  {onViewPdf && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onViewPdf(index)
                      }}
                      className="rounded p-1.5 text-gray-500 hover:bg-blue-100 hover:text-blue-600"
                      title="원본 보기"
                    >
                      <FileText size={16} />
                    </button>
                  )}
                </div>

                {/* 상태 */}
                <div className="flex items-center justify-center">
                  {getStatusIcon(item)}
                </div>
              </div>

              {/* 3줄 비교 표시 (상세 내용) */}
              {(() => {
                const invoiceTotalGrams = calculateInvoiceTotalGrams(item)
                const invoiceTotalFormatted = formatInvoiceTotalQuantity(item)
                
                const cjQty = item.cj_match ? calculateSupplierQuantity(invoiceTotalGrams, item.cj_match) : 0
                const cjTotal = item.cj_match ? item.cj_match.standard_price * cjQty : 0
                const cjTotalQty = item.cj_match?.spec_quantity ? item.cj_match.spec_quantity * cjQty : 0
                
                const ssgQty = item.ssg_match ? calculateSupplierQuantity(invoiceTotalGrams, item.ssg_match) : 0
                const ssgTotal = item.ssg_match ? item.ssg_match.standard_price * ssgQty : 0
                const ssgTotalQty = item.ssg_match?.spec_quantity ? item.ssg_match.spec_quantity * ssgQty : 0

                return (
                  <div className="ml-12 mt-2 space-y-1 text-sm">
                    {/* 동행 (원본) */}
                    <p className="text-gray-700">
                      <span className="font-medium text-gray-900">동행</span>
                      {' - '}
                      {item.extracted_name}
                      {' : '}
                      {formatCurrency(item.extracted_unit_price)} x {item.extracted_quantity}
                      {' = '}
                      {formatCurrency(item.extracted_unit_price * item.extracted_quantity)}원
                      <span className="text-gray-500">
                        {' '}({invoiceTotalFormatted})
                      </span>
                    </p>

                    {/* CJ */}
                    {item.cj_match ? (
                      <p className="text-orange-600">
                        <span className="font-medium">CJ</span>
                        {' - '}
                        {item.cj_match.product_name}
                        {' : '}
                        {formatCurrency(item.cj_match.standard_price)}
                        {' x '}
                        {cjQty}
                        {' = '}
                        {formatCurrency(cjTotal)}원
                        {item.cj_match.spec_unit && (
                          <span className="text-orange-400">
                            {' '}({cjTotalQty}{item.cj_match.spec_unit.toLowerCase()})
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-gray-400">CJ - 매칭 없음</p>
                    )}

                    {/* 신세계 */}
                    {item.ssg_match ? (
                      <p className="text-green-600">
                        <span className="font-medium">신세계</span>
                        {' - '}
                        {item.ssg_match.product_name}
                        {' : '}
                        {formatCurrency(item.ssg_match.standard_price)}
                        {' x '}
                        {ssgQty}
                        {' = '}
                        {formatCurrency(ssgTotal)}원
                        {item.ssg_match.spec_unit && (
                          <span className="text-green-400">
                            {' '}({ssgTotalQty}{item.ssg_match.spec_unit.toLowerCase()})
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-gray-400">신세계 - 매칭 없음</p>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })}

        {items.length === 0 && (
          <div className="flex h-32 items-center justify-center text-gray-500">
            품목이 없습니다
          </div>
        )}
      </div>
    </div>
  )
}

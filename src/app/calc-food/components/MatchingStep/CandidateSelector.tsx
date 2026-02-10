'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { SupplierMatch, Supplier } from '@/types/audit'
import { type NormalizedUnit } from '@/lib/unitConversion'
import { convertPriceUnified, type ConversionResult } from '@/lib/unitConversionUnified'

interface CandidateSelectorProps {
  supplier: Supplier
  candidates: SupplierMatch[]
  selectedMatch?: SupplierMatch
  onSelect: (candidate: SupplierMatch) => void
  onSearchClick: () => void
  disabled?: boolean
  userUnit?: NormalizedUnit
  userQuantity?: number
}

export function CandidateSelector({
  supplier,
  candidates,
  selectedMatch,
  onSelect,
  onSearchClick,
  disabled,
  userUnit = 'g',
  userQuantity = 1,
}: CandidateSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [conversionCache, setConversionCache] = useState<Record<string, ConversionResult>>({})

  // 비동기 환산 가격 계산
  useEffect(() => {
    const loadConversions = async () => {
      const cache: Record<string, ConversionResult> = {}

      for (const candidate of candidates) {
        if (candidate.unit_normalized) {
          cache[candidate.id] = await convertPriceUnified(
            candidate.standard_price,
            candidate.unit_normalized,
            userUnit,
            userQuantity,
            candidate.category
          )
        }
      }

      // Also convert selected match if it exists
      if (selectedMatch && selectedMatch.unit_normalized) {
        cache[selectedMatch.id] = await convertPriceUnified(
          selectedMatch.standard_price,
          selectedMatch.unit_normalized,
          userUnit,
          userQuantity,
          selectedMatch.category
        )
      }

      setConversionCache(cache)
    }

    loadConversions()
  }, [candidates, selectedMatch, userUnit, userQuantity])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isCJ = supplier === 'CJ'
  const colorClass = isCJ ? 'orange' : 'purple'

  // 후보가 없으면 검색 버튼 표시
  if (candidates.length === 0) {
    return (
      <button
        onClick={onSearchClick}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors',
          'bg-gray-100 text-gray-600 hover:bg-gray-200',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <Search size={12} />
        검색
      </button>
    )
  }

  // "없음" 선택 여부 확인
  const isNoneSelected = selectedMatch?.id === 'NONE'

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          'flex min-w-[100px] flex-col items-start gap-0.5 rounded px-2 py-1 text-sm transition-colors',
          isNoneSelected
            ? 'bg-red-50 hover:bg-red-100'
            : selectedMatch
            ? `bg-${colorClass}-50 hover:bg-${colorClass}-100`
            : 'bg-gray-100 hover:bg-gray-200',
          disabled && 'cursor-not-allowed opacity-50'
        )}
        style={{
          backgroundColor: isNoneSelected
            ? 'rgb(254 242 242)'
            : selectedMatch
            ? (isCJ ? 'rgb(255 247 237)' : 'rgb(250 245 255)')
            : undefined,
        }}
      >
        <div className="flex w-full items-center justify-between">
          <span className={cn(
            'truncate font-medium',
            isNoneSelected
              ? 'text-red-700'
              : selectedMatch && (isCJ ? 'text-orange-700' : 'text-purple-700')
          )}>
            {isNoneSelected
              ? '없음'
              : selectedMatch
              ? `${formatCurrency(selectedMatch.standard_price)}${selectedMatch.unit_normalized ? '/' + selectedMatch.unit_normalized : ''}`
              : '선택'}
          </span>
          <ChevronDown size={14} className={cn('transition-transform', isOpen && 'rotate-180')} />
        </div>
        {/* 환산가 표시 */}
        {selectedMatch && !isNoneSelected && selectedMatch.unit_normalized && (() => {
          const result = conversionCache[selectedMatch.id] || {
            success: false,
            convertedPrice: null,
            method: 'failed' as const,
            message: '계산중...'
          }
          return (
            <span className="text-xs text-gray-500">
              → {userQuantity}{userUnit} 기준: {
                result.success
                  ? formatCurrency(result.convertedPrice!)
                  : result.message
              }
              {result.method === 'db' && <span className="ml-1 text-green-600" title="DB 환산">✓</span>}
              {result.method === 'basic' && <span className="ml-1 text-blue-600" title="기본 환산">~</span>}
            </span>
          )
        })()}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border bg-white shadow-lg">
          <div className="max-h-60 overflow-y-auto p-1">
            {/* "없음" 옵션 추가 */}
            <button
              onClick={() => {
                onSelect({ id: 'NONE', product_name: '없음', standard_price: 0, match_score: 0, unit_normalized: '' } as SupplierMatch)
                setIsOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-red-50"
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-xs text-red-700">
                ✕
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-red-700">없음 (점검필요)</p>
                <p className="text-xs text-red-500">해당 공급사에 매칭 불가</p>
              </div>
            </button>

            {candidates.map((candidate, index) => {
              const isSelected = selectedMatch?.id === candidate.id
              return (
                <button
                  key={candidate.id}
                  onClick={() => {
                    onSelect(candidate)
                    setIsOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
                    isSelected
                      ? (isCJ ? 'bg-orange-100' : 'bg-purple-100')
                      : 'hover:bg-gray-100'
                  )}
                >
                  <div className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs',
                    isSelected
                      ? (isCJ ? 'bg-orange-500 text-white' : 'bg-purple-500 text-white')
                      : 'bg-gray-200 text-gray-600'
                  )}>
                    {isSelected ? <Check size={12} /> : index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {candidate.product_name}
                    </p>
                    <div className="flex flex-col gap-0.5 text-xs">
                      <div className="flex items-center gap-2 text-gray-500">
                        <span className="font-medium text-gray-700">
                          {formatCurrency(candidate.standard_price)}
                          {candidate.unit_normalized && (
                            <span className="text-gray-500">/{candidate.unit_normalized}</span>
                          )}
                        </span>
                        <span>
                          {Math.round(candidate.match_score * 100)}% 일치
                        </span>
                      </div>
                      {/* 환산가 표시 */}
                      {candidate.unit_normalized && (() => {
                        const result = conversionCache[candidate.id] || {
                          success: false,
                          convertedPrice: null,
                          method: 'failed' as const,
                          message: '계산중...'
                        }
                        return (
                          <span className={cn('font-medium', isCJ ? 'text-orange-600' : 'text-purple-600')}>
                            → {userQuantity}{userUnit}: {
                              result.success
                                ? formatCurrency(result.convertedPrice!)
                                : result.message
                            }
                            {result.method === 'db' && <span className="ml-1 text-green-600" title="DB 환산">✓</span>}
                            {result.method === 'basic' && <span className="ml-1 text-blue-600" title="기본 환산">~</span>}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* 직접 검색 버튼 */}
          <div className="border-t p-1">
            <button
              onClick={() => {
                setIsOpen(false)
                onSearchClick()
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-blue-600 hover:bg-blue-50"
            >
              <Search size={14} />
              다른 상품 검색
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

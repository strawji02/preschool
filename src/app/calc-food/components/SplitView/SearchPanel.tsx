'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Loader2, Check, Star, ArrowRight, RotateCcw, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { calculatePricePerUnit } from '@/lib/funnel/price-normalizer'
import type { ComparisonItem, SupplierMatch, MatchCandidate } from '@/types/audit'

interface SearchPanelProps {
  item: ComparisonItem | null
  isFocused: boolean
  onSelectProduct: (product: SupplierMatch) => void
  onConfirmItem?: () => void // 확정 콜백 추가
  selectedResultIndex: number
  onSelectResultIndex: (index: number) => void
}

// 단위를 g으로 변환
function unitToGrams(unit: string): number {
  const u = unit.toUpperCase()
  if (u === 'KG') return 1000
  if (u === 'G') return 1
  if (u === 'L') return 1000
  if (u === 'ML') return 1
  return 1
}

// 규격에서 수량과 단위 파싱
function parseSpec(spec: string | undefined): { quantity: number; unit: string } | null {
  if (!spec) return null
  const match = spec.match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML)/i)
  if (match) {
    return { quantity: parseFloat(match[1]), unit: match[2].toUpperCase() }
  }
  return null
}

// 동행 총 수량(g) 계산
function calculateInvoiceTotalGrams(item: ComparisonItem): number {
  const specParsed = parseSpec(item.extracted_spec)
  if (specParsed) {
    return specParsed.quantity * unitToGrams(specParsed.unit) * item.extracted_quantity
  }
  const match = item.cj_match || item.ssg_match
  if (match?.spec_quantity && match?.spec_unit) {
    return match.spec_quantity * unitToGrams(match.spec_unit) * item.extracted_quantity
  }
  return item.extracted_quantity
}

// 동행 총 수량 포맷팅
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
  return `${item.extracted_quantity}`
}

// 공급사 필요 수량 계산 (올림)
function calculateSupplierQuantity(invoiceTotalGrams: number, match: SupplierMatch): number {
  if (!match.spec_quantity || !match.spec_unit) return 1
  const matchGrams = match.spec_quantity * unitToGrams(match.spec_unit)
  return Math.ceil(invoiceTotalGrams / matchGrams)
}

export function SearchPanel({
  item,
  isFocused,
  onSelectProduct,
  onConfirmItem,
  selectedResultIndex,
  onSelectResultIndex,
}: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<MatchCandidate[]>([])
  const [sortBy, setSortBy] = useState<'score' | 'price' | 'pricePerGram'>('score')
  const [supplier, setSupplier] = useState<'CJ' | 'SHINSEGAE'>('CJ')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // AI 추출 키워드로 검색어 초기화
  useEffect(() => {
    if (item) {
      const keyword = extractSearchKeyword(item.extracted_name)
      setQuery(keyword)
      performSearch(keyword)
    } else {
      setQuery('')
      setResults([])
    }
  }, [item?.id])

  // 포커스 시 입력창에 포커스
  useEffect(() => {
    if (isFocused && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isFocused])

  // AI 키워드 추출 (간단한 휴리스틱)
  const extractSearchKeyword = (name: string): string => {
    // 브랜드명, 괄호 내용 제거
    let keyword = name
      .replace(/\([^)]*\)/g, '') // 괄호 제거
      .replace(/\[[^\]]*\]/g, '') // 대괄호 제거
      .replace(/친환경|무농약|유기농|국내산|수입산/g, '') // 수식어 제거
      .replace(/\s+/g, ' ')
      .trim()

    // 너무 짧으면 원본 사용
    if (keyword.length < 2) {
      keyword = name.split(' ')[0] || name
    }

    return keyword
  }

  // 검색 실행
  const performSearch = async (searchQuery: string, targetSupplier?: 'CJ' | 'SHINSEGAE') => {
    if (!searchQuery.trim() || !item) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        supplier: targetSupplier || supplier,
        limit: '20',
      })

      const res = await fetch(`/api/products/search?${params}`)
      const data = await res.json()

      if (data.success) {
        setResults(data.products)
        onSelectResultIndex(0) // 첫 번째 결과 선택
      }
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // 검색어 변경 핸들러
  const handleSearch = useCallback(() => {
    performSearch(query)
  }, [query, item])

  // 검색어 초기화 (Esc)
  const handleReset = () => {
    if (item) {
      const keyword = extractSearchKeyword(item.extracted_name)
      setQuery(keyword)
      performSearch(keyword)
    }
  }

  // 상품 선택
  const handleSelect = (product: MatchCandidate) => {
    const supplierMatch: SupplierMatch = {
      id: product.id,
      product_name: product.product_name,
      standard_price: product.standard_price,
      match_score: product.match_score,
      unit_normalized: product.unit_normalized,
      spec_quantity: product.spec_quantity,
      spec_unit: product.spec_unit,
    }
    onSelectProduct(supplierMatch)
  }

  // g당 단가 계산
  const getPricePerGram = (product: MatchCandidate): number | null => {
    if (!product.unit_normalized) return null
    const result = calculatePricePerUnit(product.standard_price, product.unit_normalized)
    return result?.pricePerUnit ?? null
  }

  // 정렬된 결과
  const sortedResults = [...results].sort((a, b) => {
    switch (sortBy) {
      case 'price':
        return a.standard_price - b.standard_price
      case 'pricePerGram':
        const ppgA = getPricePerGram(a) ?? Infinity
        const ppgB = getPricePerGram(b) ?? Infinity
        return ppgA - ppgB
      default:
        return b.match_score - a.match_score
    }
  })

  // AI 추천 TOP 3 (g당 단가 기준)
  const top3Recommendations = [...results]
    .map(r => ({ ...r, pricePerGram: getPricePerGram(r) }))
    .filter(r => r.pricePerGram !== null)
    .sort((a, b) => (a.pricePerGram || 0) - (b.pricePerGram || 0))
    .slice(0, 3)

  // 절감액 계산
  const calculateSavings = (product: MatchCandidate) => {
    if (!item) return null
    const diff = item.extracted_unit_price - product.standard_price
    if (diff <= 0) return null
    return {
      perUnit: diff,
      total: diff * item.extracted_quantity,
    }
  }

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500">
        <p>좌측에서 품목을 선택하세요</p>
      </div>
    )
  }

  // 공급사 탭 변경
  const handleSupplierChange = (newSupplier: 'CJ' | 'SHINSEGAE') => {
    setSupplier(newSupplier)
    if (query) {
      performSearch(query, newSupplier)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* 공급사 탭 */}
      <div className="flex border-b">
        <button
          onClick={() => handleSupplierChange('CJ')}
          className={cn(
            'flex-1 py-3 text-center font-medium transition-colors',
            supplier === 'CJ'
              ? 'bg-orange-100 text-orange-800 border-b-2 border-orange-500'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
          )}
        >
          🏢 CJ
        </button>
        <button
          onClick={() => handleSupplierChange('SHINSEGAE')}
          className={cn(
            'flex-1 py-3 text-center font-medium transition-colors',
            supplier === 'SHINSEGAE'
              ? 'bg-green-100 text-green-800 border-b-2 border-green-500'
              : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
          )}
        >
          🛒 신세계
        </button>
      </div>

      {/* 헤더 */}
      <div className={cn(
        'border-b px-4 py-3',
        supplier === 'CJ' ? 'bg-orange-50' : 'bg-green-50'
      )}>
        <div className="flex items-center justify-between">
          <h2 className={cn(
            'text-lg font-semibold',
            supplier === 'CJ' ? 'text-orange-800' : 'text-green-800'
          )}>
            🔍 {supplier === 'CJ' ? 'CJ' : '신세계'} 스마트 검색
          </h2>
          <div className={cn(
            'text-sm',
            supplier === 'CJ' ? 'text-orange-600' : 'text-green-600'
          )}>
            현재 단가: <span className="font-bold">{formatCurrency(item.extracted_unit_price)}</span>
          </div>
        </div>
        {/* 검색 대상: 동행 정보 표시 */}
        <p className={cn(
          'mt-1 text-sm',
          supplier === 'CJ' ? 'text-orange-600' : 'text-green-600'
        )}>
          검색 대상: <span className="font-medium">동행 - {item.extracted_name}</span>
          {' : '}
          {formatCurrency(item.extracted_unit_price)} x {item.extracted_quantity}
          {' = '}
          {formatCurrency(item.extracted_unit_price * item.extracted_quantity)}원
          {' '}({formatInvoiceTotalQuantity(item)})
        </p>
      </div>

      {/* 선택된 품목 영역 */}
      {(() => {
        const currentMatch = supplier === 'CJ' ? item.cj_match : item.ssg_match
        if (!currentMatch) return null

        const invoiceTotalGrams = calculateInvoiceTotalGrams(item)
        const supplierQty = calculateSupplierQuantity(invoiceTotalGrams, currentMatch)
        const supplierTotal = currentMatch.standard_price * supplierQty
        const supplierTotalQty = (currentMatch.spec_quantity || 1) * supplierQty

        return (
          <div className={cn(
            'border-b p-4',
            supplier === 'CJ' ? 'bg-orange-100' : 'bg-green-100'
          )}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle size={18} className={supplier === 'CJ' ? 'text-orange-600' : 'text-green-600'} />
                <span className="font-semibold text-gray-800">선택된 품목</span>
              </div>
              {onConfirmItem && !item.is_confirmed && (
                <button
                  onClick={onConfirmItem}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
                    supplier === 'CJ'
                      ? 'bg-orange-600 hover:bg-orange-700'
                      : 'bg-green-600 hover:bg-green-700'
                  )}
                >
                  ✓ 확정
                </button>
              )}
              {item.is_confirmed && (
                <span className="rounded-lg bg-green-500 px-3 py-1 text-sm font-medium text-white">
                  ✓ 확정됨
                </span>
              )}
            </div>
            <div className={cn(
              'mt-2 rounded-lg border-2 bg-white p-3',
              supplier === 'CJ' ? 'border-orange-300' : 'border-green-300'
            )}>
              <p className={cn(
                'font-medium',
                supplier === 'CJ' ? 'text-orange-700' : 'text-green-700'
              )}>
                {supplier === 'CJ' ? 'CJ' : '신세계'} - {currentMatch.product_name}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {formatCurrency(currentMatch.standard_price)} x {supplierQty}
                {' = '}
                <span className="font-semibold">{formatCurrency(supplierTotal)}원</span>
                {currentMatch.spec_unit && (
                  <span className="text-gray-500">
                    {' '}({supplierTotalQty}{currentMatch.spec_unit.toLowerCase()})
                  </span>
                )}
              </p>
            </div>
          </div>
        )
      })()}

      {/* 검색창 */}
      <div className="border-b bg-white p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSearch()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  handleReset()
                }
              }}
              placeholder="검색어 입력..."
              className={cn(
                'w-full rounded-lg border py-2 pl-10 pr-4 focus:outline-none focus:ring-2',
                isFocused
                  ? 'border-orange-400 focus:ring-orange-200'
                  : 'border-gray-300 focus:ring-blue-200'
              )}
            />
          </div>

          <button
            onClick={handleReset}
            className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
            title="검색어 초기화 (Esc)"
          >
            <RotateCcw size={18} />
          </button>

          <button
            onClick={handleSearch}
            disabled={isLoading}
            className="flex items-center gap-2 rounded-lg bg-orange-500 px-4 py-2 text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            검색
          </button>
        </div>
      </div>

      {/* AI 추천 TOP 3 */}
      {top3Recommendations.length > 0 && (
        <div className="border-b bg-gradient-to-r from-yellow-50 to-orange-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Star size={18} className="text-yellow-500" />
            <h3 className="font-semibold text-gray-800">AI 추천 TOP 3</h3>
            <span className="text-xs text-gray-500">(g당 단가 기준)</span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {top3Recommendations.map((product, idx) => {
              const savings = calculateSavings(product)
              const isSelected = results.findIndex(r => r.id === product.id) === selectedResultIndex

              return (
                <div
                  key={product.id}
                  onClick={() => handleSelect(product)}
                  className={cn(
                    'cursor-pointer rounded-lg border-2 bg-white p-3 transition-all hover:shadow-md',
                    isSelected
                      ? 'border-orange-500 ring-2 ring-orange-200'
                      : 'border-gray-200 hover:border-orange-300',
                    idx === 0 && 'ring-2 ring-yellow-300'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-bold',
                      idx === 0
                        ? 'bg-yellow-400 text-yellow-900'
                        : 'bg-gray-100 text-gray-600'
                    )}>
                      #{idx + 1}
                    </span>
                    {savings && (
                      <span className="text-xs font-medium text-green-600">
                        -{formatCurrency(savings.total)}
                      </span>
                    )}
                  </div>

                  <p className="mt-2 line-clamp-2 text-sm font-medium text-gray-900">
                    {product.product_name}
                  </p>

                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-lg font-bold text-orange-600">
                      {formatCurrency(product.standard_price)}
                    </span>
                    {product.pricePerGram && (
                      <span className="text-xs text-gray-500">
                        {product.pricePerGram.toFixed(1)}원/g
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-gray-500">
                    {product.unit_normalized}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 정렬 옵션 */}
      <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-2">
        <span className="text-sm text-gray-600">
          검색 결과 <span className="font-semibold">{results.length}</span>건
        </span>
        <div className="flex gap-1">
          {[
            { key: 'score', label: '일치율순' },
            { key: 'price', label: '가격순' },
            { key: 'pricePerGram', label: 'g당 단가순' },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setSortBy(opt.key as typeof sortBy)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                sortBy === opt.key
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 검색 결과 리스트 */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            <Loader2 size={24} className="animate-spin" />
            <span className="ml-2">검색 중...</span>
          </div>
        ) : sortedResults.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-gray-500">
            검색 결과가 없습니다
          </div>
        ) : (
          sortedResults.map((product, idx) => {
            const savings = calculateSavings(product)
            const pricePerGram = getPricePerGram(product)
            const isSelected = idx === selectedResultIndex

            return (
              <div
                key={`${product.id}-${idx}`}
                onClick={() => handleSelect(product)}
                className={cn(
                  'flex cursor-pointer items-center justify-between border-b px-4 py-3 transition-colors',
                  isSelected
                    ? 'bg-orange-100'
                    : savings
                      ? 'bg-green-50/50 hover:bg-orange-50'
                      : 'hover:bg-orange-50'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-xs font-medium',
                      supplier === 'CJ'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-green-100 text-green-700'
                    )}>
                      {supplier === 'CJ' ? 'CJ' : '신세계'}
                    </span>
                    <span className="truncate font-medium text-gray-900">
                      {product.product_name}
                    </span>
                    <span className="text-xs text-gray-400">
                      ({Math.round(product.match_score * 100)}%)
                    </span>
                  </div>

                  <div className="mt-1 flex items-center gap-4 text-sm text-gray-500">
                    <span>{product.unit_normalized}</span>
                    {pricePerGram && (
                      <span className="text-xs">
                        {pricePerGram.toFixed(1)}원/g
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-semibold text-gray-900">
                      {formatCurrency(product.standard_price)}
                    </p>
                    {savings ? (
                      <p className="text-sm font-medium text-green-600">
                        -{formatCurrency(savings.total)} 절감
                      </p>
                    ) : (
                      <p className="text-xs text-gray-400">절감 없음</p>
                    )}
                  </div>

                  <button
                    className={cn(
                      'rounded-lg p-2 transition-colors',
                      isSelected
                        ? 'bg-orange-500 text-white'
                        : 'bg-orange-100 text-orange-600 hover:bg-orange-200'
                    )}
                  >
                    {isSelected ? <Check size={18} /> : <ArrowRight size={18} />}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

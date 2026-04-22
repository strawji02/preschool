'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Loader2, Check, Star, ArrowRight, RotateCcw, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { calculatePricePerUnit } from '@/lib/funnel/price-normalizer'
import type { ComparisonItem, SupplierMatch, MatchCandidate } from '@/types/audit'
import { FEATURE_FLAGS } from '../../config'

interface SearchPanelProps {
  item: ComparisonItem | null
  isFocused: boolean
  onSelectProduct: (product: SupplierMatch, supplier: 'CJ' | 'SHINSEGAE', itemId: string) => void // itemId 추가
  onConfirmItem?: (itemId: string, supplier?: 'CJ' | 'SHINSEGAE') => void // 확정 콜백 (supplier 추가)
  onClearMatch?: (supplier: 'CJ' | 'SHINSEGAE') => void // 변경(매칭 제거) 콜백 (supplier 추가)
  onMoveToNext?: () => void // 다음 품목으로 이동
  selectedResultIndex: number
  onSelectResultIndex: (index: number) => void
  invoiceSupplierName?: string // 파일명에서 추출한 공급업체명
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
// 예: "2KG/상" → { quantity: 2, unit: 'KG' }
// 예: "KG/톡" → { quantity: 1, unit: 'KG' } (숫자 없으면 1로 간주)
function parseSpec(spec: string | undefined): { quantity: number; unit: string } | null {
  if (!spec) return null
  
  // 먼저 숫자+단위 패턴 시도 (예: 2KG, 500G)
  const matchWithNumber = spec.match(/(\d+(?:\.\d+)?)\s*(KG|G|L|ML)/i)
  if (matchWithNumber) {
    return { quantity: parseFloat(matchWithNumber[1]), unit: matchWithNumber[2].toUpperCase() }
  }
  
  // 숫자 없이 단위만 있는 경우 (예: KG/톡, KG, "KG,상") → quantity = 1
  const matchUnitOnly = spec.match(/^(KG|G|L|ML)(?:[,\/\s]|$)/i)
  if (matchUnitOnly) {
    return { quantity: 1, unit: matchUnitOnly[1].toUpperCase() }
  }
  
  return null
}

// 묶음 수량 추출 (별도 함수 - 기존 로직에 영향 없음)
// 예: "65ML*5EA" → 5, "2KG/상" → 1
function getPackSize(spec: string | undefined): number {
  if (!spec) return 1
  // 패턴: *5EA, ×5, *5입, *5개, X5 등
  const packMatch = spec.match(/[*×xX]\s*(\d+)\s*(EA|입|개)?/i)
  return packMatch ? parseInt(packMatch[1]) : 1
}

// 동행 총 수량(g) 계산 - supplier 파라미터 추가
function calculateInvoiceTotalGrams(item: ComparisonItem, supplier: 'CJ' | 'SHINSEGAE'): number {
  const specParsed = parseSpec(item.extracted_spec)
  if (specParsed) {
    const packSize = getPackSize(item.extracted_spec)
    // 묶음 수량이 있으면 적용, 없으면 기존 로직 (packSize = 1)
    return specParsed.quantity * unitToGrams(specParsed.unit) * packSize * item.extracted_quantity
  }
  // 현재 supplier에 맞는 match 사용
  const match = supplier === 'CJ' ? item.cj_match : item.ssg_match
  if (match?.spec_quantity && match?.spec_unit) {
    return match.spec_quantity * unitToGrams(match.spec_unit) * item.extracted_quantity
  }
  return item.extracted_quantity
}

// 동행 총 수량 포맷팅 (1kg 미만은 g으로 표시)
function formatInvoiceTotalQuantity(item: ComparisonItem): string {
  const specParsed = parseSpec(item.extracted_spec)
  if (specParsed) {
    const packSize = getPackSize(item.extracted_spec)
    const total = specParsed.quantity * packSize * item.extracted_quantity
    const unit = specParsed.unit.toUpperCase()

    // KG이고 1 미만이면 g으로 변환
    if (unit === 'KG' && total < 1) {
      return `${total * 1000}g`
    }
    // L이고 1 미만이면 ml로 변환
    if (unit === 'L' && total < 1) {
      return `${total * 1000}ml`
    }

    return `${total}${unit.toLowerCase()}`
  }
  const match = item.cj_match || item.ssg_match
  if (match?.spec_quantity && match?.spec_unit) {
    const total = match.spec_quantity * item.extracted_quantity
    const unit = match.spec_unit.toUpperCase()

    // KG이고 1 미만이면 g으로 변환
    if (unit === 'KG' && total < 1) {
      return `${total * 1000}g`
    }
    // L이고 1 미만이면 ml로 변환
    if (unit === 'L' && total < 1) {
      return `${total * 1000}ml`
    }

    return `${total}${unit.toLowerCase()}`
  }
  return `${item.extracted_quantity}`
}

// 공급사 필요 수량 계산 (소수점 1자리까지 - 올림 안함)
function calculateSupplierQuantityExact(invoiceTotalGrams: number, match: SupplierMatch): number {
  if (!match.spec_quantity || !match.spec_unit) return 1
  const matchGrams = match.spec_quantity * unitToGrams(match.spec_unit)
  // 소수점 1자리까지 반올림
  return Math.round((invoiceTotalGrams / matchGrams) * 10) / 10
}

// 매칭 API 응답에 저장된 SupplierMatch 후보를 MatchCandidate로 변환 (top 5)
function toCandidates(item: ComparisonItem, supplier: 'CJ' | 'SHINSEGAE'): MatchCandidate[] {
  const raw = (supplier === 'CJ' ? item.cj_candidates : item.ssg_candidates) ?? []
  return raw.slice(0, 5).map<MatchCandidate>((c) => ({
    ...c,
    supplier,
    unit_normalized: c.unit_normalized ?? '',
  }))
}

export function SearchPanel({
  item,
  isFocused,
  onSelectProduct,
  onConfirmItem,
  onClearMatch,
  onMoveToNext,
  selectedResultIndex,
  onSelectResultIndex,
  invoiceSupplierName = '업체',
}: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<MatchCandidate[]>([])
  const [sortBy, setSortBy] = useState<'score' | 'price' | 'pricePerGram'>('score')
  const [supplier, setSupplier] = useState<'CJ' | 'SHINSEGAE'>(
    FEATURE_FLAGS.SHOW_CJ ? 'CJ' : 'SHINSEGAE'
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 초기엔 이미 매칭된 TOP-5 후보를 표시 (검색 API 호출 X)
  // 사용자가 검색어 입력 후 검색 버튼 누르면 그때 검색 API 호출
  useEffect(() => {
    if (item) {
      setResults(toCandidates(item, supplier))
      setQuery('')  // 빈값으로 시작 (사용자가 검색할 때만 입력)
    } else {
      setQuery('')
      setResults([])
    }
  }, [item?.id, supplier])

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

  // 검색어 초기화 (Esc) — 후보 5개 다시 표시
  const handleReset = () => {
    if (item) {
      setQuery('')
      setResults(toCandidates(item, supplier))
    }
  }

  // 상품 선택 - item prop의 id를 직접 사용하여 비동기 문제 방지
  const handleSelect = (product: MatchCandidate) => {
    if (!item) return  // item이 없으면 무시
    const supplierMatch: SupplierMatch = {
      id: product.id,
      product_name: product.product_name,
      standard_price: product.standard_price,
      match_score: product.match_score,
      unit_normalized: product.unit_normalized,
      spec_quantity: product.spec_quantity,
      spec_unit: product.spec_unit,
    }
    // item.id를 직접 사용 (currentItem이 아닌 props의 item)
    onSelectProduct(supplierMatch, supplier, item.id)
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
      {/* 공급사 탭 (SHOW_CJ=false일 때는 신세계만 표시) */}
      {FEATURE_FLAGS.SHOW_CJ && (
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
      )}

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
        {/* 검색 대상: 동행 거래명세서 정보 표시 - 초컴팩트 버전 (1줄) */}
        <div className="mt-2 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">📋</span>
            <span className="font-semibold text-gray-900 truncate max-w-[180px]" title={item.extracted_name}>
              {item.extracted_name}
            </span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-600">
              {item.extracted_spec && `${item.extracted_spec} × `}{item.extracted_quantity}개
              {formatInvoiceTotalQuantity(item) !== `${item.extracted_quantity}` && (
                <span className="ml-1 text-blue-600">({formatInvoiceTotalQuantity(item)})</span>
              )}
            </span>
          </div>
          <span className={cn(
            'text-sm font-bold whitespace-nowrap',
            supplier === 'CJ' ? 'text-orange-600' : 'text-green-600'
          )}>
            {formatCurrency(item.extracted_unit_price * item.extracted_quantity)}
          </span>
        </div>
      </div>

      {/* 선택된 품목 영역 - 초컴팩트 버전 */}
      {(() => {
        const currentMatch = supplier === 'CJ' ? item.cj_match : item.ssg_match
        if (!currentMatch) return null

        const invoiceTotalGrams = calculateInvoiceTotalGrams(item, supplier)
        const supplierQty = calculateSupplierQuantityExact(invoiceTotalGrams, currentMatch)
        const supplierTotal = currentMatch.standard_price * supplierQty
        
        // 공급사 규격 표시용
        const matchUnit = currentMatch.spec_quantity && currentMatch.spec_unit 
          ? `${currentMatch.spec_quantity}${currentMatch.spec_unit.toLowerCase()}`
          : '1개'

        // 공급사별 확정 상태 체크
        const isConfirmed = supplier === 'CJ' ? item.cj_confirmed : item.ssg_confirmed

        return (
          <div className={cn(
            'border-b px-4 py-2',
            supplier === 'CJ' ? 'bg-orange-100' : 'bg-green-100'
          )}>
            {/* 한 줄에 모든 정보 + 버튼 */}
            <div className="flex items-center gap-3">
              <CheckCircle size={16} className={cn('flex-shrink-0', supplier === 'CJ' ? 'text-orange-600' : 'text-green-600')} />
              
              {/* 품목 정보 (유연하게 확장) */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className={cn(
                    'font-medium truncate max-w-[200px]',
                    supplier === 'CJ' ? 'text-orange-700' : 'text-green-700'
                  )} title={currentMatch.product_name}>
                    {currentMatch.product_name}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-600 whitespace-nowrap">
                    {invoiceTotalGrams >= 1000 ? `${(invoiceTotalGrams/1000).toFixed(1)}kg` : `${Math.round(invoiceTotalGrams)}g`}
                    <span className="mx-1">→</span>
                    <span className="font-medium text-blue-600">{supplierQty}개</span>
                    <span className="text-gray-400 mx-1">({matchUnit})</span>
                  </span>
                  <span className="text-gray-400">=</span>
                  <span className={cn(
                    'font-bold whitespace-nowrap',
                    supplier === 'CJ' ? 'text-orange-700' : 'text-green-700'
                  )}>
                    {formatCurrency(supplierTotal)}
                  </span>
                </div>
              </div>

              {/* 버튼들 */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {onClearMatch && (
                  <button
                    onClick={() => onClearMatch(supplier)}
                    className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    변경
                  </button>
                )}
                {onConfirmItem && !isConfirmed && (
                  <button
                    onClick={() => {
                      onConfirmItem(item.id, supplier)
                      onMoveToNext?.()
                    }}
                    className={cn(
                      'rounded px-2.5 py-1 text-xs font-medium text-white',
                      supplier === 'CJ'
                        ? 'bg-orange-600 hover:bg-orange-700'
                        : 'bg-green-600 hover:bg-green-700'
                    )}
                  >
                    ✓ 확정
                  </button>
                )}
                {isConfirmed && (
                  <span className="rounded bg-green-500 px-2 py-1 text-xs font-medium text-white">
                    ✓ 확정됨
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
          {query.trim() ? '검색 결과' : '추천 후보'}
          {' '}<span className="font-semibold">{results.length}</span>
          {query.trim() ? '건' : '개'}
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
                    {product.spec_quantity && product.spec_unit && (
                      <span className="text-xs text-gray-500">
                        ({product.spec_quantity}{product.spec_unit.toLowerCase()})
                      </span>
                    )}
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

      {/* 하단 검색 영역 — 후보 5개에 원하는 결과가 없으면 여기서 검색 */}
      <div className="shrink-0 border-t-2 border-green-200 bg-green-50/40 p-3">
        <p className="mb-1.5 text-xs font-medium text-gray-600">
          🔎 위 후보에 원하는 제품이 없으면 검색어로 신세계 DB 직접 검색:
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
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
              placeholder="다른 키워드로 검색..."
              className={cn(
                'w-full rounded-lg border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2',
                isFocused
                  ? 'border-green-400 focus:ring-green-200'
                  : 'border-gray-300 focus:ring-blue-200',
              )}
            />
          </div>

          <button
            onClick={handleReset}
            className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
            title="초기화 — 후보 5개 다시 보기 (Esc)"
          >
            <RotateCcw size={16} />
          </button>

          <button
            onClick={handleSearch}
            disabled={isLoading || !query.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            검색
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Search, Loader2, Check } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem, MatchCandidate, Supplier } from '@/types/audit'

interface ProductSearchModalProps {
  item: ComparisonItem
  initialSupplier?: Supplier
  isOpen: boolean
  onClose: () => void
  onSelect: (itemId: string, product: MatchCandidate, supplier: Supplier) => void
}

export function ProductSearchModal({
  item,
  initialSupplier,
  isOpen,
  onClose,
  onSelect,
}: ProductSearchModalProps) {
  const [query, setQuery] = useState('')
  const [supplier, setSupplier] = useState<Supplier | ''>(initialSupplier || '')
  const [results, setResults] = useState<MatchCandidate[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (isOpen && item) {
      setQuery(item.extracted_name)
      setSupplier(initialSupplier || '')
      setResults([])

      // 초기 검색 자동 실행
      if (item.extracted_name) {
        performSearch(item.extracted_name, initialSupplier || '')
      }
    }
  }, [isOpen, item, initialSupplier])

  const performSearch = async (searchQuery: string, searchSupplier: Supplier | '') => {
    if (!searchQuery.trim()) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({ q: searchQuery })
      if (searchSupplier) {
        params.set('supplier', searchSupplier)
      }

      const res = await fetch(`/api/products/search?${params}`)
      const data = await res.json()

      if (data.success) {
        setResults(data.products)
      }
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSearch = useCallback(() => {
    performSearch(query, supplier)
  }, [query, supplier])

  const handleSelect = (product: MatchCandidate) => {
    onSelect(item.id, product, product.supplier)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">상품 검색</h3>
            <p className="text-sm text-gray-500">
              원본: <span className="font-medium">{item.extracted_name}</span>
              {initialSupplier && (
                <span
                  className={cn(
                    'ml-2 rounded px-1.5 py-0.5 text-xs font-medium',
                    initialSupplier === 'CJ' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
                  )}
                >
                  {initialSupplier === 'CJ' ? 'CJ 검색' : '신세계 검색'}
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        {/* 검색 영역 */}
        <div className="border-b px-6 py-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="상품명으로 검색"
                className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>

            <select
              value={supplier}
              onChange={(e) => setSupplier(e.target.value as Supplier | '')}
              className={cn(
                'rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200',
                supplier === 'CJ' && 'border-orange-300 bg-orange-50',
                supplier === 'SHINSEGAE' && 'border-purple-300 bg-purple-50'
              )}
            >
              <option value="">전체 공급사</option>
              <option value="CJ">CJ</option>
              <option value="SHINSEGAE">신세계</option>
            </select>

            <button
              onClick={handleSearch}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              검색
            </button>
          </div>
        </div>

        {/* 결과 영역 */}
        <div className="flex-1 overflow-y-auto p-6">
          {results.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-gray-500">
              {isLoading ? '검색 중...' : '검색 결과가 없습니다'}
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((product, idx) => {
                const priceDiff = item.extracted_unit_price - product.standard_price
                const hasSavings = priceDiff > 0
                const totalSavings = hasSavings ? priceDiff * item.extracted_quantity : 0

                return (
                  <div
                    key={`${product.id}-${idx}`}
                    className={cn(
                      'flex cursor-pointer items-center justify-between rounded-lg border p-4 transition-colors',
                      'hover:border-blue-300 hover:bg-blue-50',
                      hasSavings && 'border-green-200 bg-green-50/50'
                    )}
                    onClick={() => handleSelect(product)}
                  >
                    <div className="flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={cn(
                            'rounded px-2 py-0.5 text-xs font-medium',
                            product.supplier === 'CJ' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
                          )}
                        >
                          {product.supplier === 'CJ' ? 'CJ' : '신세계'}
                        </span>
                        <span className="font-medium text-gray-900">{product.product_name}</span>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>
                          기준가: <span className="font-medium text-gray-700">{formatCurrency(product.standard_price)}</span>
                        </span>
                        <span>단위: {product.unit_normalized}</span>
                        {product.match_score > 0 && <span>일치율: {Math.round(product.match_score * 100)}%</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {hasSavings ? (
                          <div>
                            <p className="font-medium text-green-600">절감 {formatCurrency(totalSavings)}</p>
                            <p className="text-xs text-gray-500">단가 차이 {formatCurrency(priceDiff)}</p>
                          </div>
                        ) : priceDiff < 0 ? (
                          <span className="text-sm text-gray-500">손해 {formatCurrency(Math.abs(priceDiff))}</span>
                        ) : (
                          <span className="text-sm text-gray-400">동일</span>
                        )}
                      </div>

                      <button className="rounded-lg bg-blue-100 p-2 text-blue-600 hover:bg-blue-200">
                        <Check size={18} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

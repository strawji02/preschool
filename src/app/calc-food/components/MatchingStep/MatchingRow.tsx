'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Check, Circle } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem, Supplier, SupplierMatch } from '@/types/audit'
import { CandidateSelector } from './CandidateSelector'
import { convertPrice, parseUnitString, type NormalizedUnit } from '@/lib/unitConversion'

// 추출된 spec 또는 name에서 단위와 수량 파싱
function parseExtractedSpec(spec: string | null | undefined, name: string | null | undefined): { unit: NormalizedUnit; quantity: number } {
  // 1. spec에서 먼저 시도 (예: "3KG", "1KG/EA", "500G/중", "65ML*5EA")
  if (spec) {
    // 패턴: 숫자 + 단위 (중간이나 끝에 있을 수 있음)
    const specMatch = spec.match(/(\d+\.?\d*)\s*(kg|g|l|ml)/i)
    if (specMatch) {
      return {
        unit: normalizeUnit(specMatch[2].toLowerCase()),
        quantity: parseFloat(specMatch[1])
      }
    }
    // 단위만 있는 경우 (예: "KG/상", "KG")
    const unitOnly = spec.match(/^(kg|g|l|ml)/i)
    if (unitOnly) {
      return { unit: normalizeUnit(unitOnly[1].toLowerCase()), quantity: 1 }
    }
  }
  
  // 2. name에서 수량/단위 추출 (예: "콩나물(친환경 600g/EA)")
  if (name) {
    const nameMatch = name.match(/(\d+\.?\d*)\s*(kg|g|l|ml)/i)
    if (nameMatch) {
      return {
        unit: normalizeUnit(nameMatch[2].toLowerCase()),
        quantity: parseFloat(nameMatch[1])
      }
    }
  }
  
  return { unit: 'g', quantity: 1 }
}

// 단위 정규화 헬퍼
function normalizeUnit(unitLower: string): NormalizedUnit {
  if (unitLower === 'kg') return 'kg'
  if (unitLower === 'g') return 'g'
  if (unitLower === 'l') return 'L'
  if (unitLower === 'ml') return 'ml'
  if (unitLower === '개' || unitLower === 'ea') return 'EA'
  return 'g'
}

interface MatchingRowProps {
  item: ComparisonItem
  onSelectCandidate: (itemId: string, supplier: Supplier, candidate: SupplierMatch) => void
  onConfirm: (itemId: string) => void
  onSearchClick: (item: ComparisonItem, supplier: Supplier) => void
}

export function MatchingRow({
  item,
  onSelectCandidate,
  onConfirm,
  onSearchClick,
}: MatchingRowProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 사용자가 설정한 단위와 수량 (추출된 spec/name에서 파싱하여 초기값 설정)
  const initialSpec = parseExtractedSpec(item.extracted_spec, item.extracted_name)
  const [userUnit, setUserUnit] = useState<NormalizedUnit>(initialSpec.unit)
  const [userQuantity, setUserQuantity] = useState<number>(initialSpec.quantity)

  // 견적불가 여부 확인 (CJ와 SSG 모두 후보가 없는 경우)
  const noMatch = item.cj_candidates.length === 0 && item.ssg_candidates.length === 0

  // 환산 가격 계산 함수
  const getConvertedPrice = (supplierPrice: number, supplierUnit: string | undefined): number | null => {
    if (!supplierUnit) return null
    return convertPrice(supplierPrice, supplierUnit, userUnit, userQuantity)
  }

  const getStatusBadge = () => {
    // 견적불가 우선 표시
    if (noMatch) {
      return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">견적불가</span>
    }

    switch (item.match_status) {
      case 'auto_matched':
        return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">자동</span>
      case 'manual_matched':
        return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">수동</span>
      case 'pending':
        return <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">확인</span>
      case 'unmatched':
        return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">미매칭</span>
    }
  }

  return (
    <div className="border-b">
      {/* 메인 행 - 8컬럼 (단위 수정 UI 추가) */}
      <div
        className={cn(
          'grid grid-cols-[1fr_60px_90px_200px_120px_120px_60px_40px] gap-2 px-4 py-3 transition-colors',
          item.is_confirmed ? 'bg-green-50' : 'hover:bg-gray-50'
        )}
      >
        {/* 품목명 */}
        <div className="flex items-center gap-2 min-w-0">
          {getStatusBadge()}
          <span className="truncate text-sm" title={item.extracted_name}>
            {item.extracted_name}
          </span>
          {item.extracted_spec && (
            <span className="hidden truncate text-xs text-gray-500 lg:inline">
              ({item.extracted_spec})
            </span>
          )}
        </div>

        {/* 수량 */}
        <div className="flex items-center justify-end text-sm">
          {item.extracted_quantity}
        </div>

        {/* 현재 급식 단가 */}
        <div className="flex items-center justify-end text-sm font-medium">
          {formatCurrency(item.extracted_unit_price)}
        </div>

        {/* 단위 수정 UI */}
        <div className="flex items-center gap-2">
          <select
            value={userUnit}
            onChange={(e) => setUserUnit(e.target.value as NormalizedUnit)}
            disabled={item.is_confirmed}
            className={cn(
              'rounded border border-gray-300 px-2 py-1 text-sm',
              item.is_confirmed && 'cursor-not-allowed bg-gray-100'
            )}
          >
            <option value="g">g</option>
            <option value="kg">kg</option>
            <option value="ml">ml</option>
            <option value="L">L</option>
            <option value="EA">개</option>
          </select>
          <input
            type="number"
            value={userQuantity}
            onChange={(e) => setUserQuantity(Number(e.target.value))}
            disabled={item.is_confirmed}
            className={cn(
              'w-20 rounded border border-gray-300 px-2 py-1 text-sm',
              item.is_confirmed && 'cursor-not-allowed bg-gray-100'
            )}
            min="0"
            step="0.1"
          />
        </div>

        {/* CJ 선택 */}
        <div className="flex items-center justify-center">
          <CandidateSelector
            supplier="CJ"
            candidates={item.cj_candidates}
            selectedMatch={item.cj_match}
            userUnit={userUnit}
            userQuantity={userQuantity}
            onSelect={(candidate) => onSelectCandidate(item.id, 'CJ', candidate)}
            onSearchClick={() => onSearchClick(item, 'CJ')}
            disabled={item.is_confirmed}
          />
        </div>

        {/* SSG 선택 */}
        <div className="flex items-center justify-center">
          <CandidateSelector
            supplier="SHINSEGAE"
            candidates={item.ssg_candidates}
            selectedMatch={item.ssg_match}
            userUnit={userUnit}
            userQuantity={userQuantity}
            onSelect={(candidate) => onSelectCandidate(item.id, 'SHINSEGAE', candidate)}
            onSearchClick={() => onSearchClick(item, 'SHINSEGAE')}
            disabled={item.is_confirmed}
          />
        </div>

        {/* 확정 버튼 (토글 가능) */}
        <div className="flex items-center justify-center">
          <button
            onClick={() => onConfirm(item.id)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
              item.is_confirmed
                ? 'bg-green-500 hover:bg-green-600'
                : 'border-2 border-gray-300 text-gray-400 hover:border-green-500 hover:text-green-500'
            )}
            title={item.is_confirmed ? '확정 해제' : '확정'}
          >
            {item.is_confirmed ? (
              <Check size={14} className="text-white" />
            ) : (
              <Circle size={14} />
            )}
          </button>
        </div>

        {/* 확장 버튼 */}
        <div className="flex items-center justify-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* 확장 영역 - 후보 카드 그리드 */}
      {isExpanded && (
        <div className="border-t bg-gray-50 px-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            {/* CJ 후보 목록 */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
                  CJ
                </span>
                후보 ({item.cj_candidates.length}개)
              </h4>
              <div className="space-y-2">
                {item.cj_candidates.length === 0 ? (
                  <p className="text-sm text-gray-500">매칭 후보 없음</p>
                ) : (
                  item.cj_candidates.map((candidate, index) => {
                    const isSelected = item.cj_match?.id === candidate.id
                    return (
                      <button
                        key={candidate.id}
                        onClick={() => !item.is_confirmed && onSelectCandidate(item.id, 'CJ', candidate)}
                        disabled={item.is_confirmed}
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-all',
                          isSelected
                            ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500'
                            : 'border-gray-200 bg-white hover:border-orange-300 hover:bg-orange-50/50',
                          item.is_confirmed && 'cursor-not-allowed opacity-60'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                              isSelected
                                ? 'bg-orange-500 text-white'
                                : 'bg-gray-200 text-gray-600'
                            )}>
                              {isSelected ? <Check size={12} /> : index + 1}
                            </span>
                            <span className="text-sm font-medium">{candidate.product_name}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {Math.round(candidate.match_score * 100)}%
                          </span>
                        </div>
                        <div className="mt-1 pl-7 space-y-1">
                          <div className="text-sm text-orange-600 font-medium">
                            {formatCurrency(candidate.standard_price)}
                            {candidate.unit_normalized && (
                              <span className="text-orange-400">/{candidate.unit_normalized}</span>
                            )}
                          </div>
                          {candidate.unit_normalized && (() => {
                            const converted = getConvertedPrice(candidate.standard_price, candidate.unit_normalized)
                            return (
                              <div className="text-xs text-orange-500">
                                → {userQuantity}{userUnit} 기준: {converted !== null ? formatCurrency(converted) : '환산불가'}
                              </div>
                            )
                          })()}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {/* SSG 후보 목록 */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
                  신세계
                </span>
                후보 ({item.ssg_candidates.length}개)
              </h4>
              <div className="space-y-2">
                {item.ssg_candidates.length === 0 ? (
                  <p className="text-sm text-gray-500">매칭 후보 없음</p>
                ) : (
                  item.ssg_candidates.map((candidate, index) => {
                    const isSelected = item.ssg_match?.id === candidate.id
                    return (
                      <button
                        key={candidate.id}
                        onClick={() => !item.is_confirmed && onSelectCandidate(item.id, 'SHINSEGAE', candidate)}
                        disabled={item.is_confirmed}
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-all',
                          isSelected
                            ? 'border-purple-500 bg-purple-50 ring-1 ring-purple-500'
                            : 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50/50',
                          item.is_confirmed && 'cursor-not-allowed opacity-60'
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                              isSelected
                                ? 'bg-purple-500 text-white'
                                : 'bg-gray-200 text-gray-600'
                            )}>
                              {isSelected ? <Check size={12} /> : index + 1}
                            </span>
                            <span className="text-sm font-medium">{candidate.product_name}</span>
                          </div>
                          <span className="text-xs text-gray-500">
                            {Math.round(candidate.match_score * 100)}%
                          </span>
                        </div>
                        <div className="mt-1 pl-7 space-y-1">
                          <div className="text-sm text-purple-600 font-medium">
                            {formatCurrency(candidate.standard_price)}
                            {candidate.unit_normalized && (
                              <span className="text-purple-400">/{candidate.unit_normalized}</span>
                            )}
                          </div>
                          {candidate.unit_normalized && (() => {
                            const converted = getConvertedPrice(candidate.standard_price, candidate.unit_normalized)
                            return (
                              <div className="text-xs text-purple-500">
                                → {userQuantity}{userUnit} 기준: {converted !== null ? formatCurrency(converted) : '환산불가'}
                              </div>
                            )
                          })()}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

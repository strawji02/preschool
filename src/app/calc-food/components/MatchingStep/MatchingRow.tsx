'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Check, Circle } from 'lucide-react'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { ComparisonItem, Supplier, SupplierMatch } from '@/types/audit'
import { CandidateSelector } from './CandidateSelector'
import { parseUnitString, type NormalizedUnit } from '@/lib/unitConversion'
import { convertPriceUnified, type ConversionResult } from '@/lib/unitConversionUnified'
import { calculateVolumeMultiplier } from '@/lib/spec-parser'
import { FEATURE_FLAGS } from '../../config'

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
  const [conversionCache, setConversionCache] = useState<Record<string, ConversionResult>>({})

  // 견적불가 여부 확인 (CJ와 SSG 모두 후보가 없는 경우)
  const noMatch = item.cj_candidates.length === 0 && item.ssg_candidates.length === 0

  // 합계 검증: 수량 × 단가 = 금액 확인
  const calculatedTotal = item.extracted_quantity * item.extracted_unit_price
  const extractedTotal = item.extracted_total_price ?? calculatedTotal
  const totalMismatch = Math.abs(calculatedTotal - extractedTotal) > 0.01 // 소수점 오차 허용

  // 비동기 환산 가격 계산
  useEffect(() => {
    const loadConversions = async () => {
      const cache: Record<string, ConversionResult> = {}

      // Convert CJ candidates
      for (const candidate of item.cj_candidates) {
        if (candidate.unit_normalized) {
          const key = `cj_${candidate.id}`
          cache[key] = await convertPriceUnified(
            candidate.standard_price,
            candidate.unit_normalized,
            userUnit,
            userQuantity,
            candidate.category
          )
        }
      }

      // Convert SSG candidates
      for (const candidate of item.ssg_candidates) {
        if (candidate.unit_normalized) {
          const key = `ssg_${candidate.id}`
          cache[key] = await convertPriceUnified(
            candidate.standard_price,
            candidate.unit_normalized,
            userUnit,
            userQuantity,
            candidate.category
          )
        }
      }

      setConversionCache(cache)
    }

    loadConversions()
  }, [item.cj_candidates, item.ssg_candidates, userUnit, userQuantity])

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
      {/* 메인 행 (CJ 플래그에 따라 동적 그리드) */}
      <div
        className={cn(
          'grid gap-2 px-4 py-3 transition-colors',
          FEATURE_FLAGS.SHOW_CJ
            ? 'grid-cols-[1fr_60px_90px_200px_120px_120px_60px_40px]'
            : 'grid-cols-[1fr_60px_90px_200px_120px_60px_40px]',
          item.is_confirmed ? 'bg-green-50' : 'hover:bg-gray-50',
          totalMismatch && 'bg-red-50 border-l-4 border-red-500',
          item.is_excluded && 'opacity-50 bg-gray-100'
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

        {/* 단위 수정 UI + 실시간 환산 계산기 */}
        <div className="flex flex-col gap-1">
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
          {/* 실시간 환산가 표시 */}
          {userQuantity > 0 && (
            <div className="text-xs text-gray-600">
              {userQuantity}{userUnit} 기준 단가: {formatCurrency(item.extracted_unit_price / userQuantity)}/{userUnit}
            </div>
          )}
        </div>

        {/* CJ 선택 (feature flag로 숨김) */}
        {FEATURE_FLAGS.SHOW_CJ && (
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
        )}

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

      {/* 확장 영역 - 3행 카드 UI */}
      {isExpanded && (
        <div className="border-t bg-gray-50 px-4 py-4 space-y-3">
          {/* 1행: 거래명세서 데이터 */}
          <div className={cn(
            "rounded-lg border p-4",
            totalMismatch ? "bg-red-50 border-red-300" : "bg-white border-gray-200"
          )}>
            <h4 className="mb-3 text-sm font-semibold text-gray-700">📄 거래명세서 원본 데이터</h4>
            <div className="grid grid-cols-5 gap-4 text-sm">
              <div>
                <span className="text-gray-500 block mb-1">품명</span>
                <span className="font-medium">{item.extracted_name}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">규격</span>
                <span className="font-medium">{item.extracted_spec || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">수량</span>
                <span className="font-medium">{item.extracted_quantity}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">단가</span>
                <span className="font-medium">{formatCurrency(item.extracted_unit_price)}</span>
              </div>
              <div>
                <span className="text-gray-500 block mb-1">금액</span>
                <span className={cn(
                  "font-medium",
                  totalMismatch ? "text-red-600" : "text-blue-600"
                )}>
                  {formatCurrency(extractedTotal)}
                </span>
                {totalMismatch && (
                  <div className="text-xs text-red-600 mt-1">
                    ⚠️ 계산값: {formatCurrency(calculatedTotal)}
                  </div>
                )}
              </div>
            </div>
            {totalMismatch && (
              <div className="mt-3 rounded bg-red-100 border border-red-300 p-2 text-xs text-red-700">
                <strong>합계 불일치:</strong> 수량({item.extracted_quantity}) × 단가({formatCurrency(item.extracted_unit_price)}) = {formatCurrency(calculatedTotal)} ≠ 금액({formatCurrency(extractedTotal)})
              </div>
            )}
          </div>

          {/* 2행: AI 추천 근거 */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
            <h4 className="mb-2 text-sm font-semibold text-blue-800">🤖 AI 매칭 근거</h4>
            <div className="space-y-2 text-sm text-blue-900">
              {item.cj_match && (
                <div>
                  <span className="font-medium">CJ:</span>{' '}
                  {item.cj_match.match_score >= 0.9
                    ? `높은 신뢰도 (${Math.round(item.cj_match.match_score * 100)}%)로 "${item.cj_match.product_name}" 추천`
                    : `"${item.cj_match.product_name}" 추천 (추가 검토 필요)`}
                </div>
              )}
              {item.ssg_match && (
                <div>
                  <span className="font-medium">신세계:</span>{' '}
                  {item.ssg_match.match_score >= 0.9
                    ? `높은 신뢰도 (${Math.round(item.ssg_match.match_score * 100)}%)로 "${item.ssg_match.product_name}" 추천`
                    : `"${item.ssg_match.product_name}" 추천 (추가 검토 필요)`}
                </div>
              )}
              {!item.cj_match && !item.ssg_match && (
                <div className="text-gray-600">매칭된 후보가 없습니다.</div>
              )}
            </div>
          </div>

          {/* 수량 보정 정보 (자동감지 결과 표시) */}
          {(item.cj_match || item.ssg_match) && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h4 className="mb-2 text-sm font-semibold text-gray-700">수량 보정 감지</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {item.cj_match && item.cj_match.unit_normalized && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">CJ</span>
                      <span className="text-xs text-gray-500">
                        {item.extracted_spec || '-'} vs {item.cj_match.unit_normalized}
                      </span>
                    </div>
                    {(() => {
                      const vol = calculateVolumeMultiplier(item.extracted_spec || '', item.cj_match.unit_normalized || '')
                      return vol.autoDetected ? (
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-600 font-medium">
                            x{vol.multiplier}
                          </span>
                          <span className="text-xs text-gray-500">
                            보정 단가: {formatCurrency(item.cj_match.standard_price * vol.multiplier)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-yellow-600">{vol.reason || '자동감지 불가'}</span>
                      )
                    })()}
                  </div>
                )}
                {item.ssg_match && item.ssg_match.unit_normalized && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">신세계</span>
                      <span className="text-xs text-gray-500">
                        {item.extracted_spec || '-'} vs {item.ssg_match.unit_normalized}
                      </span>
                    </div>
                    {(() => {
                      const vol = calculateVolumeMultiplier(item.extracted_spec || '', item.ssg_match.unit_normalized || '')
                      return vol.autoDetected ? (
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600 font-medium">
                            x{vol.multiplier}
                          </span>
                          <span className="text-xs text-gray-500">
                            보정 단가: {formatCurrency(item.ssg_match.standard_price * vol.multiplier)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-yellow-600">{vol.reason || '자동감지 불가'}</span>
                      )
                    })()}
                  </div>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                리포트 단계에서 수량 보정 배수를 수동으로 조정할 수 있습니다.
              </p>
            </div>
          )}

          {/* 3행: CJ 매칭 패널 → CJ 확정 후 SSG 매칭 패널 */}
          <div className="space-y-3">
            {/* CJ 매칭 패널 */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
                  CJ
                </span>
                후보 목록 ({item.cj_candidates.length}개)
              </h4>
              <div className="space-y-2">
                {item.cj_candidates.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">매칭 후보 없음</p>
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
                          {candidate.match_score >= 0.9 && (
                            <span className="text-xs text-green-600 font-medium">
                              {Math.round(candidate.match_score * 100)}%
                            </span>
                          )}
                        </div>
                        <div className="mt-1 pl-7 space-y-1">
                          <div className="text-sm text-orange-600 font-medium">
                            {formatCurrency(candidate.standard_price)}
                            {candidate.unit_normalized && (
                              <span className="text-orange-400">/{candidate.unit_normalized}</span>
                            )}
                          </div>
                          {candidate.unit_normalized && (() => {
                            const result = conversionCache[`cj_${candidate.id}`] || {
                              success: false,
                              convertedPrice: null,
                              method: 'failed' as const,
                              message: '계산중...'
                            }
                            return (
                              <div className="text-xs text-orange-500">
                                → {userQuantity}{userUnit} 기준: {
                                  result.success
                                    ? formatCurrency(result.convertedPrice!)
                                    : result.message
                                }
                                {result.method === 'db' && <span className="ml-1 text-green-600" title="DB 환산">✓</span>}
                                {result.method === 'basic' && <span className="ml-1 text-blue-600" title="기본 환산">~</span>}
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

            {/* SSG 매칭 패널 (CJ 선택 후 표시) */}
            {item.cj_match && (
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-700">
                    신세계
                  </span>
                  후보 목록 ({item.ssg_candidates.length}개)
                </h4>
                <div className="space-y-2">
                  {item.ssg_candidates.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2">매칭 후보 없음</p>
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
                            {candidate.match_score >= 0.9 && (
                              <span className="text-xs text-green-600 font-medium">
                                {Math.round(candidate.match_score * 100)}%
                              </span>
                            )}
                          </div>
                          <div className="mt-1 pl-7 space-y-1">
                            <div className="text-sm text-purple-600 font-medium">
                              {formatCurrency(candidate.standard_price)}
                              {candidate.unit_normalized && (
                                <span className="text-purple-400">/{candidate.unit_normalized}</span>
                              )}
                            </div>
                            {candidate.unit_normalized && (() => {
                              const result = conversionCache[`ssg_${candidate.id}`] || {
                                success: false,
                                convertedPrice: null,
                                method: 'failed' as const,
                                message: '계산중...'
                              }
                              return (
                                <div className="text-xs text-purple-500">
                                  → {userQuantity}{userUnit} 기준: {
                                    result.success
                                      ? formatCurrency(result.convertedPrice!)
                                      : result.message
                                  }
                                  {result.method === 'db' && <span className="ml-1 text-green-600" title="DB 환산">✓</span>}
                                  {result.method === 'basic' && <span className="ml-1 text-blue-600" title="기본 환산">~</span>}
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}

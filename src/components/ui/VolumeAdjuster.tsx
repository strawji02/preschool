'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/cn'
import { formatCurrency } from '@/lib/format'
import { calculateVolumeMultiplier } from '@/lib/spec-parser'

export interface VolumeAdjustment {
  autoMultiplier: number
  manualMultiplier: number
  isManualOverride: boolean
  autoDetected: boolean
  reason?: string
}

interface VolumeAdjusterProps {
  invoiceSpec: string | undefined
  supplierSpec: string | undefined
  supplierUnitPrice: number
  invoiceUnitPrice: number
  onChange: (adjustedPrice: number, multiplier: number) => void
  disabled?: boolean
  /** Color theme: 'orange' for CJ, 'purple' for SSG */
  colorTheme?: 'orange' | 'purple'
}

export function VolumeAdjuster({
  invoiceSpec,
  supplierSpec,
  supplierUnitPrice,
  invoiceUnitPrice,
  onChange,
  disabled = false,
  colorTheme = 'purple',
}: VolumeAdjusterProps) {
  const [adjustment, setAdjustment] = useState<VolumeAdjustment>(() => {
    if (!invoiceSpec || !supplierSpec) {
      return {
        autoMultiplier: 1,
        manualMultiplier: 1,
        isManualOverride: false,
        autoDetected: false,
        reason: '규격 정보 없음',
      }
    }

    const result = calculateVolumeMultiplier(invoiceSpec, supplierSpec)
    return {
      autoMultiplier: result.multiplier,
      manualMultiplier: result.multiplier,
      isManualOverride: false,
      autoDetected: result.autoDetected,
      reason: result.reason,
    }
  })

  // Recalculate when specs change
  useEffect(() => {
    if (!invoiceSpec || !supplierSpec) {
      const adj: VolumeAdjustment = {
        autoMultiplier: 1,
        manualMultiplier: 1,
        isManualOverride: false,
        autoDetected: false,
        reason: '규격 정보 없음',
      }
      setAdjustment(adj)
      onChange(supplierUnitPrice, 1)
      return
    }

    const result = calculateVolumeMultiplier(invoiceSpec, supplierSpec)
    const adj: VolumeAdjustment = {
      autoMultiplier: result.multiplier,
      manualMultiplier: result.multiplier,
      isManualOverride: false,
      autoDetected: result.autoDetected,
      reason: result.reason,
    }
    setAdjustment(adj)
    onChange(supplierUnitPrice * result.multiplier, result.multiplier)
  }, [invoiceSpec, supplierSpec, supplierUnitPrice])

  const handleMultiplierChange = (value: string) => {
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return

    const rounded = Math.round(num * 100) / 100
    setAdjustment(prev => ({
      ...prev,
      manualMultiplier: rounded,
      isManualOverride: rounded !== prev.autoMultiplier,
    }))
    onChange(supplierUnitPrice * rounded, rounded)
  }

  const currentMultiplier = adjustment.manualMultiplier
  const adjustedPrice = supplierUnitPrice * currentMultiplier
  const priceDiff = adjustedPrice - invoiceUnitPrice
  const priceDiffPercent = invoiceUnitPrice !== 0
    ? ((priceDiff) / invoiceUnitPrice) * 100
    : 0

  // If multiplier is 1 and auto-detected (same spec), show collapsed view
  if (adjustment.autoDetected && adjustment.autoMultiplier === 1 && !adjustment.isManualOverride) {
    return null // Same spec, no adjustment needed
  }

  const themeColors = colorTheme === 'orange'
    ? {
        bg: 'bg-orange-50',
        border: 'border-orange-200',
        label: 'text-orange-700',
        badge: 'bg-orange-100 text-orange-600',
      }
    : {
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        label: 'text-purple-700',
        badge: 'bg-purple-100 text-purple-600',
      }

  return (
    <div className={cn(
      'rounded-lg border p-3 text-sm',
      themeColors.bg,
      themeColors.border,
    )}>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('font-medium text-xs', themeColors.label)}>
          수량 보정
        </span>
        {adjustment.autoDetected ? (
          <span className={cn('rounded-full px-2 py-0.5 text-xs', themeColors.badge)}>
            자동감지
          </span>
        ) : (
          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
            {adjustment.reason || '수동 입력'}
          </span>
        )}
        {adjustment.isManualOverride && (
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600">
            수동 변경
          </span>
        )}
      </div>

      {/* Auto-detection explanation */}
      {adjustment.autoDetected && (
        <div className="mb-2 text-xs text-gray-500">
          {invoiceSpec} / {supplierSpec} = x{adjustment.autoMultiplier}
        </div>
      )}

      {/* Multiplier input */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-600">보정 배수:</span>
        <div className="flex items-center">
          <span className="text-xs text-gray-400 mr-1">x</span>
          <input
            type="number"
            value={currentMultiplier}
            onChange={(e) => handleMultiplierChange(e.target.value)}
            disabled={disabled}
            className={cn(
              'w-16 rounded border border-gray-300 px-2 py-1 text-sm text-center',
              disabled && 'cursor-not-allowed bg-gray-100'
            )}
            min="0"
            step="0.1"
          />
        </div>
        {adjustment.isManualOverride && (
          <button
            onClick={() => {
              setAdjustment(prev => ({
                ...prev,
                manualMultiplier: prev.autoMultiplier,
                isManualOverride: false,
              }))
              onChange(supplierUnitPrice * adjustment.autoMultiplier, adjustment.autoMultiplier)
            }}
            className="text-xs text-blue-500 hover:text-blue-700"
            title="자동감지 값으로 되돌리기"
          >
            초기화
          </button>
        )}
      </div>

      {/* Adjusted price display */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600">
          보정 단가: <span className="font-medium text-gray-900">
            {formatCurrency(adjustedPrice)}
          </span>
          <span className="text-gray-400 ml-1">
            ({formatCurrency(supplierUnitPrice)} x {currentMultiplier})
          </span>
        </div>
      </div>

      {/* Price difference */}
      <div className="mt-1">
        <span className={cn(
          'text-xs font-medium',
          priceDiff > 0 ? 'text-red-600' : priceDiff < 0 ? 'text-green-600' : 'text-gray-500'
        )}>
          차이: {priceDiff > 0 ? '+' : ''}{formatCurrency(priceDiff)}
          {' '}({priceDiff > 0 ? '+' : ''}{priceDiffPercent.toFixed(1)}%)
        </span>
        {priceDiff < 0 && (
          <span className="ml-1 text-xs text-green-600">절감</span>
        )}
        {priceDiff > 0 && (
          <span className="ml-1 text-xs text-red-600">비쌈</span>
        )}
      </div>
    </div>
  )
}

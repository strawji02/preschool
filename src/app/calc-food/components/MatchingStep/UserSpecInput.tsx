'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/cn'

type SpecUnit = 'g' | 'ml' | 'ea'

interface UserSpecInputProps {
  unitPrice: number           // 유저 단가
  currentQuantity?: number    // 현재 수량
  currentUnit?: SpecUnit      // 현재 단위
  onChange: (quantity: number, unit: SpecUnit, ppu: number) => void
  disabled?: boolean
}

// 빠른 선택 버튼
const QUICK_OPTIONS: { label: string; quantity: number; unit: SpecUnit }[] = [
  { label: '100g', quantity: 100, unit: 'g' },
  { label: '500g', quantity: 500, unit: 'g' },
  { label: '1kg', quantity: 1000, unit: 'g' },
  { label: '개당', quantity: 1, unit: 'ea' },
]

export function UserSpecInput({
  unitPrice,
  currentQuantity,
  currentUnit,
  onChange,
  disabled = false,
}: UserSpecInputProps) {
  const [quantity, setQuantity] = useState<string>(currentQuantity?.toString() || '')
  const [unit, setUnit] = useState<SpecUnit>(currentUnit || 'g')
  const [showInput, setShowInput] = useState(!!currentQuantity)

  // 현재 값이 변경되면 동기화
  useEffect(() => {
    if (currentQuantity !== undefined) {
      setQuantity(currentQuantity.toString())
      setShowInput(true)
    }
    if (currentUnit) {
      setUnit(currentUnit)
    }
  }, [currentQuantity, currentUnit])

  const handleQuickSelect = (opt: typeof QUICK_OPTIONS[0]) => {
    setQuantity(opt.quantity.toString())
    setUnit(opt.unit)
    setShowInput(true)
    
    const ppu = unitPrice / opt.quantity
    onChange(opt.quantity, opt.unit, ppu)
  }

  const handleQuantityChange = (value: string) => {
    setQuantity(value)
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue > 0) {
      const ppu = unitPrice / numValue
      onChange(numValue, unit, ppu)
    }
  }

  const handleUnitChange = (newUnit: SpecUnit) => {
    setUnit(newUnit)
    const numValue = parseFloat(quantity)
    if (!isNaN(numValue) && numValue > 0) {
      const ppu = unitPrice / numValue
      onChange(numValue, newUnit, ppu)
    }
  }

  // PPU 계산
  const ppu = quantity && parseFloat(quantity) > 0 
    ? unitPrice / parseFloat(quantity) 
    : null

  if (disabled) {
    return (
      <div className="text-xs text-gray-500">
        {currentQuantity && currentUnit ? (
          <span>{currentQuantity}{currentUnit} ({ppu?.toFixed(1)}원/{currentUnit})</span>
        ) : (
          <span className="text-gray-400">규격 미입력</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* 빠른 선택 버튼 */}
      {!showInput && (
        <div className="flex flex-wrap gap-1">
          {QUICK_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => handleQuickSelect(opt)}
              className="rounded bg-gray-100 px-2 py-1 text-xs hover:bg-gray-200"
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => setShowInput(true)}
            className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
          >
            직접입력
          </button>
        </div>
      )}

      {/* 직접 입력 */}
      {showInput && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={quantity}
            onChange={(e) => handleQuantityChange(e.target.value)}
            placeholder="수량"
            className="w-16 rounded border px-2 py-1 text-xs"
          />
          <select
            value={unit}
            onChange={(e) => handleUnitChange(e.target.value as SpecUnit)}
            className="rounded border px-1 py-1 text-xs"
          >
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="ea">개</option>
          </select>
          {ppu !== null && (
            <span className="text-xs text-blue-600 font-medium">
              {ppu.toFixed(1)}원/{unit}
            </span>
          )}
        </div>
      )}

      {/* PPU 비교 힌트 */}
      {showInput && !quantity && (
        <div className="flex flex-wrap gap-1">
          {QUICK_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => handleQuickSelect(opt)}
              className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// PPU 비교 결과 표시 컴포넌트
interface PPUComparisonProps {
  userPPU?: number
  userUnit?: SpecUnit
  supplierPPU?: number
  supplierUnit?: SpecUnit
  supplierName: 'CJ' | '신세계'
}

export function PPUComparison({
  userPPU,
  userUnit,
  supplierPPU,
  supplierUnit,
  supplierName,
}: PPUComparisonProps) {
  // 단위가 다르면 비교 불가
  if (!userPPU || !supplierPPU || userUnit !== supplierUnit) {
    return null
  }

  const diff = userPPU - supplierPPU
  const isCheaper = diff > 0
  const diffPercent = ((diff / userPPU) * 100).toFixed(0)

  return (
    <span
      className={cn(
        'text-[10px] font-medium',
        isCheaper ? 'text-green-600' : 'text-red-500'
      )}
    >
      {isCheaper ? `↓${diffPercent}% 저렴` : `↑${Math.abs(parseFloat(diffPercent))}% 비쌈`}
    </span>
  )
}

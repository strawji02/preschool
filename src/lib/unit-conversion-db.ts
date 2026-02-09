/**
 * 단위 환산 데이터베이스 연동
 */

import { createClient } from '@/lib/supabase/server'

export interface UnitConversion {
  id: number
  category: string | null
  from_unit: string
  to_unit: string
  conversion_factor: number
  source: 'manual' | 'learned'
  confidence: number | null
  created_at: string
  updated_at: string
}

/**
 * 특정 품목과 단위에 대한 환산 규칙 조회
 *
 * @param category 품목 카테고리 (예: "양파")
 * @param fromUnit 원본 단위 (예: "망")
 * @param toUnit 변환할 단위 (예: "KG")
 * @returns 환산 계수 또는 null
 */
export async function getConversionFactor(
  category: string | null,
  fromUnit: string,
  toUnit: string
): Promise<number | null> {
  const supabase = await createClient()

  // 1. 카테고리가 일치하는 규칙 우선 조회
  if (category) {
    const { data, error } = await supabase
      .from('unit_conversions')
      .select('conversion_factor')
      .eq('category', category)
      .eq('from_unit', fromUnit)
      .eq('to_unit', toUnit)
      .single()

    if (!error && data) {
      return data.conversion_factor
    }
  }

  // 2. 카테고리가 null인 범용 규칙 조회
  const { data, error } = await supabase
    .from('unit_conversions')
    .select('conversion_factor')
    .is('category', null)
    .eq('from_unit', fromUnit)
    .eq('to_unit', toUnit)
    .single()

  if (!error && data) {
    return data.conversion_factor
  }

  return null
}

/**
 * 모든 환산 규칙 조회
 */
export async function getAllConversions(): Promise<UnitConversion[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('unit_conversions')
    .select('*')
    .order('category', { ascending: true, nullsFirst: false })
    .order('from_unit', { ascending: true })

  if (error) {
    console.error('Failed to fetch unit conversions:', error)
    return []
  }

  return data as UnitConversion[]
}

/**
 * 새로운 환산 규칙 추가
 */
export async function createConversion(
  conversion: Omit<UnitConversion, 'id' | 'created_at' | 'updated_at'>
): Promise<UnitConversion | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('unit_conversions')
    .insert(conversion)
    .select()
    .single()

  if (error) {
    console.error('Failed to create unit conversion:', error)
    return null
  }

  return data as UnitConversion
}

/**
 * 환산 규칙 수정
 */
export async function updateConversion(
  id: number,
  updates: Partial<Omit<UnitConversion, 'id' | 'created_at' | 'updated_at'>>
): Promise<UnitConversion | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('unit_conversions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Failed to update unit conversion:', error)
    return null
  }

  return data as UnitConversion
}

/**
 * 환산 규칙 삭제
 */
export async function deleteConversion(id: number): Promise<boolean> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('unit_conversions')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Failed to delete unit conversion:', error)
    return false
  }

  return true
}

/**
 * 학습된 규칙 추가 (실제 납품 데이터 기반)
 *
 * @param category 품목 카테고리
 * @param fromUnit 원본 단위
 * @param toUnit 변환 단위
 * @param samples 샘플 데이터 배열 (환산 계수)
 * @returns 생성된 규칙 또는 null
 */
export async function learnConversionFromData(
  category: string,
  fromUnit: string,
  toUnit: string,
  samples: number[]
): Promise<UnitConversion | null> {
  if (samples.length === 0) {
    return null
  }

  // 평균 환산 계수 계산
  const avgFactor = samples.reduce((sum, val) => sum + val, 0) / samples.length

  // 표준편차로 신뢰도 계산 (변동이 적을수록 신뢰도 높음)
  const variance = samples.reduce((sum, val) => sum + Math.pow(val - avgFactor, 2), 0) / samples.length
  const stdDev = Math.sqrt(variance)
  const confidence = Math.max(0, 1 - stdDev / avgFactor) // 0~1 사이 값

  return createConversion({
    category,
    from_unit: fromUnit,
    to_unit: toUnit,
    conversion_factor: avgFactor,
    source: 'learned',
    confidence,
  })
}

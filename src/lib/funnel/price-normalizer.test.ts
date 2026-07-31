import { describe, it, expect } from 'vitest'
import {
  extractWeight,
  normalizeToGram,
  calculatePricePerGram,
  calculatePricePerUnit,
} from './price-normalizer'

/**
 * [비교] 규격 → 단위중량 환산 (docs/systems/comparison.md §4)
 *
 * ★ 원래 `console.log` + `npx tsx`로 돌리는 수동 스크립트였다. 2026-07-31 vitest로 옮겼다.
 *
 * 옮긴 이유: 파일명이 `.test.ts`라 vitest가 수집했지만 `describe`가 없어
 * **"No test suite found"로 상시 FAIL**이었다. 통과 667개 옆에 빨간 줄 3개가
 * 항상 있어서, 진짜 실패가 생겨도 묻힌다.
 *
 * 게다가 스크립트는 `✅ ${cond ? 'PASS' : 'FAIL'}`를 찍을 뿐 **종료 코드가 항상 0**이라,
 * 직접 실행해도 실패를 잡지 못했다. 이중으로 무용지물이었다.
 *
 * 이 모듈은 `SearchPanel.tsx`가 쓰는 **운영 코드**다. 절감액 계산의 분모가 되므로
 * 여기가 틀리면 원장에게 제출하는 제안서의 숫자가 틀린다.
 */

describe('extractWeight — 규격 문자열에서 중량 뽑기', () => {
  it('2KG → 2kg', () => {
    expect(extractWeight('2KG')).toMatchObject({ value: 2, unit: 'kg' })
  })

  it('500g → 500g', () => {
    expect(extractWeight('500g')).toMatchObject({ value: 500, unit: 'g' })
  })

  it('1박스(10kg) — 괄호 안의 실중량을 쓴다', () => {
    // 박스 개수(1)가 아니라 내용물 중량(10kg)이 단가의 기준이다
    expect(extractWeight('1박스(10kg)')).toMatchObject({ value: 10, unit: 'kg' })
  })

  it('20개입 → 개수 단위', () => {
    expect(extractWeight('20개입')).toMatchObject({ value: 20, unit: 'ea' })
  })

  it('빈 문자열은 null', () => {
    expect(extractWeight('')).toBeNull()
  })
})

describe('normalizeToGram — 기준 단위로 환산', () => {
  it.each([
    [{ value: 2, unit: 'kg' }, 2000],
    [{ value: 500, unit: 'g' }, 500],
    [{ value: 10, unit: 'kg' }, 10000],
    [{ value: 2, unit: 'L' }, 2000],
    [{ value: 500, unit: 'ml' }, 500],
    [{ value: 20, unit: 'ea' }, 20],
  ])('%o → %i', (input, expected) => {
    expect(normalizeToGram(input as never)).toBe(expected)
  })
})

describe('calculatePricePerGram — 단위당 단가', () => {
  it('10000원 / 2KG = 5원/g', () => {
    expect(calculatePricePerGram(10000, '2KG')).toBe(5)
  })

  it('5000원 / 500g = 10원/g', () => {
    expect(calculatePricePerGram(5000, '500g')).toBe(10)
  })

  it('15000원 / 1박스(10kg) = 1.5원/g', () => {
    expect(calculatePricePerGram(15000, '1박스(10kg)')).toBe(1.5)
  })

  it('3000원 / 20개입 = 150원/ea', () => {
    expect(calculatePricePerGram(3000, '20개입')).toBe(150)
  })

  it('규격을 못 읽으면 null — 0으로 만들지 않는다', () => {
    // 0을 반환하면 "공짜"로 집계되어 절감액이 부풀려진다
    expect(calculatePricePerGram(10000, '알수없음')).toBeNull()
  })
})

describe('calculatePricePerUnit — 단가 + 단위 + 환산량', () => {
  it('10000원 / 2KG', () => {
    expect(calculatePricePerUnit(10000, '2KG')).toMatchObject({
      pricePerUnit: 5,
      unit: 'g',
      normalizedQuantity: 2000,
    })
  })

  it('8000원 / 2L — 부피는 ml 기준', () => {
    expect(calculatePricePerUnit(8000, '2L')).toMatchObject({
      pricePerUnit: 4,
      unit: 'ml',
      normalizedQuantity: 2000,
    })
  })

  it('12000원 / 10개 — 개수는 환산하지 않는다', () => {
    expect(calculatePricePerUnit(12000, '10개')).toMatchObject({
      pricePerUnit: 1200,
      unit: 'ea',
      normalizedQuantity: 10,
    })
  })
})

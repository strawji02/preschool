/**
 * 신세계 카탈로그 → `products` 컬럼 변환 규칙 — **한 곳에만 둔다.**
 *
 * 두 경로가 같은 테이블을 채운다:
 *
 * ```
 * scripts/sync-shinsegae.ts          신세계 단가조회 엑셀 전체 동기화 (단종 마킹 포함)
 * scripts/add-price-book-products.ts 월별 단가표의 신규 품목만 추가 (comparison.md §9)
 * ```
 *
 * 규칙이 갈라지면 같은 품목이 경로에 따라 다른 `unit_normalized`·`is_food`로
 * 들어가고, 매칭 결과가 조용히 달라진다.
 */

import { parseShinsegaeSpec } from './spec-parser'

/**
 * spec_quantity / spec_unit 파싱.
 *
 * ⚠️ 단순 정규식을 쓰면 `10G*100개` 같은 곱셈 패턴에서 baseQty만 잡아 단위중량이
 * 틀린다. `parseShinsegaeSpec`을 쓴다.
 */
export function parseSpecQU(spec: string | null): { quantity: number | null; unit: string | null } {
  if (!spec) return { quantity: null, unit: null }
  const r = parseShinsegaeSpec(spec)
  return { quantity: r.quantity, unit: r.unit }
}

/**
 * tax_type 정규화 — `과세 / 의제매입대상` 같은 변형을 두 값으로 좁힌다.
 * DB의 check constraint가 `과세`/`면세`만 받는다.
 *
 * 월별 단가표는 파서가 이미 `taxable`/`exempt`로 바꿔 저장한다 — 그것도 받는다.
 */
export function normalizeTaxType(t: string | null): string | null {
  if (!t) return null
  const s = t.trim()
  if (s === 'exempt') return '면세'
  if (s === 'taxable') return '과세'
  if (s.includes('면세')) return '면세'
  if (s.includes('과세')) return '과세'
  return null
}

export function normalizeUnit(u: string | null): string {
  if (!u) return 'EA'
  const upper = u.toUpperCase().trim()
  if (['KG', 'G'].includes(upper)) return upper
  if (['L', 'ML'].includes(upper)) return upper
  if (['봉', 'BAG'].includes(upper)) return 'BAG'
  if (['박스', 'BOX', 'CTN'].includes(upper)) return 'BOX'
  if (['팩', 'PAC', 'PACK'].includes(upper)) return 'PAC'
  if (['포', 'BAG'].includes(upper)) return 'BAG'
  return 'EA'
}

/**
 * 비식자재 카테고리 — 거래명세표(급식)는 식자재만 다루므로 매칭에서 제외한다.
 * 신규 카테고리가 나오면 콘솔 경고 후 NULL(안전망)로 둔다.
 */
export const NON_FOOD_CATEGORIES = new Set<string>([
  '키친', '잡화', '용기', '유니폼', '사무용품', '소모품',
  '세척용품', '세제', '제지', '위생용품', '안전용품', '사무장비',
  '종이', '일회용품', '인쇄', '연포장', '스티커', '소모품 기타',
])

/** 식자재 카테고리 whitelist — 검증용. 여기 없는 신규 카테고리는 NULL로 둔다. */
export const KNOWN_FOOD_CATEGORIES = new Set<string>([
  '조미료', '농산가공품', '즉석조리', '가공', '음료류', '채소',
  '농산물원물가공', '유제품/빙과류', '즉석섭취', '베이커리', '축산가공품',
  '과자류', '돈육', '수산가공품', '커피/차류', '어류', '농산',
  '가금류', '수입육', '과일', '밀가루/전분', '건어', '양곡', '우육',
  '해조', '김치', '패류', '연체류', '갑각류', '건견과', '수산',
  '건강/특수용도식품', '축산', '난류', '선물세트', '피자', '선도유지',
  '베러푸즈',
])

export function classifyFood(category: string | null): boolean | null {
  if (!category) return null // 안전망 — NULL은 매칭에 포함
  if (NON_FOOD_CATEGORIES.has(category)) return false
  if (KNOWN_FOOD_CATEGORIES.has(category)) return true
  console.warn(`⚠️ 알 수 없는 카테고리 (NULL로 마킹 — 안전망): "${category}"`)
  return null
}

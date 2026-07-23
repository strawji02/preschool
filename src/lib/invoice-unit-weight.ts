/**
 * 거래명세서(기존 업체) 품목의 "1 발주 단위당 무게(g)" 산출 (2026-07-23 추출)
 *
 * 배경: 명세서마다 규격 표기가 제각각(계속 새 포맷이 들어옴)이고, OCR/파서가 발주단위를
 *   coarse하게 "EA"로 기록하는 경우가 많다. 기존 로직은 `extracted_unit + extracted_spec`을
 *   합쳐 파싱해, 규격이 "PK.(250g*5ea)"·"KG(개당100g)"처럼 진짜 포장단위를 담고 있어도
 *   앞에 붙은 "EA"가 unitType을 EA로 뒤집어 팩당 개수를 안 곱하거나 KG를 개당중량으로 오인했다.
 *   → 총 발주량이 실제의 1/5 ~ 1/85로 축소되는 버그(#48·#120·#34 등).
 *
 * 개선: **규격 문자열이 발주단위 토큰(KG/PK/BOX/팩/박스)을 선두에 담고 있으면 규격을 우선 파싱**한다
 *   (coarse한 extracted_unit이 덮어쓰지 못하게). 규격에 단위 토큰이 없으면 기존처럼 unit+spec 결합
 *   문자열로 폴백한다("400G*6EA/BOX"처럼 박스포장 케이스는 extracted_unit이 필요).
 */
import { parseOrderUnit } from './spec-parser'
import { parseSpecToGrams } from './unit-conversion'
import type { ComparisonItem } from '@/types/audit'

/** 단독 단위 문자열 → 1단위 g */
export function unitToGrams(unit: string | undefined): number | null {
  if (!unit) return null
  const u = unit.toUpperCase().trim()
  if (u === 'KG') return 1000
  if (u === 'G') return 1
  if (u === 'L') return 1000
  if (u === 'ML') return 1
  return null
}

/** spec/품목명에 무게·부피 단위 키워드가 단독으로 있을 때 1단위 환산 (숫자 없는 "상품 KG" 등) */
export function specToUnitFallback(text: string | undefined | null): number | null {
  if (!text) return null
  const t = text.toUpperCase()
  if (/\bKG\b/.test(t)) return 1000
  if (/\bML\b/.test(t)) return 1
  if (/\bL\b/.test(t)) return 1000
  if (/\bG\b/.test(t)) return 1
  return null
}

/** 규격 선두에 발주단위 토큰(KG/PK/BOX/팩/박스)이 있으면 true — 이 경우 규격을 우선 신뢰 */
const SPEC_LEADS_WITH_UNIT = /^\s*(kg|box|박스|상자|pk|pak|pack|팩)\b/i

type InvoiceItemLike = Pick<ComparisonItem, 'extracted_unit' | 'extracted_spec' | 'extracted_name'>

export function resolveInvoiceUnitWeightG(item: InvoiceItemLike): number | null {
  const spec = item.extracted_spec ?? ''
  // 규격이 발주단위(KG/PK/BOX)를 명시하면 규격 단독 파싱을 최우선 —
  //   coarse한 extracted_unit("EA")이 unitType을 덮어써 팩당개수/KG를 왜곡하는 것을 방지.
  const specFirst = SPEC_LEADS_WITH_UNIT.test(spec) ? parseOrderUnit(spec).unitWeightG : null
  const combined = [item.extracted_unit, item.extracted_spec].filter(Boolean).join(' ')
  return (
    specFirst ??
    parseOrderUnit(combined).unitWeightG ??
    unitToGrams(item.extracted_unit) ??
    parseSpecToGrams(item.extracted_spec) ??
    parseSpecToGrams(item.extracted_name) ??
    specToUnitFallback(item.extracted_spec) ??
    specToUnitFallback(item.extracted_name)
  )
}

import type { CjStatementItem } from '../parse/cj-statement'
import type { NormalizedVenue, TaxBreakdown } from '../parse/types'

/**
 * 품목 단위 조정 — docs/systems/settlement/조정.md §18
 *
 * ★ **왜 원천을 고치지 않는가.** CJ 집계표가 먼저 확정된 뒤에 영업파트너의
 * 본인부담 요청이 온다. 집계표를 매번 재발행받으면 마감이 CJ 일정에 묶이고,
 * 재발행본이 거래명세서와 또 어긋나 교차검증(§5-2)이 깨진다.
 *
 * 그래서 **원천은 사실 그대로 두고, 조정을 우리 쪽 기록으로 얹는다.**
 * "CJ가 이렇게 청구했고, 우리가 이만큼을 뺐다"가 둘 다 남는다.
 *
 * ★ **단가에서만 뺀다. 원가는 손대지 않는다.**
 * 품목별 원가를 알 수 없고(역산 14곳 중 0곳 일치, §5-2), 물건은 이미 납품돼
 * 원가는 CJ에 그대로 나간다. 그 결과가 요건과 정확히 맞는다:
 *
 * ```
 * 단가 −X  → 차액 M −X   → 영업파트너가 부담   ✓
 * 원가 불변 → 적립금 O 불변 → 본사는 부담 안 함  ✓
 * ```
 *
 * 과세 품목이면 부가세도 함께 빠지는데, `P = 단가세액 − 원가세액`이 같이 줄어
 * `R = M − O − P − Q`에서 상쇄된다. **파트너 부담은 정확히 공급가 X**다.
 * 유치원에서 받지 않으니 납부할 부가세도 없어 결과가 맞는다.
 */

export type AdjustmentKind =
  /** 정산 제외 — 유치원에 청구하지 않는다 */
  | 'exclude'
  /** 식당 간 이동 — 사업장 합계는 변하지 않는다 */
  | 'move'

/** 저장된 조정 한 건. 원천 품목을 가리키는 키 + 조정량 + 기록. */
export interface StoredAdjustment {
  id: string
  kind: AdjustmentKind
  /** 원천 품목 식별 — 26년 7월 실측에서 이 4개 조합에 중복이 0건이었다 */
  businessName: string
  restaurantName: string
  itemDate: string
  productCode: string
  /** 조정할 수량. 소수 허용 (KG 단위 품목이 46행 있다) */
  quantity: number
  /** `move`일 때 옮겨 갈 식당. `exclude`면 null */
  targetRestaurantName: string | null
  reason: string
  /** 누가 요청했는지 (영업파트너명 등) */
  requestedBy: string
}

/** 원천 금액이 늘 10원 단위라 그 관례를 따른다 */
function round10(n: number): number {
  return Math.round(n / 10) * 10
}

/**
 * 조정 금액을 계산한다.
 *
 * **전량이면 원천 라인 금액을 그대로 쓴다** — 곱셈으로 다시 만들면 반올림 오차가
 * 생길 수 있는데, 전량 조정에서 1원이라도 남으면 안 된다.
 *
 * 부분이면 `단가 × 수량`이다. 원천 2,006행 전부에서 `단가 × 주문량 = 공급가`가
 * 정확함을 확인했다. 소수 수량만 10원 단위로 맞춘다.
 *
 * ⚠️ 한 행은 **과세 아니면 면세**다 (실측: 둘 다 가진 행 0건).
 * 부가세는 과세공급가의 정확히 1/10이다 (실측: 어긋난 행 0건, 과세공급가는 늘 10의 배수).
 */
export function adjustmentAmount(item: CjStatementItem, quantity: number): TaxBreakdown {
  if (quantity === item.quantity) {
    return { ...item.tax }
  }

  const supply = round10(item.unitPrice * quantity)
  const isTaxable = item.tax.taxableSupply > 0
  if (!isTaxable) {
    return { taxableSupply: 0, vat: 0, exempt: supply, total: supply }
  }
  const vat = supply / 10
  return { taxableSupply: supply, vat, exempt: 0, total: supply + vat }
}

export interface ApplyAdjustmentsResult {
  venues: NormalizedVenue[]
  /** 반영할 수 없는 조정. 하나라도 있으면 **아무것도 반영하지 않는다.** */
  errors: string[]
}

/**
 * 조정을 반영한 사업장×식당 목록을 만든다.
 *
 * ⚠️ **오류가 하나라도 있으면 전부 반영하지 않는다.** 일부만 반영하면 화면 숫자가
 * "고치다 만 상태"가 되고, 그게 맞는 값인지 사용자가 판단할 수 없다.
 */
export function applyAdjustments(
  venues: readonly NormalizedVenue[],
  items: readonly CjStatementItem[],
  adjustments: readonly StoredAdjustment[]
): ApplyAdjustmentsResult {
  const asIs = { venues: venues.map(clone), errors: [] as string[] }
  if (adjustments.length === 0) return asIs

  const itemKey = (a: {
    businessName: string
    restaurantName: string
    itemDate?: string
    date?: string
    productCode: string
  }) => `${a.businessName}|${a.restaurantName}|${a.itemDate ?? a.date}|${a.productCode}`

  const itemMap = new Map<string, CjStatementItem>()
  for (const it of items) itemMap.set(itemKey({ ...it, itemDate: it.date }), it)

  const venueMap = new Map<string, NormalizedVenue>()
  for (const v of venues) venueMap.set(`${v.businessName}|${v.restaurantName}`, v)

  const errors: string[] = []
  /** 같은 품목에 조정이 여러 건일 수 있다 — 합계가 원천 수량을 넘으면 안 된다 */
  const usedQty = new Map<string, number>()

  interface Planned {
    from: string
    to: string | null
    amount: TaxBreakdown
  }
  const planned: Planned[] = []

  for (const a of adjustments) {
    const key = itemKey(a)
    const it = itemMap.get(key)
    if (!it) {
      errors.push(
        `${a.restaurantName} ${a.itemDate} ${a.productCode}: 거래명세서에서 품목을 찾지 못했습니다. ` +
          `원천 파일이 바뀌었거나 다른 달일 수 있습니다.`
      )
      continue
    }

    const used = (usedQty.get(key) ?? 0) + a.quantity
    if (a.quantity <= 0 || used > it.quantity) {
      errors.push(
        `${a.restaurantName} ${it.productName}: 조정 수량이 원천을 넘습니다 ` +
          `(원천 ${it.quantity}${it.unit} / 조정 합 ${used}${it.unit}).`
      )
      continue
    }
    usedQty.set(key, used)

    const fromKey = `${a.businessName}|${a.restaurantName}`
    if (!venueMap.has(fromKey)) {
      errors.push(`${a.restaurantName}: 이 식당이 집계표에 없습니다.`)
      continue
    }

    let toKey: string | null = null
    if (a.kind === 'move') {
      if (!a.targetRestaurantName) {
        errors.push(`${a.restaurantName} ${it.productName}: 이동할 식당을 지정해 주세요.`)
        continue
      }
      toKey = `${a.businessName}|${a.targetRestaurantName}`
      if (!venueMap.has(toKey)) {
        // 새로 만들지 않는다 — 식당코드를 알 수 없고, 계산서 품목명도 마스터에 없다.
        errors.push(
          `${a.targetRestaurantName}: 이동할 식당이 집계표에 없습니다. ` +
            `그 달에 그 식당 실적이 있어야 옮길 수 있습니다.`
        )
        continue
      }
    }

    planned.push({ from: fromKey, to: toKey, amount: adjustmentAmount(it, a.quantity) })
  }

  if (errors.length > 0) return { venues: asIs.venues, errors }

  const out = venues.map(clone)
  const outMap = new Map<string, NormalizedVenue>()
  for (const v of out) outMap.set(`${v.businessName}|${v.restaurantName}`, v)

  for (const p of planned) {
    subtract(outMap.get(p.from)!.price, p.amount)
    if (p.to) add(outMap.get(p.to)!.price, p.amount)
  }

  return { venues: out, errors: [] }
}

function clone(v: NormalizedVenue): NormalizedVenue {
  return { ...v, cost: { ...v.cost }, price: { ...v.price } }
}

function subtract(target: TaxBreakdown, amount: TaxBreakdown): void {
  target.taxableSupply -= amount.taxableSupply
  target.vat -= amount.vat
  target.exempt -= amount.exempt
  target.total -= amount.total
}

function add(target: TaxBreakdown, amount: TaxBreakdown): void {
  target.taxableSupply += amount.taxableSupply
  target.vat += amount.vat
  target.exempt += amount.exempt
  target.total += amount.total
}

/** 조정 합계 — 화면·내역서에서 "얼마를 뺐는지" 보여줄 때 쓴다 */
export function sumAdjustments(
  items: readonly CjStatementItem[],
  adjustments: readonly StoredAdjustment[]
): number {
  let sum = 0
  for (const a of adjustments) {
    if (a.kind !== 'exclude') continue // 이동은 사업장 합계를 바꾸지 않는다
    const it = items.find(
      (i) =>
        i.businessName === a.businessName &&
        i.restaurantName === a.restaurantName &&
        i.date === a.itemDate &&
        i.productCode === a.productCode
    )
    if (it) sum += adjustmentAmount(it, a.quantity).total
  }
  return sum
}

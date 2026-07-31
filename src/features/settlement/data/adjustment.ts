import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdjustmentKind, StoredAdjustment } from '../calc/adjustment'

/**
 * 품목 조정 저장·조회 — docs/systems/settlement/조정.md §18
 *
 * 원천 행은 DB에 두지 않는다(매월 업로드 → 메모리 계산). 하지만 **조정은 남아야
 * 한다** — 다음에 같은 달을 다시 분석해도 같은 조정이 적용돼야 하고, 마감 후
 * 산출물을 다시 뽑아도 같은 숫자가 나와야 한다.
 */

/** 목록·화면용. 산식이 쓰는 `StoredAdjustment`에 표시용 필드를 더한 것. */
export interface AdjustmentRecord extends StoredAdjustment {
  period: string
  productName: string
  unit: string
  createdBy: string
  createdAt: string
}

export interface CreateAdjustmentInput {
  period: string
  kind: AdjustmentKind
  businessName: string
  restaurantName: string
  itemDate: string
  productCode: string
  productName: string
  unit: string
  quantity: number
  targetRestaurantName: string | null
  reason: string
  requestedBy: string
  createdBy: string
}

export class AdjustmentError extends Error {}

interface Row {
  id: string
  period: string
  kind: string
  business_name: string
  restaurant_name: string
  item_date: string
  product_code: string
  product_name: string
  unit: string
  quantity: number | string
  target_restaurant_name: string | null
  reason: string
  requested_by: string
  created_by: string
  created_at: string
}

function toRecord(r: Row): AdjustmentRecord {
  return {
    id: r.id,
    period: r.period,
    kind: r.kind as AdjustmentKind,
    businessName: r.business_name,
    restaurantName: r.restaurant_name,
    // `date` 컬럼은 `2026-07-06` 형태로 오지만, 드라이버가 시각을 붙이는 경우가 있어 잘라 쓴다
    itemDate: String(r.item_date).slice(0, 10),
    productCode: r.product_code,
    productName: r.product_name,
    unit: r.unit,
    // numeric은 문자열로 온다 (정밀도 보존). 소수 수량이 있으므로 Number로 바꾼다.
    quantity: Number(r.quantity),
    targetRestaurantName: r.target_restaurant_name,
    reason: r.reason,
    requestedBy: r.requested_by,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }
}

const COLUMNS =
  'id, period, kind, business_name, restaurant_name, item_date, product_code, ' +
  'product_name, unit, quantity, target_restaurant_name, reason, requested_by, ' +
  'created_by, created_at'

export async function listAdjustments(period: string): Promise<AdjustmentRecord[]> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_adjustments')
    .select(COLUMNS)
    .eq('period', period)
    .order('item_date')
    .order('created_at')
  if (error) throw new AdjustmentError(`조정 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => toRecord(r as unknown as Row))
}

export async function createAdjustment(
  input: CreateAdjustmentInput
): Promise<AdjustmentRecord> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('settlement_adjustments')
    .insert({
      period: input.period,
      kind: input.kind,
      business_name: input.businessName,
      restaurant_name: input.restaurantName,
      item_date: input.itemDate,
      product_code: input.productCode,
      product_name: input.productName,
      unit: input.unit,
      quantity: input.quantity,
      target_restaurant_name: input.targetRestaurantName,
      reason: input.reason,
      requested_by: input.requestedBy,
      created_by: input.createdBy,
    })
    .select(COLUMNS)
    .single()
  if (error) throw new AdjustmentError(`조정 저장 실패: ${error.message}`)
  return toRecord(data as unknown as Row)
}

/**
 * 조정을 지운다.
 *
 * 수정 기능은 두지 않는다 — 지우고 다시 넣는 게 이력상 더 명확하다.
 * (금액을 슬쩍 고치는 것과 "뺐다가 되돌렸다"는 다른 사건이다)
 */
export async function deleteAdjustment(id: string): Promise<void> {
  const db = createAdminClient()
  const { error } = await db.from('settlement_adjustments').delete().eq('id', id)
  if (error) throw new AdjustmentError(`조정 삭제 실패: ${error.message}`)
}

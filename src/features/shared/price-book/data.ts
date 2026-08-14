import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPriceBookPeriod, type PriceBookItem } from './parse'

/**
 * 신세계 월별 단가표 저장·조회 — docs/systems/settlement/단가표.md §21
 *
 * ★ **연월은 사용자가 고른다.** 파일에 월 표기가 없다. 그래서 저장 전에
 * **직전 달 결정단가와 대조**해 오선택을 막는다 (`checkPriceBookPeriod`).
 */

export class PriceBookError extends Error {}

export interface PriceBookSummary {
  period: string
  itemCount: number
  originCount: number
  uploadedAt: string
  uploadedBy: string
}

/** 거래명세표가 쓰는 최소 정보 */
export interface PriceLookup {
  origin: string
  price: number
  productName: string
}

const TABLE = 'shinsegae_price_book'

/** `2026-07` → `2026-06` */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/**
 * 한 달치를 통째로 갈아끼운다.
 *
 * ⚠️ **먼저 지우고 넣는다.** 품목이 빠진 달을 다시 올렸을 때 옛 품목이 남으면
 * 그 달에 없던 원산지가 명세표에 찍힌다.
 */
export async function savePriceBook(input: {
  period: string
  items: readonly PriceBookItem[]
  actor: string
  /** 연월 검증을 건너뛴다 — 사용자가 경고를 보고 강행할 때만 */
  force?: boolean
}): Promise<{ saved: number; check: ReturnType<typeof checkPriceBookPeriod> }> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) {
    throw new PriceBookError('단가표 연월을 YYYY-MM 형식으로 골라 주세요.')
  }
  if (input.items.length === 0) {
    throw new PriceBookError('단가표에서 품목을 찾지 못했습니다.')
  }

  const prev = await loadPriceBookPrices(previousPeriod(input.period))
  const check = checkPriceBookPeriod(input.items, prev.length > 0 ? prev : null)
  if (!check.ok && !input.force) {
    throw new PriceBookError(check.message ?? '연월을 확인해 주세요.')
  }

  const supabase = createAdminClient()
  const { error: delErr } = await supabase.from(TABLE).delete().eq('period', input.period)
  if (delErr) throw new PriceBookError(`이전 단가표를 지우지 못했습니다: ${delErr.message}`)

  // 7,800행을 한 번에 넣으면 요청이 너무 커진다. 나눠 넣는다.
  const CHUNK = 1000
  for (let i = 0; i < input.items.length; i += CHUNK) {
    const rows = input.items.slice(i, i + CHUNK).map((it) => ({
      period: input.period,
      product_code: it.productCode,
      product_name: it.productName,
      category: it.category,
      item_group: it.group,
      unit: it.unit,
      origin: it.origin,
      spec: it.spec,
      previous_price: it.previousPrice,
      price: it.price,
      delta_rate: it.deltaRate,
      tax_kind: it.taxKind,
      supplier: it.supplier,
      order_cutoff: it.orderCutoff,
      uploaded_by: input.actor,
    }))
    const { error } = await supabase.from(TABLE).insert(rows)
    if (error) throw new PriceBookError(`단가표 저장 실패: ${error.message}`)
  }

  return { saved: input.items.length, check }
}

/** 연월 검증용 — 코드와 결정단가만 */
export async function loadPriceBookPrices(
  period: string
): Promise<{ productCode: string; price: number }[]> {
  const supabase = createAdminClient()
  const out: { productCode: string; price: number }[] = []
  // PostgREST 기본 상한(1,000행)을 넘으므로 나눠 읽는다
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('product_code, price')
      .eq('period', period)
      .range(from, from + PAGE - 1)
    if (error) throw new PriceBookError(`단가표 조회 실패: ${error.message}`)
    const rows = data ?? []
    out.push(...rows.map((r) => ({ productCode: r.product_code, price: Number(r.price) })))
    if (rows.length < PAGE) break
  }
  return out
}

/**
 * 거래명세표용 조회 — 품목코드 → 원산지·원가.
 *
 * ⚠️ **필요한 코드만 가져온다.** 한 달치를 통째로 읽으면 7,800행에 2.8초가 걸린다.
 * 명세표 한 장에 쓰는 코드는 수백 개뿐이다.
 */
export async function loadPriceLookup(
  period: string,
  productCodes: readonly string[]
): Promise<Map<string, PriceLookup>> {
  const map = new Map<string, PriceLookup>()
  const codes = [...new Set(productCodes)].filter((c) => c !== '')
  if (codes.length === 0) return map

  const supabase = createAdminClient()
  // `in()`에 너무 많이 넣으면 URL이 길어져 거부된다. 나눠 묻는다.
  const CHUNK = 300
  for (let i = 0; i < codes.length; i += CHUNK) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('product_code, origin, price, product_name')
      .eq('period', period)
      .in('product_code', codes.slice(i, i + CHUNK))
    if (error) throw new PriceBookError(`단가표 조회 실패: ${error.message}`)
    for (const r of data ?? []) {
      map.set(r.product_code, {
        origin: r.origin ?? '',
        price: Number(r.price),
        productName: r.product_name ?? '',
      })
    }
  }
  return map
}

/**
 * 화면이 "어느 달이 있나"를 묻는다.
 *
 * ⚠️ 앱에서 세지 않는다 — 9만 행을 통째로 읽게 된다. DB 뷰가 집계한다.
 */
export async function listPriceBooks(): Promise<PriceBookSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('shinsegae_price_book_periods')
    .select('period, item_count, origin_count, uploaded_at, uploaded_by')
    .order('period', { ascending: false })
  if (error) throw new PriceBookError(`단가표 목록 조회 실패: ${error.message}`)
  return (data ?? []).map((r) => ({
    period: r.period,
    itemCount: Number(r.item_count),
    originCount: Number(r.origin_count),
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploaded_by ?? '',
  }))
}

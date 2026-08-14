import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api-error'
import { loadSessionPricePeriod, withPeriodPrices } from '@/features/shared/price-book'

/**
 * GET /api/products/:id
 * 단일 제품 상세 정보 (원산지/카테고리/세금구분/보관온도 등 풍부 메타) — 정밀 검수용 lazy fetch
 *
 * ★ `?sessionId=`를 주면 **그 세션의 기준월 단가**로 바꿔 돌려준다
 * (docs/systems/comparison.md §9). 없으면 `products` 값 그대로 — 기존 동작.
 *
 * ⚠️ 기준월을 클라이언트가 정하게 두지 않는다. 세션 id만 받아 **서버가** 읽는다.
 * 화면이 임의의 달을 넣으면 검수 화면과 저장된 절감액이 갈린다.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })
    }
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('products')
      .select(
        'id, supplier, product_code, product_name, standard_price, unit_raw, unit_normalized, spec_raw, spec_quantity, spec_unit, category, subcategory, origin, origin_detail, tax_type, storage_temp, supply_status, previous_price, price_changed_at, supplier_partner',
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      return apiError(error, 500, 'product-get')
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    /*
      검수 화면이 보는 단가를 **매칭이 쓴 단가와 같게** 맞춘다. 세션 기준월이
      있는데 여기만 products 값을 보여 주면, 같은 품목의 단가가 두 자리에서
      다르게 보인다.
    */
    const sessionId = request.nextUrl.searchParams.get('sessionId')
    const period = sessionId ? await loadSessionPricePeriod(sessionId) : null
    const [product] = await withPeriodPrices([data], period)

    return NextResponse.json({ success: true, product })
  } catch (e) {
    return apiError(e, 500, 'product-get')
  }
}

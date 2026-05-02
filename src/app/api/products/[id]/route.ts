import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/products/:id
 * 단일 제품 상세 정보 (원산지/카테고리/세금구분/보관온도 등 풍부 메타) — 정밀 검수용 lazy fetch
 */
export async function GET(
  _request: NextRequest,
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
        'id, supplier, product_code, product_name, standard_price, unit_raw, unit_normalized, spec_raw, spec_quantity, spec_unit, category, subcategory, origin, tax_type, storage_temp, supply_status',
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, product: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

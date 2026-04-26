import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * PATCH /api/audit-items/[id]
 * 거래명세표 검수 시 행 수정 (수량/단가/공급가액/세액/총액/품목명/규격/단위)
 *
 * Phase 1 검수 단계 (2026-04-26):
 * 검수자가 OCR 오인식을 직접 수정. 이후 매칭 단계에서 사용됨.
 */
const ALLOWED_FIELDS = [
  'extracted_name',
  'extracted_spec',
  'extracted_unit',
  'extracted_quantity',
  'extracted_unit_price',
  'extracted_supply_amount',
  'extracted_tax_amount',
  'extracted_total_price',
] as const

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const f of ALLOWED_FIELDS) {
      if (body[f] !== undefined) update[f] = body[f]
    }

    const supabase = createAdminClient()
    const { error } = await supabase.from('audit_items').update(update).eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/audit-items/[id]
 * 거래명세표 검수 시 잘못 추출된 행 (합계행, 중복 등) 삭제
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { error } = await supabase.from('audit_items').delete().eq('id', id)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

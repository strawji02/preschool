import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/audit-items
 * 거래명세표 검수 시 OCR이 누락한 행 수동 추가 (2026-04-26)
 *
 * 매칭 전 단계라 matched_product_id/match_score는 NULL,
 * match_status='unmatched'로 시작 → 이후 매칭 단계에서 자동/수동 매칭
 */
interface AddRowBody {
  session_id: string
  page_number: number
  source_file_name?: string
  extracted_name: string
  extracted_spec?: string
  extracted_unit?: string
  extracted_quantity: number
  extracted_unit_price: number
  extracted_supply_amount?: number
  extracted_tax_amount?: number
  extracted_total_price?: number
}

export async function POST(request: NextRequest) {
  try {
    const body: AddRowBody = await request.json()
    if (!body.session_id || !body.page_number || !body.extracted_name) {
      return NextResponse.json(
        { success: false, error: 'Missing session_id, page_number or extracted_name' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    // row_index: 같은 페이지의 max(row_index) + 1
    const { data: existing } = await supabase
      .from('audit_items')
      .select('row_index')
      .eq('session_id', body.session_id)
      .eq('page_number', body.page_number)
      .order('row_index', { ascending: false })
      .limit(1)
    const nextRowIndex = existing && existing.length > 0 ? (existing[0].row_index ?? 0) + 1 : 0

    const insertPayload: Record<string, unknown> = {
      session_id: body.session_id,
      page_number: body.page_number,
      row_index: nextRowIndex,
      source_file_name: body.source_file_name ?? null,
      extracted_name: body.extracted_name,
      extracted_spec: body.extracted_spec ?? null,
      extracted_unit: body.extracted_unit ?? null,
      extracted_quantity: body.extracted_quantity,
      extracted_unit_price: body.extracted_unit_price,
      extracted_supply_amount: body.extracted_supply_amount ?? null,
      extracted_tax_amount: body.extracted_tax_amount ?? null,
      extracted_total_price: body.extracted_total_price ?? null,
      match_status: 'unmatched',
      is_excluded: false,
    }

    const { data, error } = await supabase
      .from('audit_items')
      .insert(insertPayload)
      .select('id')
      .single()
    if (error || !data) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Insert failed' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true, item_id: data.id })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

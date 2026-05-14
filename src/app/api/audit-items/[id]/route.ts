import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api-error'

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
  // 정밀 검수 조정값 (2026-05-04)
  'adjusted_quantity',
  'adjusted_unit_weight_g',
  'adjusted_pack_unit',
  'precision_reviewed_at',
  // 매칭 변경/확정 (2026-05-04) — 새로고침 시 보존
  'matched_product_id',
  'match_score',
  'match_status',
  'standard_price',
  'match_candidates',
  'is_excluded',
  // 검수자 의견 (2026-05-08, migration 041) — AI 학습용
  'reviewer_note',
  // 원산지 수정 (2026-05-11, migration 044) — OCR 누락/오판정 보강
  'extracted_origin',
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
      return apiError(error, 500, 'audit-items-patch')
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 500, 'audit-items-patch')
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
      return apiError(error, 500, 'audit-items-delete')
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 500, 'audit-items-delete')
  }
}

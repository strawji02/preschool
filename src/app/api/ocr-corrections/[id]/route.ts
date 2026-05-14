import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api-error'

/**
 * DELETE /api/ocr-corrections/[id]
 * 보정 패턴 비활성화 (soft delete)
 *
 * PATCH /api/ocr-corrections/[id]
 * 메모/카테고리 수정
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('ocr_corrections')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      return apiError(error, 500, 'ocr-corrections-delete')
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 500, 'ocr-corrections-delete')
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.correct !== undefined) update.correct = body.correct
    if (body.category !== undefined) update.category = body.category
    if (body.note !== undefined) update.note = body.note

    const supabase = createAdminClient()
    const { error } = await supabase.from('ocr_corrections').update(update).eq('id', id)
    if (error) {
      return apiError(error, 500, 'ocr-corrections-patch')
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    return apiError(e, 500, 'ocr-corrections-patch')
  }
}

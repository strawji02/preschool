import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api-error'

/**
 * GET /api/ocr-corrections
 * 활성 OCR 보정 사전 목록 (gemini.ts와 관리 UI에서 사용)
 *
 * POST /api/ocr-corrections
 * 새 보정 패턴 등록 (검수자 행 편집 시 [사전 등록] 버튼)
 *   { wrong, correct, category?, note? }
 */
export async function GET() {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('ocr_corrections')
      .select('id, wrong, correct, category, note, applied_count, created_at, updated_at')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
    if (error) {
      return apiError(error, 500, 'ocr-corrections-list')
    }
    return NextResponse.json({ success: true, corrections: data ?? [] })
  } catch (e) {
    return apiError(e, 500, 'ocr-corrections-list')
  }
}

interface CreateBody {
  wrong: string
  correct: string
  category?: 'supplier' | 'food' | 'cut' | 'general'
  note?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateBody = await request.json()
    const wrong = (body.wrong ?? '').trim()
    const correct = (body.correct ?? '').trim()

    if (!wrong || !correct) {
      return NextResponse.json(
        { success: false, error: 'wrong, correct 필드는 필수입니다.' },
        { status: 400 },
      )
    }
    if (wrong === correct) {
      return NextResponse.json(
        { success: false, error: 'wrong과 correct가 같으면 등록할 수 없습니다.' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()

    // 활성 사전에 같은 wrong이 있으면 correct만 업데이트 (덮어쓰기 정책)
    const { data: existing } = await supabase
      .from('ocr_corrections')
      .select('id')
      .eq('wrong', wrong)
      .eq('is_active', true)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('ocr_corrections')
        .update({
          correct,
          category: body.category ?? null,
          note: body.note ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (error) {
        return apiError(error, 500, 'ocr-corrections-update')
      }
      return NextResponse.json({ success: true, id: existing.id, updated: true })
    }

    const { data, error } = await supabase
      .from('ocr_corrections')
      .insert({
        wrong,
        correct,
        category: body.category ?? null,
        note: body.note ?? null,
      })
      .select('id')
      .single()
    if (error || !data) {
      return apiError(error ?? new Error('Insert failed'), 500, 'ocr-corrections-create')
    }
    return NextResponse.json({ success: true, id: data.id, created: true })
  } catch (e) {
    return apiError(e, 500, 'ocr-corrections-create')
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError } from '@/lib/api-error'

/**
 * POST /api/session/page-totals
 * 세션의 페이지별 OCR footer 합계를 JSONB 배열로 일괄 저장
 *
 * 배경: 여러 페이지가 병렬로 /api/analyze/page를 호출할 때
 * audit_sessions.page_totals 를 직접 upsert하면 경쟁 조건 발생.
 * 클라이언트가 전 페이지 OCR 완료 후 이 endpoint로 단일 writer로 저장.
 */

interface RequestBody {
  session_id: string
  page_totals: Array<{
    page: number
    ocr_total: number
    source_file?: string | null
  }>
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json()

    if (!body.session_id || !Array.isArray(body.page_totals)) {
      return NextResponse.json(
        { success: false, error: 'Missing session_id or page_totals array' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('audit_sessions')
      .update({ page_totals: body.page_totals })
      .eq('id', body.session_id)

    if (error) {
      return apiError(error, 500, 'session-page-totals')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 500, 'session-page-totals')
  }
}

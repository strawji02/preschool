import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/sessions
 * 세션 목록 조회 (활성 세션, 최신순)
 *
 * Response: 세션 카드 표시에 필요한 메타데이터
 *   id, name, kindergarten_name, supplier, total_pages, total_files,
 *   total_items, matched_items, current_step, created_at, updated_at
 */
export async function GET(_request: NextRequest) {
  try {
    const supabase = createAdminClient()

    // 활성(미아카이브) 세션 + 카운트 정보
    // 빈 세션(품목 0개)은 자동 숨김 — 업로드 시도했으나 OCR 실패/중도 취소한 누적 row 정리 (2026-04-26)
    const { data, error } = await supabase
      .from('audit_sessions')
      .select(
        'id, name, kindergarten_name, supplier, status, total_pages, total_files, total_items, matched_items, pending_items, unmatched_items, current_step, created_at, updated_at',
      )
      .eq('is_archived', false)
      .gt('total_items', 0)
      .order('updated_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Sessions list error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, sessions: data ?? [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

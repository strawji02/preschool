import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiError, isValidUuid } from '@/lib/api-error'

/**
 * GET /api/sessions/[id]/page-image/[page]
 * 저장된 거래명세표 페이지의 원본 스캔 이미지에 대한 Signed URL 반환
 *
 * - invoice-images bucket은 private → public URL 사용 불가
 * - 1시간 유효 signed URL 발급
 * - 검수자가 OCR 결과 옆에 원본을 띄워 비교할 때 사용 (2026-04-26)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; page: string }> },
) {
  try {
    const { id, page } = await params
    const pageNum = Number(page)
    // (2026-05-12) UUID 형식 강제 — storage path traversal/ID guessing 차단
    // 추가: pageNum 상한 1000 — 비정상적 큰 값으로 path 폭주 방지
    if (!isValidUuid(id) || !Number.isFinite(pageNum) || pageNum < 1 || pageNum > 1000) {
      return NextResponse.json(
        { success: false, error: 'Invalid session id or page number' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    // 세션 존재 확인 — 임의 UUID로 storage 탐색 차단 (404 noise 줄임)
    const { data: session } = await supabase
      .from('audit_sessions')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const path = `${id}/${pageNum}.jpg`
    const { data, error } = await supabase.storage
      .from('invoice-images')
      .createSignedUrl(path, 3600)

    if (error || !data) {
      return NextResponse.json({ success: false, error: 'Image not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, url: data.signedUrl })
  } catch (error) {
    return apiError(error, 500, 'page-image')
  }
}

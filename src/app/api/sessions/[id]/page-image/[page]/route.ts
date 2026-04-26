import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
    if (!id || !Number.isFinite(pageNum) || pageNum < 1) {
      return NextResponse.json(
        { success: false, error: 'Invalid session id or page number' },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const path = `${id}/${pageNum}.jpg`
    const { data, error } = await supabase.storage
      .from('invoice-images')
      .createSignedUrl(path, 3600)

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: error?.message || 'Image not found' },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, url: data.signedUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InitSessionRequest, InitSessionResponse } from '@/types/audit'

export async function POST(request: NextRequest) {
  try {
    const body: InitSessionRequest = await request.json()

    // Validate request (supplier는 optional)
    if (!body.name || !body.total_pages) {
      return NextResponse.json<InitSessionResponse>(
        { success: false, message: 'Missing required fields: name, total_pages' },
        { status: 400 }
      )
    }

    // supplier가 있으면 유효성 검사
    if (body.supplier && !['CJ', 'SHINSEGAE'].includes(body.supplier)) {
      return NextResponse.json<InitSessionResponse>(
        { success: false, message: 'Invalid supplier. Must be CJ or SHINSEGAE' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Create audit session (supplier는 optional, total_pages/files/kindergarten 추가 2026-04-26)
    const insertPayload: Record<string, unknown> = {
      name: body.name,
      supplier: body.supplier || null,
      status: 'processing',
      total_pages: body.total_pages,
      current_step: 'image_preview',
    }
    /*
      신세계 단가 기준월 (comparison.md §9). 이 세션의 매칭·절감액이 그 달 단가를
      쓴다. 넣지 않으면 NULL — products.standard_price를 쓰는 기존 동작.

      ⚠️ 형식이 틀리면 **막는다.** 통과시키면 DB CHECK가 거부해 세션 생성 자체가
      실패하고, 사용자는 이유를 알 수 없다.
    */
    if (body.price_book_period) {
      if (!/^\d{4}-\d{2}$/.test(body.price_book_period)) {
        return NextResponse.json<InitSessionResponse>(
          { success: false, message: '단가 기준월을 YYYY-MM 형식으로 골라 주세요.' },
          { status: 400 }
        )
      }
      insertPayload.price_book_period = body.price_book_period
    }
    if (body.kindergarten_name) insertPayload.kindergarten_name = body.kindergarten_name
    if (body.total_files != null) insertPayload.total_files = body.total_files

    const { data, error } = await supabase
      .from('audit_sessions')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      console.error('[session-init]', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      const clientMessage =
        process.env.NODE_ENV === 'production'
          ? 'Internal error (session-init)'
          : `Database error: ${error.message}`
      return NextResponse.json<InitSessionResponse>(
        { success: false, message: clientMessage },
        { status: 500 }
      )
    }

    return NextResponse.json<InitSessionResponse>({
      success: true,
      session_id: data.id,
    })
  } catch (error) {
    console.error('Init session error:', error)
    return NextResponse.json<InitSessionResponse>(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}

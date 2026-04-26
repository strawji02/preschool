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
    if (body.kindergarten_name) insertPayload.kindergarten_name = body.kindergarten_name
    if (body.total_files != null) insertPayload.total_files = body.total_files

    const { data, error } = await supabase
      .from('audit_sessions')
      .insert(insertPayload)
      .select('id')
      .single()

    if (error) {
      console.error('Session creation error:', error)
      return NextResponse.json<InitSessionResponse>(
        { success: false, message: `Database error: ${error.message}` },
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

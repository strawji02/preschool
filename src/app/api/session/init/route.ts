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

    // Create audit session (supplier는 optional)
    const { data, error } = await supabase
      .from('audit_sessions')
      .insert({
        name: body.name,
        supplier: body.supplier || null,  // 3rd party 명세서일 경우 null
        status: 'processing',
      })
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

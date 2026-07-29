import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** 로그아웃. CSRF 방지를 위해 POST만 받는다. */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), {
    status: 303, // POST → GET 전환
  })
}

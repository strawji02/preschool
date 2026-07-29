import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'

/**
 * middleware에서 Supabase 세션을 갱신한다 (refresh token rotation).
 *
 * ⚠️ 반환된 `response`를 **그대로** 반환해야 한다. 새 NextResponse를 만들면
 * 갱신된 쿠키가 유실되어 사용자가 임의로 로그아웃되는 버그가 생긴다.
 * 다른 응답을 만들어야 한다면 `copyCookies()`로 쿠키를 옮길 것.
 *
 * @see https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function updateSession(
  request: NextRequest
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // createServerClient와 getUser() 사이에 어떤 코드도 넣지 말 것 (세션 유실 원인).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return { response, user }
}

/**
 * updateSession이 세팅한 쿠키를 다른 응답(redirect 등)으로 옮긴다.
 * 이걸 빼먹으면 브라우저와 서버의 세션이 어긋난다.
 */
export function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie)
  })
  return to
}

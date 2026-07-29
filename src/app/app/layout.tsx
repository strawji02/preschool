import Link from 'next/link'
import type { Metadata } from 'next'
import { requireUser } from '@/features/shared/auth'

export const metadata: Metadata = {
  title: '업무 시스템 | 퍼스트 컨설팅',
  robots: { index: false, follow: false },
}

/**
 * `/app/*` 전 경로의 **보안 경계**.
 *
 * middleware도 세션을 보지만 그건 UX(빠른 리다이렉트)용이다.
 * 실제 차단은 여기서 `requireUser()`로 한다 — 화이트리스트 회수까지 확인한다.
 *
 * 세션 상태에 따라 결과가 달라지므로 정적 렌더링 대상이 되면 안 된다.
 */
export const dynamic = 'force-dynamic'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await requireUser()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/app" className="font-bold text-gray-900">
            퍼스트 컨설팅
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-500 sm:inline">
              {user.name ?? user.email}
              {user.role === 'admin' && (
                <span className="ml-2 rounded bg-gray-900 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  admin
                </span>
              )}
            </span>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition hover:bg-gray-50"
              >
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  )
}

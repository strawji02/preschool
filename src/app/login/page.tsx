import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentUser } from '@/features/shared/auth'
import GoogleSignInButton from './google-sign-in-button'

export const metadata: Metadata = {
  title: '로그인 | 퍼스트 컨설팅',
  robots: { index: false, follow: false },
}

const ERROR_MESSAGES: Record<string, string> = {
  revoked: '접근 권한이 없는 계정입니다. 관리자에게 문의하세요.',
  forbidden: '이 화면에 접근할 권한이 없습니다.',
  missing_code: '로그인 응답이 올바르지 않습니다. 다시 시도해 주세요.',
  exchange: '세션 생성에 실패했습니다. 다시 시도해 주세요.',
  oauth: '로그인이 취소되었거나 승인되지 않은 계정입니다.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; message?: string }>
}) {
  const params = await searchParams

  // 내부 경로만 허용 (open redirect 방지)
  const next =
    params.next?.startsWith('/') && !params.next.startsWith('//')
      ? params.next
      : undefined

  const user = await getCurrentUser()
  if (user) redirect(next ?? '/app')

  const errorText = params.error
    ? (ERROR_MESSAGES[params.error] ?? params.message ?? '로그인에 실패했습니다.')
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <h1 className="text-xl font-bold text-gray-900">퍼스트 컨설팅</h1>
        <p className="mt-1 text-sm text-gray-500">내부 업무 시스템</p>

        {errorText && (
          <p
            className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {errorText}
          </p>
        )}

        <div className="mt-6">
          <GoogleSignInButton next={next} />
        </div>

        <p className="mt-6 text-xs leading-relaxed text-gray-400">
          승인된 계정만 로그인할 수 있습니다. 접근이 필요하면 관리자에게 이메일 등록을
          요청하세요.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block text-xs text-gray-400 underline hover:text-gray-600"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  )
}

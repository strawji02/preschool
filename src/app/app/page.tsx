import Link from 'next/link'
import { requireUser } from '@/features/shared/auth'

interface ModuleCard {
  title: string
  description: string
  href: string
  status: '운영 중' | '개발 중'
  disabled?: boolean
}

const MODULES: ModuleCard[] = [
  {
    title: '급식 정산',
    description:
      '신세계·CJ 원천 데이터를 올려 유치원 청구액과 영업자 지급액을 계산하고, 홈택스·영업자·세무사용 엑셀을 뽑습니다.',
    href: '/app/settlement',
    status: '개발 중',
    disabled: true,
  },
  {
    title: '급식 단가 비교',
    description:
      '거래명세서를 업로드해 품목별 단가를 표준 단가와 비교하고 절감 가능액을 산출합니다.',
    href: '/calc-food',
    status: '운영 중',
  },
]

export default async function AppLauncherPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">
        안녕하세요, {user.name ?? user.email.split('@')[0]}님
      </h1>
      <p className="mt-1 text-sm text-gray-500">사용할 시스템을 선택하세요.</p>

      {params.error === 'forbidden' && (
        <p
          className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          해당 화면에 접근할 권한이 없습니다.
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {MODULES.map((mod) => (
          <ModuleTile key={mod.href} {...mod} />
        ))}
      </div>
    </div>
  )
}

function ModuleTile({ title, description, href, status, disabled }: ModuleCard) {
  const badge = (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        status === '운영 중'
          ? 'bg-green-100 text-green-700'
          : 'bg-amber-100 text-amber-700'
      }`}
    >
      {status}
    </span>
  )

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {badge}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-500">{description}</p>
    </>
  )

  if (disabled) {
    return (
      <div
        className="cursor-not-allowed rounded-2xl border border-gray-200 bg-white p-6 opacity-60"
        aria-disabled="true"
      >
        {body}
      </div>
    )
  }

  return (
    <Link
      href={href}
      className="rounded-2xl border border-gray-200 bg-white p-6 transition hover:border-gray-400 hover:shadow-md"
    >
      {body}
    </Link>
  )
}

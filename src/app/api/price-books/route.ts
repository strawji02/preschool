import { NextResponse } from 'next/server'
import { requireApiUser } from '@/features/shared/auth'
import { listPriceBooks } from '@/features/shared/price-book'

/**
 * 올라와 있는 신세계 월별 단가표 목록 — **정산·비교 양쪽이 쓴다.**
 *
 * 비교 시스템은 세션을 시작할 때 "몇 월 단가로 비교할지" 고른다
 * (docs/systems/comparison.md §9). 정산은 거래명세표의 원산지를 여기서 가져온다
 * (docs/systems/settlement/단가표.md §21).
 *
 * ⚠️ **`/api/settlement/price-book`과 나눠 둔 이유** — 그쪽은 업로드(POST)까지
 * 하는 정산 전용 라우트다. 비교 화면이 정산 라우트를 부르면 두 시스템이
 * 라우트로 얽힌다 (CLAUDE.md 모듈 경계).
 */
export async function GET() {
  const guard = await requireApiUser()
  if ('response' in guard) return guard.response

  try {
    return NextResponse.json({ success: true, books: await listPriceBooks() })
  } catch (err) {
    console.error('[price-books GET]', err)
    return NextResponse.json({ success: false, error: '단가표 목록 조회 실패' }, { status: 500 })
  }
}

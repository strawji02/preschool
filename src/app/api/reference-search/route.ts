import { NextRequest, NextResponse } from 'next/server'
import { normalizeNaverItems, type ReferenceProduct } from '@/lib/naver-shopping'

/**
 * 시중 참고자료 검색 — 네이버 쇼핑 API 프록시
 *
 * 신세계 매칭 상품이 없을 때, 검수자가 수동으로 하던
 * "품명을 네이버에서 검색 → 이미지 확인 → 시중가 점검"을 자동화한다.
 *
 * GET /api/reference-search?q=<품명>[&display=6]
 *   - NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정 → configured:false (graceful, 200)
 *     → 키를 Vercel 환경변수에 등록하면 재배포 없이 다음 호출부터 작동
 *   - 설정됨 → 네이버 쇼핑 검색 후 정규화 결과 반환
 *
 * 키(Client ID/Secret)는 서버 환경변수로만 다룬다(클라이언트 노출·채팅 전달 금지).
 */

export interface ReferenceSearchResponse {
  success: boolean
  configured: boolean // 네이버 키 설정 여부
  items: ReferenceProduct[]
  query?: string
  error?: string
}

const NAVER_ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''
  const display = Math.min(Math.max(parseInt(searchParams.get('display') || '6', 10) || 6, 1), 20)

  if (!query) {
    return NextResponse.json<ReferenceSearchResponse>(
      { success: false, configured: true, items: [], error: 'Query parameter "q" is required' },
      { status: 400 }
    )
  }

  const clientId = process.env.NAVER_CLIENT_ID
  const clientSecret = process.env.NAVER_CLIENT_SECRET

  // 키 미설정 — 골격 상태. UI가 "키 등록하면 사용 가능" 안내를 띄운다.
  if (!clientId || !clientSecret) {
    return NextResponse.json<ReferenceSearchResponse>(
      { success: true, configured: false, items: [], query },
      { status: 200 }
    )
  }

  try {
    const url = `${NAVER_ENDPOINT}?query=${encodeURIComponent(query)}&display=${display}&sort=sim`
    const res = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      // 참고자료는 신선도보다 응답성이 중요 — 1시간 캐시(동일 품명 반복 조회 절감)
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return NextResponse.json<ReferenceSearchResponse>(
        {
          success: false,
          configured: true,
          items: [],
          query,
          error: `네이버 API 오류 (${res.status}) ${body.slice(0, 120)}`,
        },
        { status: 502 }
      )
    }

    const raw = await res.json()
    return NextResponse.json<ReferenceSearchResponse>(
      { success: true, configured: true, items: normalizeNaverItems(raw), query },
      { status: 200 }
    )
  } catch (e) {
    return NextResponse.json<ReferenceSearchResponse>(
      {
        success: false,
        configured: true,
        items: [],
        query,
        error: e instanceof Error ? e.message : '검색 중 오류',
      },
      { status: 500 }
    )
  }
}

/**
 * 네이버 쇼핑 검색 API 응답 정규화
 *
 * 신세계 매칭이 없는 품목에 대해 "시중 참고자료"(상품 이미지·최저가)를
 * 보여주기 위한 정규화 계층. route(/api/reference-search)가 네이버 API를
 * 호출하고, 이 모듈이 응답을 UI가 쓰기 좋은 형태로 변환한다.
 *
 * 네이버 응답 예:
 *   { items: [{ title: "농심 <b>새우깡</b> 90g", image, lprice: "1200",
 *               mallName, link, brand, maker, category1 }] }
 */

/** UI가 쓰는 정규화된 참고 상품 */
export interface ReferenceProduct {
  title: string // HTML 태그 제거된 상품명
  imageUrl: string
  lowestPrice: number | null // lprice(원). 파싱 불가 시 null
  mallName: string
  link: string
  brand?: string
}

/** 네이버 title은 검색어 강조용 <b>…</b> 태그를 포함 → 제거하고 엔티티 복원 */
export function stripHtmlTags(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

interface RawNaverItem {
  title?: string
  image?: string
  lprice?: string | number
  mallName?: string
  link?: string
  brand?: string
}

/**
 * 네이버 쇼핑 API 응답(raw)을 ReferenceProduct[]로 정규화한다.
 * - title: HTML 태그 제거
 * - lprice: 숫자 파싱(빈문자/비숫자 → null)
 * - 필수 필드(title 또는 image) 없는 항목은 제외
 */
export function normalizeNaverItems(raw: unknown): ReferenceProduct[] {
  const items =
    raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: RawNaverItem[] }).items ?? [])
      : []

  return items
    .map((it): ReferenceProduct | null => {
      const title = stripHtmlTags(it.title)
      const imageUrl = typeof it.image === 'string' ? it.image : ''
      if (!title && !imageUrl) return null
      const priceRaw = typeof it.lprice === 'number' ? String(it.lprice) : (it.lprice ?? '')
      const priceNum = parseInt(String(priceRaw).replace(/[^\d]/g, ''), 10)
      return {
        title,
        imageUrl,
        lowestPrice: Number.isFinite(priceNum) && priceNum > 0 ? priceNum : null,
        mallName: typeof it.mallName === 'string' ? it.mallName : '',
        link: typeof it.link === 'string' ? it.link : '',
        brand: it.brand || undefined,
      }
    })
    .filter((x): x is ReferenceProduct => x !== null)
}

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

/*
  ⚠️ **(2026-08-15) 네이버가 쇼핑 검색 API를 더 이상 서비스하지 않는다.**

  같은 키·같은 헤더로 검색 하위 API 11개를 찔러 본 결과:

  ```
  blog news encyc cafearticle kin webkr image local  → HTTP 200
  shop book doc                                      → HTTP 404  SE05
  ```

  틀린 키로 부르면 401(코드 024)이 뜨고, 우리 키로 부르면 **인증을 통과한 뒤**
  404가 난다. 즉 권한 문제가 아니라 그 API가 없다. `.xml` 변형도 같다.
  (네이버 공식 문서에는 아직 "제공 중"으로 적혀 있어 종료 공지는 못 찾았다.)

  그래서 정규화 계층은 남겨 두되 — 언젠가 대체 API를 붙일 때 재사용한다 —
  아래 두 함수로 **검수자가 손으로 하던 네이버 검색**으로 되돌려 준다.
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

/* ────────────────────────────────────────────────────────── */
/* API가 죽은 뒤의 대비책 — 수동 검색 + 사람이 읽는 오류 문장      */
/* ────────────────────────────────────────────────────────── */

/**
 * 네이버 검색(쇼핑) 페이지 주소 — 검수자가 새 탭에서 직접 확인한다.
 *
 * 원래 이 카드가 자동화하려던 작업이 "품명을 네이버에서 검색 → 이미지 확인 →
 * 시중가 점검"이었다. API가 죽었으니 그 수동 작업으로 되돌려 주는 게 최선이다.
 *
 * ★ **`search.shopping.naver.com`을 쓰지 않는다.** 그게 더 정확한 주소로
 * 보이지만 네이버가 외부 유입을 차단한다 — 2026-08-15에 그걸 넣어 배포했다가
 * 검수자 화면에 차단 페이지가 떴다. 실측:
 *
 * ```
 * search.shopping.naver.com/search/all?query=…       418 · "접속이 일시적으로 제한"
 * search.shopping.naver.com/…&frm=NVSCTAB            CAPTCHA "보안 확인을 완료해"
 * search.naver.com/search.naver?where=shop&query=…   200 · 네이버 가격비교 정상
 * ```
 *
 * 차단 페이지가 사유로 "상품 구매, 탐색과 무관한 **외부 이벤트를 통한 접속**"을
 * 든다. 우리 링크가 정확히 그것이다. 네이버 통합검색(`search.naver.com`)은
 * 막지 않고, 그 안에 **네이버 가격비교** 섹션이 있어 시중가 확인이 된다.
 *
 * ⚠️ **`encodeURIComponent`를 쓴다.** 거래명세표 품명에는 `[K]취나물,국산`처럼
 * 대괄호·쉼표가 들어 있어 그대로 붙이면 주소가 깨진다.
 *
 * 빈 검색어는 빈 문자열을 돌려준다 — 화면이 버튼을 감추는 신호로 쓴다.
 */
export function naverShoppingSearchUrl(query: string | null | undefined): string {
  const q = (query ?? '').trim()
  if (!q) return ''
  return `https://search.naver.com/search.naver?where=shop&query=${encodeURIComponent(q)}`
}

/** 검수자에게 보여 줄 오류 설명 */
export interface NaverErrorInfo {
  /** 사람이 읽는 한 문장. **원본 응답 본문을 절대 섞지 않는다.** */
  message: string
  /** true면 재시도해도 같은 결과 — 화면이 "다시 검색" 버튼을 감춘다 */
  permanent: boolean
  /** 네이버 errorCode(SE05·024 등). 로그·문서용이며 화면에 띄우지 않는다 */
  code?: string
}

/**
 * 네이버 오류 응답 → 사람이 읽는 문장.
 *
 * ★ **원본 JSON을 화면에 흘리지 않는 것이 이 함수의 존재 이유다.** 이전에는
 * 응답 본문 120자를 그대로 보여 줘서, 유치원 급식을 검수하는 분이
 * `{ "errorMessage": "Invalid search api …", "errorCode": "SE05" }`를 봤다.
 * 그걸 보고 할 수 있는 일이 없다.
 *
 * `permanent`는 재시도가 의미 있는지 가른다. 404/SE05·401은 몇 번 눌러도
 * 같은 결과이므로 버튼을 감추고 수동 검색으로 안내한다.
 */
export function describeNaverError(status: number, body: string): NaverErrorInfo {
  // 본문이 JSON이 아닐 수도 있다(.xml 변형·게이트웨이 HTML) — 실패해도 죽지 않는다
  let code: string | undefined
  try {
    const parsed = JSON.parse(body) as { errorCode?: unknown }
    if (typeof parsed.errorCode === 'string') code = parsed.errorCode
  } catch {
    const m = /"errorCode"\s*:\s*"([^"]+)"|<errorCode>\s*(?:<!\[CDATA\[)?([^<\]]+)/.exec(body)
    code = m?.[1] ?? m?.[2]?.trim()
  }

  // SE05 = 존재하지 않는 검색 api. 네이버가 쇼핑 검색을 내려놨다.
  if (code === 'SE05' || status === 404) {
    return {
      code,
      permanent: true,
      message:
        '네이버가 쇼핑 검색 서비스를 중단해 자동 조회를 할 수 없습니다. ' +
        '「네이버에서 검색」 버튼으로 직접 확인해 주세요.',
    }
  }

  if (status === 401 || status === 403) {
    return {
      code,
      permanent: true,
      message: '네이버 API 키가 거부됐습니다. 키를 다시 등록해야 합니다 (관리자 확인 필요).',
    }
  }

  if (status === 429) {
    return {
      code,
      permanent: false,
      message: '네이버 API 호출 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
    }
  }

  if (status >= 500) {
    return {
      code,
      permanent: false,
      message: '네이버 검색이 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.',
    }
  }

  return {
    code,
    permanent: false,
    message: '시중 참고 검색에 실패했습니다. 「네이버에서 검색」 버튼으로 직접 확인해 주세요.',
  }
}

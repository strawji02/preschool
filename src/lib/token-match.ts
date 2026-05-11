import { expandWithSynonyms } from '@/lib/synonyms'

/**
 * 공급사/브랜드 토큰 — 매칭 변별력 없음 (모든 제품에 등장).
 * "이츠웰 하이스데이" → 의미있는 토큰 = ["하이스데이"] (이츠웰 제거).
 * SHINSEGAE 자체 브랜드 + 주요 식자재 공급사 브랜드.
 */
export const SUPPLIER_BRANDS: Set<string> = new Set([
  // SHINSEGAE 자체 브랜드 (다수 제품에 등장 → 변별력 0)
  '이츠웰', '굿픽', '미아토', '산지기획', '아이누리', '키즈웰',
  '쉐프초이스', '굿초이스', '스위트웰', '데이웰',
  // CJ
  'cj', 'CJ', '씨제이', '비비고', 'cj이츠웰',
  // 주요 식자재 공급사
  '대상', '청정원', '오뚜기', '풀무원', '동원', '사조', '종가집',
  '롯데', '해태', '농심', '삼립', '샘표', '한성', '한성기업',
  '효성', '효성어묵', '삼승', '에쓰푸드', '면사랑', '하림', '체리부로',
  '진주햄', '송학식품', '평화식품', '동성식품', '사조오양', '진주햄',
  '예소담', '뚜레반', '담터', '맛뜨락', '칠갑농산', '마차촌', '굿초이스',
])

/**
 * 일반 수식어/등급/형태 토큰 — 매칭 변별력 낮음 (모든 카테고리에 등장).
 * "삼승 프리미엄 닭다리살(1등급) 덩어리" → 의미있는 토큰 = ["닭다리살"]
 * 식자재 메인 명사만 매칭에 사용해 정확도 향상.
 */
export const GENERIC_MODIFIERS: Set<string> = new Set([
  // 수식어
  '프리미엄', '신선한', '친환경', '무항생제', '유기농', '무첨가', '저염',
  '저당', '오리지널', '리얼', '담백한', '진한', '깊은', '특제',
  // 등급/품질 (괄호 안 표기에 자주 등장)
  '1등급', '2등급', '특등급', '상등급', 'a등급',
  '상품', '특품', '대품', '소품', '중품', '하품',
  // 형태/가공
  '덩어리', '절단', '슬라이스', '다짐', '커팅', '필렛', '깍둑', '채썬',
  '갈은', '간', '으깬', '크러쉬',
])

/**
 * 검수 품목 query 정제 (2026-05-10) — 매칭 query에서 메타 노이즈 제거
 *
 * OCR 결과 extracted_name이 spec/원산지를 포함하는 경우 BM25/임베딩 매칭이 깨짐.
 * 예: "세척당근(특품 200~280g/개 한국Wn※국내산)"
 *   - "한국Wn※국내산"의 "한국"이 한우(韓牛)와 매칭되어 한우류가 1순위로
 *   - "200~280g/개" 같은 spec이 토큰 분산
 *
 * 정제 후: "세척당근" → 정확한 매칭
 *
 * 제거 패턴:
 *  1. 괄호 안 내용 (보통 spec/원산지 메타)
 *  2. "Wn※국내산", "※국내산" 같은 OCR 특수 패턴
 *  3. 무게/부피 + 단위 패턴 (200g, 1kg, 280g/개)
 *  4. 다중 공백 정리
 */
export function cleanProductQuery(q: string): string {
  if (!q) return ''
  let s = q
  // (2026-05-11) 중첩 괄호 처리 — "(약6g*(166±5)입 1Kg/EA)"같은 다중 괄호 케이스
  // 안쪽부터 반복 제거 (최대 5회 반복으로 무한 루프 방지)
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/\([^()]*\)/g, ' ')
    if (next === s) break
    s = next
  }
  s = s.replace(/[()]/g, ' ')                                   // 짝 안 맞는 단독 괄호 제거
  s = s.replace(/Wn\s*※[^\s,)]*/gi, ' ')                        // OCR Wn※국내산
  s = s.replace(/[※]/g, ' ')                                    // ※ 단독
  s = s.replace(/\d+\s*~?\s*\d*\s*[gG][lL]?\s*\/?\s*[A-Za-z가-힣]*/g, ' ')  // 200g, 200~280g/개
  s = s.replace(/\d+\.?\d*\s*[Kk][Gg]\s*\/?\s*[A-Za-z가-힣]*/g, ' ')        // 1KG, 1.5KG/EA
  s = s.replace(/\d+\.?\d*\s*[Mm][Ll]\s*\/?\s*[A-Za-z가-힣]*/g, ' ')        // 500ml
  s = s.replace(/\d+\.?\d*\s*[Ll]\s*\/?\s*[A-Za-z가-힣]*/g, ' ')            // 2L/EA
  s = s.replace(/\s+/g, ' ').trim()
  return s || q  // 정제 후 빈 문자열이면 원본 (안전장치)
}

/**
 * spec/이름에서 매칭 식별자 키워드 추출 (2026-05-10)
 *
 * 검수 품목의 product name이 짧고 spec에 등급/인증/크기 정보가 있는 케이스 (OCR 변형)
 * 자동 매칭 시 spec을 활용해 식별자 키워드만 추가 → 매칭 정확도 향상
 *
 * 예: "이츠웰 신선한계란" + spec "1등급, 무항생제, 특란, 60g*30입"
 *     → identifiers: "1등급 무항생제 특란"
 *     → enriched: "이츠웰 신선한계란 1등급 무항생제 특란"
 *     → 신세계 "1등급 무항생제 계란 특란" 정확 매칭
 *
 * 추출 패턴:
 *  - 등급: 1등급, 2등급, 특등급, 상등급, A등급
 *  - 인증: 무항생제, 무첨가, 친환경, 유기농, 동물복지, 무농약, HACCP
 *  - 크기: 특란, 대란, 중란, 소란, 왕란
 *  - 원산지: 국내산, 한국산, 국산, 국내제조
 */
export function extractIdentifiers(text: string | undefined | null): string {
  if (!text) return ''
  const tokens: string[] = []
  const patterns = [
    /\d+\s*등급|특등급|상등급|[Aa]등급/g,
    /무항생제|친환경|유기농|동물복지|무농약|무첨가|HACCP|haccp/g,
    /특란|대란|중란|소란|왕란/g,
    /국내산|한국산|국산|국내제조/g,
  ]
  for (const p of patterns) {
    const matches = text.match(p)
    if (matches) tokens.push(...matches.map((m) => m.replace(/\s+/g, '')))
  }
  return [...new Set(tokens)].join(' ')
}

/**
 * 가공/즉석섭취/스낵 등 메인 식자재가 아닌 가공품 키워드.
 * 검수 품목이 단순 식자재("방울토마토")인데 후보가 가공품("한컵과일 사과+방울토마토")이면
 * 동일 토큰 매칭이라도 가공품을 후순위로 (영양 분석/가격 비교 의미 다름).
 */
export function isProcessedProduct(productName: string): boolean {
  if (!productName) return false
  const PROCESSED_KEYWORDS = [
    // 즉석섭취/즉석조리
    '한컵', '한입', '한입톡톡', '컵과일', '한컵과일', '식재 컵', '식재컵',
    '샌드위치', '도시락', '김밥', '주먹밥', '삼각김밥',
    '즉석', '인스턴트', '레토르트', '바로먹는', '바로 먹는',
    '하루한컵', '오든든', '스낵', '간식세트', '디저트',
    '쿠키', '와플', '머핀', '케이크',
    '한컵음료', '큐브과일',
    '컵(', '컵 (',
    // 계란/축산 가공품 (반숙란/훈제란/장조림/후라이/마끼/말이/패티)
    '반숙란', '훈제란', '장조림', '계란후라이', '계란마끼', '계란옷', '계란말이',
    '에그랑땡', '적전', '패티',
    // 즉석조리 — 라자냐, 곤약밥, 한우물 등
    '라자냐', '곤약', '한우물',
    // 키친/조리도구 (식자재가 아닌 도구)
    '계란판', '계란커팅', '후라이팬', '오븐 코팅', '커팅기', '말이팬',
    // 적전/전류
    '적전패티', '전류',
  ]
  return PROCESSED_KEYWORDS.some((k) => productName.includes(k))
}

/**
 * 토큰 기반 매칭 신뢰도 계산 (2026-05-04)
 *
 * 한국어 검색어와 후보 제품명의 의미적 유사도 측정.
 * hybrid_search 점수가 변별력 부족 (0.005~0.05 범위)할 때 보조 신호로 사용.
 *
 * 사용처:
 *  - 백엔드: matching.ts (저장 시 검증), sessions/[id] (복원 시 검증), rematch (재매칭 대상 선별)
 *  - 프론트: PrecisionMatchingView (UI 신뢰도 표시 + 정렬)
 */

/** 한국어 어절 단순 분리 (2자 이상 토큰만) */
export function tokenize(text: string | undefined | null): string[] {
  if (!text) return []
  return text
    .toLowerCase()
    .split(/[\s,./()※*+|·#\-\[\]]+/)
    .filter((t) => t.length >= 2)
}

/**
 * 토큰 매칭 비율 (0~1.5)
 *  - 1.5: query가 product에 substring으로 완전 포함 (확실)
 *  - 0.7+: 토큰 70%+ 일치 (강함)
 *  - 0.4+: 토큰 40~70% 일치 (보통)
 *  - 0.0+: 1개 토큰 일치 또는 prefix 부분 매칭 (약함)
 *  - 0.0:  토큰 매칭 없음 (참고)
 */
export function getTokenMatchRatio(
  query: string | undefined | null,
  productName: string | undefined | null,
): number {
  const q = (query ?? '').toLowerCase().replace(/\s+/g, '')
  const n = (productName ?? '').toLowerCase().replace(/\s+/g, '')

  // Full substring match → 확실
  if (q.length >= 2 && (n.includes(q) || q.includes(n))) return 1.5

  // 토큰 분리 + 공급사 브랜드/일반 수식어 제거 (식자재 메인 명사만 매칭에 사용)
  // "삼승 프리미엄 닭다리살(1등급) 덩어리" → ["닭다리살"]
  const allQueryTokens = tokenize(query)
  const meaningfulTokens = allQueryTokens.filter(
    (t) => !SUPPLIER_BRANDS.has(t) && !GENERIC_MODIFIERS.has(t),
  )
  // 모든 토큰이 brand/modifier면 fallback으로 brand만 제외 (modifier만 있는 케이스 고려)
  const queryTokens =
    meaningfulTokens.length > 0
      ? meaningfulTokens
      : allQueryTokens.filter((t) => !SUPPLIER_BRANDS.has(t))
  // 모든 토큰이 brand면 fallback으로 원본 사용 (검색어 자체가 brand-only인 케이스)
  const effectiveTokens = queryTokens.length > 0 ? queryTokens : allQueryTokens

  // 부정 prefix — 동의어/토큰 substring 매칭 시 의미 반전 방지
  // 예: "익은것"이 "덜익은것" 안에 substring으로 포함되어도 의미 반대 → 매칭 안 함
  const NEGATIVE_PREFIXES = ['덜', '안', '못', '비', '무', '미']
  const isNegatedSubstring = (text: string, sub: string): boolean => {
    const idx = text.indexOf(sub)
    if (idx <= 0) return false
    const prev = text[idx - 1]
    return NEGATIVE_PREFIXES.includes(prev)
  }
  // 토큰이 product 안에 substring 매칭되지만 부정 prefix가 앞에 있으면 false
  const includesPositive = (text: string, sub: string): boolean => {
    if (!text.includes(sub)) return false
    return !isNegatedSubstring(text, sub)
  }

  let matched = 0
  for (const t of effectiveTokens) {
    if (includesPositive(n, t)) {
      matched += 1
      continue
    }
    // 동의어 확장 매칭 (예: 소앞다리 → 부채살, 적숙 → 중숙/익은것)
    let synMatched = false
    const syns = expandWithSynonyms(t)
    for (const s of syns) {
      const sLower = s.toLowerCase()
      if (sLower.length >= 2 && sLower !== t && includesPositive(n, sLower)) {
        synMatched = true
        break
      }
    }
    if (synMatched) {
      matched += 1
      continue
    }
    // 4자 이상 토큰: 한국어 합성어 prefix/suffix 부분 매칭
    // 점수 = 매칭된 길이 / 전체 토큰 길이 (긴 부분 매칭이 더 강한 신호)
    // 예: "얼갈이배추" (5자) vs "얼갈이 국내산" → prefix 3자 매칭 → 3/5=0.6
    //     "얼갈이배추" (5자) vs "양배추채칼" → suffix 2자 매칭 → 2/5=0.4
    //     → "얼갈이"가 specifier로 더 의미있는 매칭이 위로 (이전: suffix 우선이라 양배추채칼이 위)
    if (t.length >= 4) {
      let suffixLen = 0
      let prefixLen = 0
      // 가장 긴 suffix 매칭 — modifier만 매칭되는 substring은 무시
      // (예: "신선한계란"의 suffix "한계란"이 "촉촉한계란"에 매칭 → 사실상 "한계란"이라는 의미 단위 X)
      for (let len = Math.min(t.length - 1, 4); len >= 2; len--) {
        const sub = t.slice(t.length - len)
        if (sub.length < 2) continue
        if (GENERIC_MODIFIERS.has(sub) || SUPPLIER_BRANDS.has(sub)) continue
        if (includesPositive(n, sub)) {
          suffixLen = len
          break
        }
      }
      // 가장 긴 prefix 매칭 — modifier prefix(신선한/친환경/무항생제 등)는 매칭 시 specifier 효과 없음
      // (예: "신선한계란"의 prefix "신선한"이 "신선한 김밥/신선해달콤" 등에 매칭 → 잘못된 가공품 매칭)
      for (let len = Math.min(t.length, 4); len >= 2; len--) {
        const sub = t.slice(0, len)
        if (sub.length < 2) continue
        if (GENERIC_MODIFIERS.has(sub) || SUPPLIER_BRANDS.has(sub)) continue
        if (includesPositive(n, sub)) {
          prefixLen = len
          break
        }
      }
      // 둘 중 긴 매칭을 점수로 (둘 다 매칭이면 자연스럽게 max)
      const bestLen = Math.max(suffixLen, prefixLen)
      if (bestLen > 0) {
        matched += bestLen / t.length
      }
    }
  }
  return effectiveTokens.length > 0 ? matched / effectiveTokens.length : 0
}

/**
 * 신뢰도 라벨 + 색상 (UI용)
 */
export interface MatchConfidence {
  label: string
  bgColor: string
  textColor: string
  matchRatio: number
  fullContains: boolean
}

export function getMatchConfidence(
  query: string | undefined | null,
  productName: string | undefined | null,
): MatchConfidence {
  const ratio = getTokenMatchRatio(query, productName)
  const fullContains = ratio >= 1.5

  if (fullContains) {
    return { label: '확실', bgColor: 'bg-emerald-200', textColor: 'text-emerald-900', matchRatio: ratio, fullContains: true }
  }
  if (ratio >= 0.7) return { label: '강함', bgColor: 'bg-green-100', textColor: 'text-green-700', matchRatio: ratio, fullContains: false }
  if (ratio >= 0.4) return { label: '보통', bgColor: 'bg-blue-100', textColor: 'text-blue-700', matchRatio: ratio, fullContains: false }
  if (ratio > 0)    return { label: '약함', bgColor: 'bg-amber-100', textColor: 'text-amber-700', matchRatio: ratio, fullContains: false }
  return { label: '참고', bgColor: 'bg-gray-100', textColor: 'text-gray-500', matchRatio: 0, fullContains: false }
}

/**
 * 매칭 저장/유효성 임계값.
 * 토큰 매칭 비율이 이 값 미만이면 의미있는 매칭으로 취급하지 않음 (matched_product_id = NULL).
 */
export const MIN_VALID_MATCH_RATIO = 0.3

/**
 * 텍스트 내 공통 토큰 추출 (highlight용)
 */
export function getCommonTokens(...texts: (string | undefined | null)[]): Set<string> {
  const allSets = texts.filter(Boolean).map((t) => new Set(tokenize(t)))
  if (allSets.length < 2) return new Set()
  const [first, ...rest] = allSets
  const common = new Set<string>()
  for (const tok of first) {
    if (rest.every((s) => s.has(tok))) common.add(tok)
  }
  return common
}


/* ────────────────────────────────────────────────────────── */
/* 원산지 정규화 + 매칭 (백엔드/프론트 공통)                      */
/* ────────────────────────────────────────────────────────── */

/**
 * 원산지 정규화 — origin 컬럼 값 또는 텍스트 (extracted_name/extracted_spec/product_name)에서 ISO 풍 코드 추출.
 * "국내산" / "국내제조" / "한국" → KR
 * "중국" → CN
 * 등 16종 + UNKNOWN
 */
export function normalizeOrigin(text: string | undefined | null): string {
  if (!text) return 'UNKNOWN'
  const t = text.toLowerCase()
  // (2026-05-11) "외국산" 체크를 한국 패턴보다 먼저 — "외국"의 "국"이 "한국" substring과 충돌하지 않도록
  // 또한 구체적 국가는 일반 "수입/외국산"보다 우선 (캐나다 vs 외국산 동시 표기 시 캐나다 우선)
  if (/중국/.test(t)) return 'CN'
  if (/미국|usa/.test(t)) return 'US'
  if (/호주|aus|오스트레일리아/.test(t)) return 'AU'
  if (/일본|일산/.test(t)) return 'JP'
  if (/러시아|러산/.test(t)) return 'RU'
  if (/eu|유럽|네덜란드|독일|프랑스|스페인|이태리|이탈리아|벨기에|덴마크|폴란드/.test(t)) return 'EU'
  if (/베트남/.test(t)) return 'VN'
  if (/태국/.test(t)) return 'TH'
  if (/캐나다/.test(t)) return 'CA'
  if (/말레이시아/.test(t)) return 'MY'
  if (/페루/.test(t)) return 'PE'
  if (/칠레/.test(t)) return 'CL'
  if (/뉴질랜드/.test(t)) return 'NZ'
  if (/멕시코/.test(t)) return 'MX'
  if (/외국산|수입산|수입/.test(t)) return 'IMPORT'
  // 한국 체크는 마지막 (외국산/구체국가 패턴이 먼저 매칭)
  if (/국내산|한국산|국산|국내제조|한국/.test(t)) return 'KR'
  return 'UNKNOWN'
}


/**
 * 거래명세표 OCR에서 origin 필드가 누락된 경우 spec/name/extra 텍스트에서 origin 키워드 추출
 * (2026-05-11) Layer 2 fallback heuristic
 *
 * @param texts 검사할 텍스트들 (예: [name, spec])
 * @returns 발견된 origin raw 텍스트 또는 null
 */
export function recoverOrigin(...texts: (string | undefined | null)[]): string | null {
  const combined = texts.filter(Boolean).join(' ').toLowerCase()
  if (!combined) return null
  // 우선순위 1: 한국Wn※... 특수 패턴
  const wnMatch = combined.match(/한국wn\s*※[^\s,)]+/i)
  if (wnMatch) return wnMatch[0]
  // 우선순위 2: 구체 국가 (가장 구체적인 표기)
  const countryPatterns = [
    /중국산?/, /호주산?|오스트레일리아/, /미국산?|usa/, /캐나다산?/, /베트남산?/,
    /태국산?/, /뉴질랜드산?/, /칠레산?/, /페루산?/, /일본산?|일산/,
    /러시아산?|러산/, /스페인산?/, /이태리산?|이탈리아산?/, /프랑스산?/,
    /독일산?/, /네덜란드산?/, /덴마크산?/, /폴란드산?/, /벨기에산?/,
    /말레이시아산?/, /멕시코산?/,
  ]
  for (const p of countryPatterns) {
    const m = combined.match(p)
    if (m) return m[0]
  }
  // 우선순위 3: 일반 외국산/수입
  const importMatch = combined.match(/외국산|수입산|수입/)
  if (importMatch) return importMatch[0]
  // 우선순위 4: 국내산/한국산 — 한국 substring 충돌 방지를 위해 가장 마지막
  const krMatch = combined.match(/국내산|한국산|국내제조|국산/)
  if (krMatch) return krMatch[0]
  return null
}

/**
 * 원산지 매칭 점수 (정렬 가중치용)
 *  - 1.0: 완전 일치 (KR == KR)
 *  - 0.5: 한쪽이 미상 (정보 부족, 중립)
 *  - 0.0: 불일치 (KR vs CN)
 */
export function originMatchScore(itemOrigin: string | undefined | null, candOrigin: string | undefined | null): number {
  const a = normalizeOrigin(itemOrigin)
  const b = normalizeOrigin(candOrigin)
  if (a === 'UNKNOWN' || b === 'UNKNOWN') return 0.5
  return a === b ? 1.0 : 0.0
}

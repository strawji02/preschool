import { expandWithSynonyms, getStandardTerm } from '@/lib/synonyms'

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
  // 추가 브랜드 (2026-05-12)
  '크레잇', '롯데제과', '그린베이크', '백두농산식품', '에쓰푸드',
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
  // 포장 (2026-05-12) — '스팸캔','참치캔' 같은 식자재명+포장 합성어 분리 시 modifier로 처리
  '캔', '병', '팩', '통', '봉', '박스', '상자',
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
  // (2026-05-11) origin 키워드 제거 — extracted_origin 별도 추출로 origin 정보는 보존됨
  // 매칭 ratio 계산에서 "국내산_100%" 같은 노이즈 토큰이 BM25를 망가뜨리는 문제 차단
  s = s.replace(/국내산|한국산|국산|국내제조|수입산|외국산|중국산|호주산|미국산|캐나다산|베트남산|태국산|뉴질랜드산|일본산|러시아산/g, ' ')
  // (2026-05-12) storage temp prefix 분리 — "냉장한우사태" → "냉장 한우사태"
  // 검수 OCR/Excel이 보관온도+품목명을 붙여 쓴 경우 단일 토큰이 되어
  // BM25 검색에서 product의 분리 토큰('한우사태','냉장')과 매칭 안 되는 문제 해결
  // 또한 합성 토큰의 species prefix 추출 실패 회귀 — '냉장한우사태' startsWith '냉장' → species null
  s = s.replace(/(냉장|냉동|실온|상온|상태)([가-힣])/g, '$1 $2')
  // (2026-05-12) '생' prefix 분리 — "생오이피클슬라이스" → "생 오이피클슬라이스"
  // 3자 이상 식자재명 앞에만 — '생강'(2자)/'생수'(2자)/'생강즙' 같은 단어 보호
  s = s.replace(/(^|\s)생([가-힣]{3,})/g, '$1생 $2')
  // (2026-05-12) 가공 suffix 분리 — "오이피클슬라이스" → "오이피클 슬라이스"
  // 합성어 안의 가공 modifier(슬라이스/커팅 등)가 GENERIC_MODIFIERS에 있어도
  // 합성 토큰으로 묶이면 분리 안 되어 의미있는 식자재명만 추출 안 됨
  s = s.replace(/([가-힣]{2,})(슬라이스|커팅|컷팅|필렛|다이스|덩어리|깍둑|채썬)([가-힣]*)/g, '$1 $2 $3')
  // (2026-05-12) 포장 suffix 분리 — "스팸캔" → "스팸 캔", "참치캔" → "참치 캔"
  // 검수가 포장 형태를 식자재명 뒤에 붙여 쓰는 경우 (캔/병/팩/통)
  s = s.replace(/([가-힣]{2,})(캔|병|팩|통|봉|박스|상자)(\s|$|[,])/g, '$1 $2$3')
  // (2026-05-12) 콤마/세미콜론/슬래시 분리 — "스팸캔,DC" → "스팸캔 DC"
  s = s.replace(/[,;|]+/g, ' ')
  // (2026-05-12) 검수 메타 marker 제거 — DC(Discount Center/도매), VB(Vacuum Bag/진공포장)
  // 식자재명과 무관한 검수 표기. product의 'DC 컵라면' 같은 product line name에는 영향 없음 (cleanProductQuery는 검수 query만 처리)
  s = s.replace(/(^|\s)(DC|dc|VB|vb|D\.C\.|V\.B\.)(\s|$)/g, '$1 $3')
  s = s.replace(/\d+\s*%/g, ' ')                                // 100%, 50% 같은 비율 표기 제거
  s = s.replace(/[_]+/g, ' ')                                   // _ 구분자 (예: 국내산_100%)
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
    // 곡물 가공품 (2026-05-11) — 쌀/곡물 검수 시 가공품 차단
    '김부각', '부각', '국수', '쌀국수', '국수장국', '떡국떡', '떡볶이', '떡국',
    // 쌀/곡물 가공품 확장 (2026-05-11) — '쌀 20kg' 양곡 vs '쌀가루' 가공품 구분
    '쌀가루', '멥쌀가루', '찹쌀가루', '박력쌀가루', '쌀튀김', '쌀과자', '쌀튀밥', '쌀강정',
    '쌀국수장국', '쌀쫄면', '쌀죽', '쌀초고추장', '쌀올리고당', '튀김가루', '부침가루',
    // 분말/파우더 가공품 (2026-05-11) — 양파파우더/마늘파우더 등 신선 식자재 vs 분말 구분
    '파우더', '분말',
    '핫바', '핫도그', '햄버거', '소시지', '베이컨', '미트볼',
    '돈까스', '돈가스', '치킨까스', '치킨가스', '커틀렛', '돈카츠',
    '너겟', '너겟', '치킨너겟', '튀김',
    '만두', '왕만두', '물만두', '군만두', '딤섬',
    '핫바', '어묵', '맛살', '게맛살',
    '시리얼', '후레이크', '플레이크', '뮤즐리',
    '소스', '드레싱', '마요네즈', '케찹', '머스타드',
    '잼', '스프', '크림스프', '카레', '짜장',
    '아이스크림', '셔벗', '빙수',
    '올리고당', '시럽', '꿀',
    '주스', '음료', '에이드', '스무디', '라떼',
    '빵', '베이글', '도넛', '크로아상', '브리오슈', '바게트', '식빵',
    '파스타', '스파게티', '피자',
    '치즈', '버터', '요거트', '요구르트',
    '핸드롤', '롤케이크', '롤',
    '강정', '약과', '한과', '엿', '캔디',
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
    // (2026-05-11) 1자 한국어 음절 토큰 허용 — 쌀/무/콩/팥/파 같은 핵심 식자재명 보존
    // 영문/숫자 1자는 변별력 없으므로 제외 유지
    .filter((t) => t.length >= 2 || /^[가-힣]$/.test(t))
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
  // (2026-05-11) 1~2자 query는 word-boundary 매칭만 허용 — substring이 너무 광범위
  // 3자 이상은 한국어 합성어 식별력 충분 → 일반 substring 허용
  if (q.length >= 3 && (n.includes(q) || q.includes(n))) return 1.5
  if (q.length === 2 && n.includes(q)) {
    const productTokens = tokenize(productName ?? '')
    // 정확 토큰 또는 token-prefix만 인정 (token-suffix "옥수수→수수" 잘못 매칭 차단)
    const exactOrPrefix = productTokens.some(
      (t) => t === q || (t.length > q.length && t.startsWith(q)),
    )
    if (exactOrPrefix) return 1.5
  }
  // 1자 한국어 query (쌀/무/콩/팥/파 등) — token-exact + token-prefix + token-suffix 모두 허용
  // 한국어 식자재 합성어 패턴이 광범위 (찹쌀/쌀가루/대파/총각무) → suffix도 안전
  if (q.length === 1 && /^[가-힣]$/.test(q) && n.includes(q)) {
    const productTokens = tokenize(productName ?? '')
    const wordBoundary = productTokens.some(
      (t) => t === q || (t.length > 1 && (t.startsWith(q) || t.endsWith(q))),
    )
    if (wordBoundary) return 1.5
  }

  // (2026-05-11) Synonym substring boost — 동의어가 product에 substring 정확 매칭되면 1.5
  // 예: query="양파" → expand에 "깐양파" → product "깐양파 국내산"에 "깐양파" substring → 1.5
  // 효과: 가공품(양파파우더 ratio 1.5 - 0.3 = 1.2) vs 깐양파(이전 ratio 1.0) → 깐양파 1.5로 부스트
  if (q.length >= 1 && /^[가-힣]/.test(q)) {
    const syns = expandWithSynonyms(query ?? '')
    for (const syn of syns) {
      const synLower = syn.toLowerCase().replace(/\s+/g, '')
      if (synLower.length >= 2 && synLower !== q && n.includes(synLower)) {
        // 3자 이상은 substring으로 충분히 식별력 있음
        if (synLower.length >= 3) return 1.5
        // 2자 동의어는 word-boundary 매칭만 허용
        const productTokens = tokenize(productName ?? '')
        const exactOrPrefix = productTokens.some(
          (t) => t === synLower || (t.length > synLower.length && t.startsWith(synLower)),
        )
        if (exactOrPrefix) return 1.5
      }
    }
  }

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
  // (2026-05-11) 1~2자 토큰은 word-boundary 매칭만 — substring 매칭이 "수수→옥수수" 잘못 매칭 유발
  // 3자 이상은 한국어 합성어 식별력 충분 → 일반 substring 허용
  const productTokensCached = tokenize(productName ?? '')
  const tokenMatchesProduct = (sub: string): boolean => {
    if (!sub) return false
    if (sub.length >= 3) return includesPositive(n, sub)
    if (!includesPositive(n, sub)) return false
    // 1자 한국어 토큰: token-exact + token-prefix + token-suffix 모두 허용
    // (찹쌀/쌀가루/대파/총각무 같은 합성어 매칭 필수)
    if (sub.length === 1 && /^[가-힣]$/.test(sub)) {
      return productTokensCached.some(
        (pt) => pt === sub || (pt.length > 1 && (pt.startsWith(sub) || pt.endsWith(sub))),
      )
    }
    // 2자 토큰: token-exact 또는 token-prefix만 (token-suffix "옥수수→수수" 위험)
    return productTokensCached.some(
      (pt) => pt === sub || (pt.length > sub.length && pt.startsWith(sub)),
    )
  }

  let matched = 0
  for (const t of effectiveTokens) {
    if (tokenMatchesProduct(t)) {
      matched += 1
      continue
    }
    // 동의어 확장 매칭 (예: 소앞다리 → 부채살, 적숙 → 중숙/익은것)
    let synMatched = false
    const syns = expandWithSynonyms(t)
    for (const s of syns) {
      const sLower = s.toLowerCase()
      if (sLower.length >= 2 && sLower !== t && tokenMatchesProduct(sLower)) {
        synMatched = true
        break
      }
    }
    if (synMatched) {
      matched += 1
      continue
    }
    // (2026-05-12) 합성어 안의 식자재 키워드 동의어 매칭
    // 예: "햇살가득고춧가루" → suffix "고춧가루" → expand에 "고추분" → product에 "고추분" 매치
    //     "냉동참기름" → suffix "참기름" → 동일 식자재
    //     "미니크리스피핫도그" → suffix "핫도그" → product에 "핫도그" → full match
    //     "돈민찌" (3자) → suffix "민찌" → expand standard "다짐육" → product '다짐육' 매칭
    // 종 prefix 충돌 검사 (2026-05-12): 검수 t가 종특화(돈/돼지/우/한우/소/닭)일 때,
    // product의 자체 표준어 token이 다른 종이면 차단 — '돈민찌' vs '한우다짐육' 회귀 방지
    if (t.length >= 3) {
      const getSpecies = (s: string): string | null => {
        if (s.startsWith('한우')) return 'cow'
        if (s.startsWith('돼지')) return 'pig'
        if (s.startsWith('닭')) return 'chicken'
        if (s.startsWith('돈')) return 'pig'
        if (s.startsWith('우')) return 'cow'
        if (s.startsWith('소')) return 'cow'
        return null
      }
      const tSpecies = getSpecies(t)
      // product에 종특화 token이 있고, t와 종이 다르면 cross-종 매칭 차단
      // 예: t='돈민찌'(pig) vs product token '한우다짐육'/'우민찌'/'닭가슴살' → 차단
      const hasConflictingSpecies =
        tSpecies !== null &&
        productTokensCached.some((pt) => {
          if (pt.length < 2) return false
          const ptSpecies = getSpecies(pt)
          return ptSpecies !== null && ptSpecies !== tSpecies
        })

      let compoundSynMatched = false
      if (!hasConflictingSpecies) {
        // suffix 우선 (식자재 본질은 보통 끝에 위치)
        for (let len = Math.min(t.length - 1, 6); len >= 2; len--) {
          const sub = t.slice(t.length - len)
          if (sub.length < 2) continue
          if (GENERIC_MODIFIERS.has(sub) || SUPPLIER_BRANDS.has(sub)) continue
          const subSyns = expandWithSynonyms(sub)
          if (subSyns.length > 1) {
            // (2026-05-12) sub의 동의어가 product에 매칭되되 동일 standard term인 경우만 인정
            // 예: sub="고춧가루" → syn="고추분" → 둘 다 standard "고추가루" → 매칭 OK
            //     sub="전분" → syn="옥수수전분" → standard "전분" vs "옥수수전분" → 다름 → 차단
            const subStandard = getStandardTerm(sub)
            for (const syn of subSyns) {
              const synL = syn.toLowerCase()
              if (synL.length < 2) continue
              if (!tokenMatchesProduct(synL)) continue
              if (getStandardTerm(syn) === subStandard) {
                compoundSynMatched = true
                break
              }
            }
          }
          if (compoundSynMatched) break
        }
      }
      if (compoundSynMatched) {
        matched += 1
        continue
      }
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

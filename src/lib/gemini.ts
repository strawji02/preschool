import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GeminiOCRRequest, GeminiOCRResponse, ExtractedItem } from '@/types/audit'

/**
 * 한국 식자재 OCR 흔한 오인식 보정 사전 (2026-04-28)
 *
 * Gemini가 한국어 손글씨/저해상도 스캔에서 자주 혼동하는 문자 → 정확한 표기로 보정.
 * - 단순 substring replace이므로 부분 일치 케이스도 처리됨 ("판두부 1KG" → "판두부 1KG")
 * - 사용자 보고 패턴을 모아 점진적으로 추가
 */
const OCR_FIXES: Array<{ wrong: string; correct: string }> = [
  // 두부류 — "판두부"가 표준, "편두부"는 거의 사용되지 않음
  { wrong: '편두부', correct: '판두부' },
  // 한국 식자재 공급사명 (사용자 보고, 2026-04-29)
  { wrong: '이초웰', correct: '이츠웰' },     // 계란/다진마늘 공급사 — 47건
  { wrong: '증가집', correct: '종가집' },     // 김치 공급사 — 3건
  // 굿픽 (식자재 공급사) 변형 — 픽 글자가 다양한 글자로 오인식됨 — 총 19건
  { wrong: '굿떡', correct: '굿픽' },
  { wrong: '굿팩', correct: '굿픽' },
  { wrong: '굿핏', correct: '굿픽' },
  { wrong: '굿박', correct: '굿픽' },
  { wrong: '굿곡', correct: '굿픽' },
  { wrong: '긋픽', correct: '굿픽' },
  // 나물 — 숙주가 표준, 속주는 오독 (사용자 보고, 2026-05-02)
  { wrong: '속주', correct: '숙주' },
  // 마차촌 (어묵 공급사) — 차→자 오독
  { wrong: '마자촌', correct: '마차촌' },
  { wrong: '마자춘', correct: '마차촌' },
  // 정육 부위 — 앞→암 오독 (사용자 보고, 2026-05-02)
  { wrong: '돈암다리', correct: '돈앞다리' },
  { wrong: '소암다리', correct: '소앞다리' },  // 예방 (DB에는 미발견)
  // 향후 추가 패턴은 여기에 누적
]

function applyOcrFixes(text: string | undefined | null): string | undefined {
  if (!text) return text ?? undefined
  let fixed = text
  for (const { wrong, correct } of OCR_FIXES) {
    if (fixed.includes(wrong)) {
      fixed = fixed.split(wrong).join(correct)
    }
  }
  return fixed
}

const EXTRACTION_PROMPT = `당신은 식자재 거래명세서 OCR 전문가입니다.
이미지에서 품목 리스트와 거래명세표 하단의 합계 금액을 추출하여 JSON 형식으로 반환하세요.

=== 품목(items) 추출 대상 ===
- 품목명 (name): 상품 이름
- 규격 (spec): ★중요★ 용량/무게 + **원산지(국내산/수입산/원산지국가)** + 등급/포장/품질 정보를
  모두 포함하여 추출. 거래명세서 "규격"열에 함께 표기된 모든 부가 정보를 spec 한 필드에 합쳐서 반환.
  · 원산지 표기 예: "국내산", "호주산", "중국산", "한국Wn※국내산", "쇠고기(호주산)", "쌀(국내산)"
  · 등급/품질 표기 예: "친환경 G마크", "유기농", "1등급", "특상", "상품", "하품"
  · 거래명세서에 항상 "한국Wn※..." 같은 코드+원산지 표기가 함께 있는 형식이라면 모두 보존
  · 여러 정보가 있으면 콤마(,)로 구분하여 합침. 예: "1Kg/EA, 국내산, 친환경 G마크"
- 단위 (unit): EA, KG, BOX, PAC, 봉 등 별도 "단위" 컬럼 값 (없으면 null)
- 수량 (quantity): 숫자만
- 단가 (unit_price): 숫자만 (원 단위)
- 공급가액 (supply_amount): 세액 미포함 금액 (해당 컬럼이 있으면, 없으면 null)
- 세액 (tax_amount): 부가세/부가가치세 (해당 컬럼이 있으면, 없으면 null). 면세 품목은 0
- 합계 (total_price): ★ 반드시 부가세를 포함한 최종 금액 ★ (원 단위)

total_price 결정 규칙 (★매우 중요★):
1. "합계" 또는 "총액" 또는 "총계" 컬럼이 있으면 그 값을 그대로 total_price로 사용
   (이 컬럼들은 이미 부가세가 포함된 최종 금액임)
2. "합계"/"총액" 컬럼이 없지만 "공급가액"과 "부가세" 컬럼이 별도로 있으면
   total_price = 공급가액 + 부가세
3. "금액" 컬럼만 단일로 있으면 그 값을 total_price로 사용
4. 어떤 경우든 total_price는 "부가세를 모두 포함한 최종 거래 금액"이어야 한다

=== page_total (거래명세표 하단 합계) 추출 ===
거래명세표는 보통 품목 목록 아래에 "합계", "총 금액", "TOTAL" 등의 이름으로 **페이지 전체 합계 금액**이 인쇄되어 있습니다.
- 이 금액을 page_total 필드로 반환 (부가세 포함 최종 금액)
- 하단에 "공급가액 합계 + 세액 합계 = 총 합계" 형태로 3칸이 있으면 **총 합계(부가세 포함)**를 사용
- 하단 footer에 합계 라인이 없으면 null

응답 형식:
{
  "items": [
    { "name": "얼갈이배추", "spec": "계약재배 KG, 한국Wn※국내산", "unit": "KG", "quantity": 2, "unit_price": 10199, "supply_amount": 20398, "tax_amount": 0, "total_price": 20398 },
    { "name": "소앞다리", "spec": "6*5*0.2cm 불고기용 KG, 한국Wn※쇠고기(호주산)", "unit": "KG", "quantity": 8, "unit_price": 20894, "supply_amount": 167152, "tax_amount": 0, "total_price": 167152 },
    { "name": "양념치킨소스", "spec": "2kg, 국내산", "unit": "EA", "quantity": 5, "unit_price": 12000, "supply_amount": 60000, "tax_amount": 6000, "total_price": 66000 }
  ],
  "page_total": 253550
}

주의사항:
- 숫자에서 콤마(,) 제거
- 합계/소계 행(품명이 "합계", "소계", "총계" 같은 집계 행)은 items 배열에서 제외하고 그 값은 page_total로만 반환
- 품목명에 브랜드명/한정수량 표시가 있으면 포함
- ★ 원산지 정보 (국내산/수입산/한국Wn 코드 등) 절대 누락 금지: 식자재 매칭/가격 비교에서 원산지가 핵심 식별 요소이므로 spec 필드에 반드시 보존
- JSON만 반환 (설명 없이)
- 단가가 비어있고 총액만 있는 행도 누락 없이 포함 (unit_price=0으로 두고 total_price는 채울 것)

한국어 식자재 표기 가이드 (오인식 방지):
- 두부 종류는 "판두부 / 모두부 / 손두부 / 연두부 / 순두부"가 표준 표기.
  "편두부"는 거의 사용되지 않으므로 "편"으로 보이면 "판"의 오독일 가능성이 높음
- 한국 식자재 공급사 브랜드명 (자주 등장, 정확히 표기):
  · "이츠웰" — 계란/다진마늘 등 공급. "이초웰"은 오독 가능성 높음
  · "종가집" — 김치 공급. "증가집"은 오독 가능성 높음
  · "굿픽" — 야채류 공급. 괄호 안에서 "(굿픽 1KG/EA)" 형태로 표기.
    "굿떡/굿팩/굿핏/굿박/굿곡/긋픽"은 모두 "굿픽"의 오독 가능성 높음
  · "담터" — 유자차/보리차 등 차 음료 공급
  · "맛뜨락" — 들기름/들깨 공급
  · "사조오양" — 햄 공급 (사조대림/사조해표 등 사조 계열사도 함께 자주 등장)
  · "칠갑농산" — 떡볶이떡 공급
  · "마차촌" — 어묵 공급. "마자촌/마자춘"은 오독 가능성 높음
- 나물류 표기:
  · "숙주" — 녹두 발아 나물. "속주"는 오독 가능성 매우 높음 (속주나물이라는 표기는 거의 없음)
- 정육 부위 표기:
  · "돈앞다리 / 소앞다리" — 돼지/소 앞다리살. "돈암다리/소암다리"는 "앞"의 오독
- 그 외 "판/편", "솜/송", "켜/거", "앞/암" 등 한국어 자모 비슷한 글자가 보이면 한국 식자재 표준 표기를 우선
`

function parseGeminiResponse(text: string): { items: ExtractedItem[]; page_total: number | null } {
  // Remove markdown code blocks if present
  let cleanText = text.trim()
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.slice(7)
  } else if (cleanText.startsWith('```')) {
    cleanText = cleanText.slice(3)
  }
  if (cleanText.endsWith('```')) {
    cleanText = cleanText.slice(0, -3)
  }
  cleanText = cleanText.trim()

  const parsed = JSON.parse(cleanText)

  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error('Invalid response format: items array not found')
  }

  const rawPageTotal = parsed.page_total != null ? Number(parsed.page_total) : NaN
  const page_total =
    !Number.isNaN(rawPageTotal) && rawPageTotal > 0 ? rawPageTotal : null

  const items = parsed.items.map((item: Record<string, unknown>) => {
    const quantity = Number(item.quantity) || 0
    const rawUnitPrice = Number(item.unit_price) || 0
    const rawSupply = item.supply_amount != null ? Number(item.supply_amount) : NaN
    const rawTax = item.tax_amount != null ? Number(item.tax_amount) : NaN
    const rawTotal = item.total_price != null ? Number(item.total_price) : NaN

    // total_price 최종 결정 (부가세 포함 최종 합계 우선)
    // 우선순위:
    //  1) 공급가액 + 세액 둘 다 있고 세액 > 0 → supply + tax (부가세 포함 보장)
    //     (OCR이 total_price에 공급가액을 잘못 잡는 경우를 방어)
    //  2) rawTotal (Gemini가 직접 추출한 합계/총액)
    //  3) rawSupply + rawTax (세액이 0이어도 합산)
    //  4) undefined
    let totalPrice: number | undefined
    const hasSupplyTax =
      !Number.isNaN(rawSupply) && rawSupply > 0 &&
      !Number.isNaN(rawTax) && rawTax > 0
    if (hasSupplyTax) {
      totalPrice = rawSupply + rawTax
    } else if (!Number.isNaN(rawTotal) && rawTotal > 0) {
      totalPrice = rawTotal
    } else if (!Number.isNaN(rawSupply) && rawSupply > 0) {
      totalPrice = rawSupply + (Number.isNaN(rawTax) ? 0 : rawTax)
    }

    // unit_price 보정: 빈 단가면 (공급가액 / 수량) 또는 (총액 / 수량) 으로 역산
    let unitPrice = rawUnitPrice
    if (unitPrice === 0 && quantity > 0) {
      if (!Number.isNaN(rawSupply) && rawSupply > 0) {
        unitPrice = Math.round(rawSupply / quantity)
      } else if (totalPrice && totalPrice > 0) {
        unitPrice = Math.round(totalPrice / quantity)
      }
    }

    // 한국 식자재 OCR 오인식 보정 (판두부 ↔ 편두부 등)
    const rawName = String(item.name || '')
    const rawSpec = item.spec ? String(item.spec) : undefined

    return {
      name: applyOcrFixes(rawName) ?? rawName,
      spec: applyOcrFixes(rawSpec),
      unit: item.unit ? String(item.unit).trim() || undefined : undefined,
      quantity,
      unit_price: unitPrice,
      supply_amount: !Number.isNaN(rawSupply) && rawSupply > 0 ? rawSupply : undefined,
      tax_amount: !Number.isNaN(rawTax) ? rawTax : undefined,
      total_price: totalPrice,
    }
  })

  return { items, page_total }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 429(rate limit) / 503(overloaded) / network 오류인지 판별
function isRetriableError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('quota') ||
    msg.includes('503') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset')
  )
}

export async function extractItemsFromImage(
  request: GeminiOCRRequest
): Promise<GeminiOCRResponse> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY

  if (!apiKey) {
    return {
      success: false,
      items: [],
      error: 'GOOGLE_GEMINI_API_KEY is not configured',
    }
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  // 2.5-flash: 2.0-flash보다 OCR 품질 개선, 무료 티어 10 RPM / 250K TPM / 500 RPD
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

  // 서버 내 재시도: Vercel maxDuration(60s) 초과 방지 위해 최대 2회 (OCR 7s + 10s + OCR 7s ≈ 24s)
  // 나머지 재시도는 클라이언트가 실패 페이지 큐를 통해 재실행 (useAuditSession)
  const MAX_ATTEMPTS = 2
  const BACKOFF_MS = [10_000] // attempt 1→2 만 (10초)
  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await model.generateContent([
        { text: EXTRACTION_PROMPT },
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: request.image,
          },
        },
      ])

      const text = result.response.text()
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Gemini OCR raw]', text.slice(0, 2000))
      }
      const { items, page_total } = parseGeminiResponse(text)

      const validItems = items.filter(
        (item) =>
          item.name &&
          item.quantity > 0 &&
          (item.unit_price > 0 || (item.total_price != null && item.total_price > 0))
      )

      return {
        success: true,
        items: validItems,
        page_total,
        raw_response: text,
      }
    } catch (error) {
      lastError = error
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      const errorStack = error instanceof Error ? error.stack?.slice(0, 500) : ''
      const retriable = isRetriableError(error)

      // Vercel log에 확실히 찍히도록 console.log + 구조화된 메시지로 출력
      console.log(
        `[Gemini OCR FAIL attempt=${attempt}/${MAX_ATTEMPTS} retriable=${retriable}] name=${errorName} msg=${errorMessage.slice(0, 300)}`
      )
      if (errorStack) {
        console.log(`[Gemini OCR STACK] ${errorStack}`)
      }

      // 마지막 시도이거나 재시도 불가능한 오류면 중단
      if (attempt >= MAX_ATTEMPTS || !retriable) break

      // 고정 단계적 backoff (429/rate limit 회복 대기): 10s → 30s → 60s → 90s (+ jitter 0-2s)
      const baseDelay = BACKOFF_MS[attempt - 1] ?? 90_000
      const delay = baseDelay + Math.floor(Math.random() * 2000)
      console.log(`[Gemini OCR RETRY] waiting ${Math.round(delay / 1000)}s before attempt ${attempt + 1}/${MAX_ATTEMPTS}`)
      await sleep(delay)
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError)
  const errorName = lastError instanceof Error ? lastError.name : 'UnknownError'
  return {
    success: false,
    items: [],
    error: `OCR failed after ${MAX_ATTEMPTS} retries: [${errorName}] ${errorMessage.slice(0, 500)}`,
  }
}

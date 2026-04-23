import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GeminiOCRRequest, GeminiOCRResponse, ExtractedItem } from '@/types/audit'

const EXTRACTION_PROMPT = `당신은 식자재 거래명세서 OCR 전문가입니다.
이미지에서 품목 리스트를 추출하여 JSON 형식으로 반환하세요.

추출 대상:
- 품목명 (name): 상품 이름
- 규격 (spec): 용량, 무게 등 (없으면 null)
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

응답 형식:
{
  "items": [
    { "name": "양념치킨소스", "spec": "2kg", "quantity": 5, "unit_price": 12000, "supply_amount": 60000, "tax_amount": 6000, "total_price": 66000 },
    { "name": "바라캣몰", "spec": "1kg 실온", "quantity": 1, "unit_price": 20700, "supply_amount": 20700, "tax_amount": 0, "total_price": 20700 },
    { "name": "간장", "spec": null, "quantity": 10, "unit_price": 3500, "supply_amount": null, "tax_amount": null, "total_price": 35000 }
  ]
}

주의사항:
- 숫자에서 콤마(,) 제거
- 합계/소계 행(품명이 "합계", "소계", "총계" 같은 집계 행)은 반드시 제외
- 품목명에 브랜드명/한정수량 표시가 있으면 포함
- JSON만 반환 (설명 없이)
- 단가가 비어있고 총액만 있는 행도 누락 없이 포함 (unit_price=0으로 두고 total_price는 채울 것)
`

function parseGeminiResponse(text: string): ExtractedItem[] {
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

  return parsed.items.map((item: Record<string, unknown>) => {
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

    return {
      name: String(item.name || ''),
      spec: item.spec ? String(item.spec) : undefined,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
    }
  })
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

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

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
    // 개발용 로그: 합계 열이 있는 거래명세서의 supply/tax/total 추출 여부 확인
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Gemini OCR raw]', text.slice(0, 2000))
    }
    const items = parseGeminiResponse(text)

    // 유효 품목: 이름 + 수량 + (단가 또는 총액) 중 하나라도 있어야 함
    const validItems = items.filter(
      (item) =>
        item.name &&
        item.quantity > 0 &&
        (item.unit_price > 0 || (item.total_price != null && item.total_price > 0))
    )

    return {
      success: true,
      items: validItems,
      raw_response: text,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Gemini OCR error:', errorMessage)

    return {
      success: false,
      items: [],
      error: `OCR failed: ${errorMessage}`,
    }
  }
}

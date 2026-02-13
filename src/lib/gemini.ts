import { GoogleGenerativeAI } from '@google/generative-ai'
import type { GeminiOCRRequest, GeminiOCRResponse, ExtractedItem } from '@/types/audit'

const EXTRACTION_PROMPT = `당신은 식자재 거래명세서 OCR 전문가입니다.
이미지에서 품목 리스트를 추출하여 JSON 형식으로 반환하세요.

추출 대상:
- 품목명 (name): 상품 이름
- 규격 (spec): 용량, 무게 등 (없으면 null)
- 수량 (quantity): 숫자만
- 단가 (unit_price): 숫자만 (원 단위)
- 금액 (total_price): 숫자만 (원 단위)

응답 형식:
{
  "items": [
    { "name": "양념치킨소스", "spec": "2kg", "quantity": 5, "unit_price": 12000, "total_price": 60000 },
    { "name": "간장", "spec": null, "quantity": 10, "unit_price": 3500, "total_price": 35000 }
  ]
}

주의사항:
- 숫자에서 콤마(,) 제거
- 합계/소계 행은 제외
- 품목명에 브랜드명이 있으면 포함
- JSON만 반환 (설명 없이)
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

  return parsed.items.map((item: Record<string, unknown>) => ({
    name: String(item.name || ''),
    spec: item.spec ? String(item.spec) : undefined,
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.unit_price) || 0,
    total_price: item.total_price ? Number(item.total_price) : undefined,
  }))
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
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

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
    const items = parseGeminiResponse(text)

    // Filter out invalid items (no name or zero quantity)
    const validItems = items.filter(
      (item) => item.name && item.quantity > 0 && item.unit_price > 0
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

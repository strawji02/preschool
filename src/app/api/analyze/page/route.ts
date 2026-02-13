import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractItemsFromImage } from '@/lib/gemini'
import { findComparisonMatches, calculateComparisonSavings } from '@/lib/matching'
import type {
  AnalyzePageRequest,
  ComparisonPageResponse,
  ComparisonItem,
} from '@/types/audit'

// Node.js Runtime (Edge에서 Gemini API 호출 문제로 롤백)
// export const runtime = 'edge'

// 타임아웃 설정 (Vercel Hobby: 10초, Pro: 60초)
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const body: AnalyzePageRequest = await request.json()

    // Validate request
    if (!body.session_id || !body.page_number || !body.image) {
      return NextResponse.json<ComparisonPageResponse>(
        {
          success: false,
          page_number: body.page_number || 0,
          items: [],
          error: 'Missing required fields: session_id, page_number, image',
        },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // 1. Verify session exists
    const { data: session, error: sessionError } = await supabase
      .from('audit_sessions')
      .select('id')
      .eq('id', body.session_id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json<ComparisonPageResponse>(
        {
          success: false,
          page_number: body.page_number,
          items: [],
          error: 'Session not found',
        },
        { status: 404 }
      )
    }

    console.log(`[${body.session_id}] Processing page ${body.page_number}...`)
    console.log(`[${body.session_id}] Step 1: Session verified (${Date.now() - startTime}ms)`)

    // 2. Upload image to Storage
    const imagePath = `${body.session_id}/${body.page_number}.jpg`
    const imageBuffer = Buffer.from(body.image, 'base64')

    const { error: uploadError } = await supabase.storage
      .from('invoice-images')
      .upload(imagePath, imageBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      })

    if (uploadError) {
      console.error('Image upload error:', uploadError)
      // Continue even if upload fails - we can still process OCR
    }

    console.log(`[${body.session_id}] Step 2: Image uploaded (${Date.now() - startTime}ms)`)

    // 3. Run Gemini OCR (supplier 제거)
    console.log(`[${body.session_id}] Step 3: Starting Gemini OCR...`)
    const ocrStartTime = Date.now()
    const ocrResult = await extractItemsFromImage({
      image: body.image,
    })
    console.log(`[${body.session_id}] Step 3: Gemini OCR completed in ${Date.now() - ocrStartTime}ms`)

    if (!ocrResult.success) {
      return NextResponse.json<ComparisonPageResponse>(
        {
          success: false,
          page_number: body.page_number,
          items: [],
          error: ocrResult.error || 'OCR failed',
        },
        { status: 500 }
      )
    }

    console.log(
      `[${body.session_id}] OCR extracted ${ocrResult.items.length} items (${Date.now() - startTime}ms)`
    )

    // 4. Side-by-Side Comparison Matching - CJ와 SSG 병렬 검색 (깔때기 알고리즘 적용)
    console.log(`[${body.session_id}] Step 4: Starting matching for ${ocrResult.items.length} items...`)
    const matchStartTime = Date.now()
    const matchPromises = ocrResult.items.map((item, idx) => {
      console.log(`[${body.session_id}] Matching item ${idx + 1}: ${item.name}`)
      return findComparisonMatches(item.name, supabase, undefined, item) // extractedItem 전달
    })
    const matchResults = await Promise.all(matchPromises)

    console.log(`[${body.session_id}] Step 4: Matching completed in ${Date.now() - matchStartTime}ms (total: ${Date.now() - startTime}ms)`)

    // 5. Prepare items for DB insert and response
    const processedItems = ocrResult.items.map((item, index) => {
      const match = matchResults[index]

      // Calculate savings for both suppliers (with VAT normalization)
      const savings = calculateComparisonSavings(
        item.unit_price,
        item.quantity,
        match.cj_match?.standard_price,
        match.ssg_match?.standard_price,
        match.cj_match?.tax_type,
        match.ssg_match?.tax_type
      )

      // For DB: 최고 절감 공급사의 매칭 정보 저장 (호환성)
      const bestMatch = savings.best_supplier === 'CJ' ? match.cj_match
        : savings.best_supplier === 'SHINSEGAE' ? match.ssg_match
        : match.cj_match ?? match.ssg_match

      return {
        // DB 필드
        dbRecord: {
          session_id: body.session_id,
          extracted_name: item.name,
          extracted_spec: item.spec,
          extracted_quantity: item.quantity,
          extracted_unit_price: item.unit_price,
          extracted_total_price: item.total_price,
          matched_product_id: bestMatch?.id,
          match_score: bestMatch?.match_score,
          match_candidates: null,
          match_status: match.status,
          standard_price: bestMatch?.standard_price,
          price_difference: bestMatch ? item.unit_price - bestMatch.standard_price : undefined,
          loss_amount: savings.max,
          page_number: body.page_number,
          row_index: index,
        },
        // Response용 추가 데이터
        cj_match: match.cj_match,
        ssg_match: match.ssg_match,
        cj_candidates: match.cj_candidates,
        ssg_candidates: match.ssg_candidates,
        savings,
      }
    })

    // 6. Batch insert into audit_items (DB 필드만)
    const { data: insertedItems, error: insertError } = await supabase
      .from('audit_items')
      .insert(processedItems.map(p => p.dbRecord))
      .select('id')

    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json<ComparisonPageResponse>(
        {
          success: false,
          page_number: body.page_number,
          items: [],
          error: `Database insert failed: ${insertError.message}`,
        },
        { status: 500 }
      )
    }

    console.log(`[${body.session_id}] DB insert completed (${Date.now() - startTime}ms)`)

    // 7. Update session stats
    await supabase.rpc('update_session_stats', { session_uuid: body.session_id })

    // 8. Prepare response (Side-by-Side ComparisonItem 포맷)
    const responseItems: ComparisonItem[] = processedItems.map((item, index) => ({
      id: insertedItems?.[index]?.id || '',
      extracted_name: item.dbRecord.extracted_name,
      extracted_spec: item.dbRecord.extracted_spec,
      extracted_quantity: item.dbRecord.extracted_quantity,
      extracted_unit_price: item.dbRecord.extracted_unit_price,
      cj_match: item.cj_match,
      ssg_match: item.ssg_match,
      cj_candidates: item.cj_candidates,
      ssg_candidates: item.ssg_candidates,
      is_confirmed: false, // 초기값: 미확정
      savings: item.savings,
      match_status: item.dbRecord.match_status,
    }))

    console.log(`[${body.session_id}] Page ${body.page_number} completed in ${Date.now() - startTime}ms`)

    return NextResponse.json<ComparisonPageResponse>({
      success: true,
      page_number: body.page_number,
      items: responseItems,
    })
  } catch (error) {
    console.error('Analyze page error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json<ComparisonPageResponse>(
      {
        success: false,
        page_number: 0,
        items: [],
        error: `Internal server error: ${errorMessage}`,
      },
      { status: 500 }
    )
  }
}

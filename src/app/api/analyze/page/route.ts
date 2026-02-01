import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractItemsFromImage } from '@/lib/gemini'
import { findMatches, calculateLoss } from '@/lib/matching'
import type {
  AnalyzePageRequest,
  AnalyzePageResponse,
  AuditItemResponse,
  Supplier,
} from '@/types/audit'

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const body: AnalyzePageRequest = await request.json()

    // Validate request
    if (!body.session_id || !body.page_number || !body.image) {
      return NextResponse.json<AnalyzePageResponse>(
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
      return NextResponse.json<AnalyzePageResponse>(
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

    console.log(`[${body.session_id}] Image uploaded (${Date.now() - startTime}ms)`)

    // 3. Run Gemini OCR (supplier 제거)
    const ocrResult = await extractItemsFromImage({
      image: body.image,
    })

    if (!ocrResult.success) {
      return NextResponse.json<AnalyzePageResponse>(
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

    // 4. Parallel Fuzzy Matching - 전체 DB 검색 (supplier 제거)
    const matchPromises = ocrResult.items.map((item) =>
      findMatches(item.name, supabase)
    )
    const matchResults = await Promise.all(matchPromises)

    console.log(`[${body.session_id}] Matching completed (${Date.now() - startTime}ms)`)

    // 5. Prepare items for DB insert and response
    const itemsToInsert = ocrResult.items.map((item, index) => {
      const match = matchResults[index]
      const bestMatch = match.best_match

      // Calculate savings if matched
      let lossAmount: number | undefined
      let standardPrice: number | undefined
      let priceDiff: number | undefined

      if (bestMatch) {
        standardPrice = bestMatch.standard_price
        priceDiff = item.unit_price - standardPrice
        lossAmount = calculateLoss(item.unit_price, standardPrice, item.quantity)
      }

      return {
        session_id: body.session_id,
        extracted_name: item.name,
        extracted_spec: item.spec,
        extracted_quantity: item.quantity,
        extracted_unit_price: item.unit_price,
        extracted_total_price: item.total_price,
        matched_product_id: bestMatch?.id,
        match_score: bestMatch?.match_score ?? match.candidates?.[0]?.match_score,
        match_candidates: match.candidates,
        match_status: match.status,
        standard_price: standardPrice,
        price_difference: priceDiff,
        loss_amount: lossAmount,
        page_number: body.page_number,
        row_index: index,
      }
    })

    // 6. Batch insert into audit_items
    const { data: insertedItems, error: insertError } = await supabase
      .from('audit_items')
      .insert(itemsToInsert)
      .select('id')

    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json<AnalyzePageResponse>(
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

    // 8. Prepare response (supplier 포함)
    const responseItems: AuditItemResponse[] = itemsToInsert.map((item, index) => ({
      id: insertedItems?.[index]?.id || '',
      extracted_name: item.extracted_name,
      extracted_spec: item.extracted_spec,
      extracted_quantity: item.extracted_quantity,
      extracted_unit_price: item.extracted_unit_price,
      matched_product: item.matched_product_id
        ? {
            id: item.matched_product_id,
            product_name: matchResults[index].best_match?.product_name || '',
            standard_price: item.standard_price || 0,
            supplier: matchResults[index].best_match?.supplier as Supplier,
          }
        : undefined,
      match_score: item.match_score,
      match_status: item.match_status,
      match_candidates: item.match_candidates,
      loss_amount: item.loss_amount,
    }))

    console.log(`[${body.session_id}] Page ${body.page_number} completed in ${Date.now() - startTime}ms`)

    return NextResponse.json<AnalyzePageResponse>({
      success: true,
      page_number: body.page_number,
      items: responseItems,
    })
  } catch (error) {
    console.error('Analyze page error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json<AnalyzePageResponse>(
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

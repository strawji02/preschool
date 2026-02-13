import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findComparisonMatches, calculateComparisonSavings } from '@/lib/matching'
import type { ComparisonItem } from '@/types/audit'

// Edge Runtime 사용
export const runtime = 'edge'

interface ExcelItem {
  name: string
  spec?: string
  quantity: number
  unit_price: number
  total_price: number
  row_index: number
}

interface ExcelAnalyzeRequest {
  session_id: string
  items: ExcelItem[]
}

interface ExcelAnalyzeResponse {
  success: boolean
  items: ComparisonItem[]
  error?: string
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const body: ExcelAnalyzeRequest = await request.json()

    // Validate request
    if (!body.session_id || !body.items || !Array.isArray(body.items)) {
      return NextResponse.json<ExcelAnalyzeResponse>(
        {
          success: false,
          items: [],
          error: 'Missing required fields: session_id, items',
        },
        { status: 400 }
      )
    }

    if (body.items.length === 0) {
      return NextResponse.json<ExcelAnalyzeResponse>(
        {
          success: false,
          items: [],
          error: '추출된 품목이 없습니다.',
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
      return NextResponse.json<ExcelAnalyzeResponse>(
        {
          success: false,
          items: [],
          error: 'Session not found',
        },
        { status: 404 }
      )
    }

    console.log(`[${body.session_id}] Processing ${body.items.length} items from Excel...`)

    // 2. 각 품목에 대해 CJ/SSG 매칭 수행
    const matchPromises = body.items.map((item, idx) => {
      console.log(`[${body.session_id}] Matching item ${idx + 1}: ${item.name}`)
      return findComparisonMatches(item.name, supabase, undefined, {
        name: item.name,
        spec: item.spec,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
      })
    })
    
    const matchResults = await Promise.all(matchPromises)

    // 3. 결과 정리 및 DB 저장
    const processedItems = body.items.map((item, index) => {
      const match = matchResults[index]

      const savings = calculateComparisonSavings(
        item.unit_price,
        item.quantity,
        match.cj_match?.standard_price,
        match.ssg_match?.standard_price,
        match.cj_match?.tax_type,
        match.ssg_match?.tax_type
      )

      const bestMatch = savings.best_supplier === 'CJ' ? match.cj_match
        : savings.best_supplier === 'SHINSEGAE' ? match.ssg_match
        : match.cj_match ?? match.ssg_match

      return {
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
          page_number: 1, // 엑셀은 단일 페이지로 처리
          row_index: item.row_index,
        },
        cj_match: match.cj_match,
        ssg_match: match.ssg_match,
        cj_candidates: match.cj_candidates,
        ssg_candidates: match.ssg_candidates,
        savings,
      }
    })

    // 4. DB 저장
    const { data: insertedItems, error: insertError } = await supabase
      .from('audit_items')
      .insert(processedItems.map(p => p.dbRecord))
      .select('id')

    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json<ExcelAnalyzeResponse>(
        {
          success: false,
          items: [],
          error: `Database insert failed: ${insertError.message}`,
        },
        { status: 500 }
      )
    }

    // 5. 세션 통계 업데이트
    await supabase.rpc('update_session_stats', { session_uuid: body.session_id })

    // 6. 응답 생성
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
      is_confirmed: false,
      savings: item.savings,
      match_status: item.dbRecord.match_status,
    }))

    console.log(`[${body.session_id}] Excel analysis completed in ${Date.now() - startTime}ms`)

    return NextResponse.json<ExcelAnalyzeResponse>({
      success: true,
      items: responseItems,
    })
  } catch (error) {
    console.error('Excel analyze error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json<ExcelAnalyzeResponse>(
      {
        success: false,
        items: [],
        error: `Internal server error: ${errorMessage}`,
      },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embedding'
import type { SearchProductsResponse, MatchCandidate, Supplier } from '@/types/audit'

interface RpcResult {
  id: string
  product_name: string
  standard_price: number
  unit_normalized: string
  spec_quantity: number | null
  spec_unit: string | null
  supplier: string
  match_score: number
  similarity?: number // For semantic search
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')
    const supplier = searchParams.get('supplier') as Supplier | null
    const limit = parseInt(searchParams.get('limit') || '10', 10)

    // Validate query
    if (!query || query.trim().length === 0) {
      return NextResponse.json<SearchProductsResponse>(
        { success: false, products: [], error: 'Query parameter "q" is required' },
        { status: 400 }
      )
    }

    if (supplier && !['CJ', 'SHINSEGAE'].includes(supplier)) {
      return NextResponse.json<SearchProductsResponse>(
        { success: false, products: [], error: 'Invalid supplier. Must be CJ or SHINSEGAE' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const searchMode = process.env.NEXT_PUBLIC_SEARCH_MODE || 'hybrid'

    let results: RpcResult[] = []
    let error: any = null

    // Choose search strategy based on mode
    if (searchMode === 'semantic') {
      try {
        const embedding = await generateEmbedding(query)
        const { data, error: rpcError } = await supabase.rpc('search_products_vector', {
          query_embedding: embedding,
          limit_count: Math.min(limit, 50),
          supplier_filter: supplier || undefined,
          similarity_threshold: 0.3,
        })
        results = (data as RpcResult[] || []).map(r => ({
          ...r,
          match_score: r.similarity ?? 0,
        }))
        error = rpcError
      } catch (embedError) {
        console.error('Embedding generation failed:', embedError)
        return NextResponse.json<SearchProductsResponse>(
          { success: false, products: [], error: 'Embedding generation failed' },
          { status: 500 }
        )
      }
    } else {
      // Use fuzzy search for other modes (trigram, hybrid, bm25)
      const { data, error: rpcError } = await supabase.rpc('search_products_fuzzy', {
        search_term_raw: query,
        limit_count: Math.min(limit, 50),
      })
      results = data as RpcResult[] || []
      error = rpcError
    }

    if (error) {
      console.error('Search RPC error:', error)
      return NextResponse.json<SearchProductsResponse>(
        { success: false, products: [], error: `Search failed: ${error.message}` },
        { status: 500 }
      )
    }

    // supplier 필터가 있으면 결과에서 필터링 (semantic 모드는 이미 RPC에서 필터링됨)
    if (supplier && searchMode !== 'semantic') {
      results = results.filter((p) => p.supplier === supplier)
    }

    const products: MatchCandidate[] = results.map((p) => ({
      id: p.id,
      product_name: p.product_name,
      standard_price: p.standard_price,
      unit_normalized: p.unit_normalized,
      spec_quantity: p.spec_quantity ?? undefined,
      spec_unit: p.spec_unit ?? undefined,
      supplier: p.supplier as Supplier,
      match_score: p.match_score,
    }))

    return NextResponse.json<SearchProductsResponse>({
      success: true,
      products,
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json<SearchProductsResponse>(
      { success: false, products: [], error: 'Internal server error' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/embedding'
import { expandWithSynonyms } from '@/lib/synonyms'
import { dualNormalize } from '@/lib/preprocessing'
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
  bm25_rank?: number // For BM25 search
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

    // Synonym expansion for better search recall
    const { forKeyword } = dualNormalize(query)
    const synonymTerms = expandWithSynonyms(forKeyword)
    const expandedQuery = synonymTerms.length > 1
      ? synonymTerms.slice(0, 3).join(' ')
      : forKeyword

    let results: RpcResult[] = []
    let error: any = null

    // Choose search strategy based on mode
    if (searchMode === 'hybrid') {
      // Hybrid Search: BM25 + Trigram (matching.ts와 동일한 함수 사용)
      const { data, error: rpcError } = await supabase.rpc('search_products_hybrid', {
        search_term_raw: query,
        search_term_clean: expandedQuery,
        limit_count: Math.min(limit, 50),
        supplier_filter: supplier || undefined,
        bm25_weight: 0.5,
        semantic_weight: 0.5,
      })
      results = data as RpcResult[] || []
      error = rpcError
    } else if (searchMode === 'semantic') {
      // Semantic-only Search: Vector similarity
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
    } else if (searchMode === 'bm25') {
      // BM25-only Search: Keyword matching
      const { data, error: rpcError } = await supabase.rpc('search_products_bm25', {
        search_term: query,
        limit_count: Math.min(limit, 50),
        supplier_filter: supplier || undefined,
      })
      results = (data as RpcResult[] || []).map(r => ({
        ...r,
        match_score: r.bm25_rank ?? 0,
      }))
      error = rpcError
    } else {
      // Trigram Search (fallback for legacy mode)
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

    // ── 자세한 규격 정보 enrichment (2026-05-04 추가) ──
    // RPC가 반환하지 않는 컬럼들 (product_code/spec_raw/origin/subcategory/storage_temp/tax_type)을 별도 SELECT로 fetch.
    const ids = results.map((p) => p.id).filter(Boolean)
    let extraMap: Record<string, {
      product_code?: string
      spec_raw?: string
      unit_raw?: string
      origin?: string
      category?: string
      subcategory?: string
      tax_type?: '과세' | '면세'
      storage_temp?: string
    }> = {}
    if (ids.length > 0) {
      const { data: extras } = await supabase
        .from('products')
        .select('id, product_code, spec_raw, unit_raw, origin, category, subcategory, tax_type, storage_temp')
        .in('id', ids)
      if (extras) {
        extraMap = Object.fromEntries(
          extras.map((e) => [
            e.id as string,
            {
              product_code: e.product_code as string | undefined,
              spec_raw: e.spec_raw as string | undefined,
              unit_raw: e.unit_raw as string | undefined,
              origin: e.origin as string | undefined,
              category: e.category as string | undefined,
              subcategory: e.subcategory as string | undefined,
              tax_type: e.tax_type as '과세' | '면세' | undefined,
              storage_temp: e.storage_temp as string | undefined,
            },
          ]),
        )
      }
    }

    const products = results.map((p) => {
      const extra = extraMap[p.id] ?? {}
      return {
        id: p.id,
        product_name: p.product_name,
        standard_price: p.standard_price,
        unit_normalized: p.unit_normalized,
        spec_quantity: p.spec_quantity ?? undefined,
        spec_unit: p.spec_unit ?? undefined,
        supplier: p.supplier as Supplier,
        match_score: p.match_score,
        // 자세한 규격 정보
        product_code: extra.product_code,
        spec_raw: extra.spec_raw,
        unit_raw: extra.unit_raw,
        origin: extra.origin,
        category: extra.category,
        subcategory: extra.subcategory,
        tax_type: extra.tax_type,
        storage_temp: extra.storage_temp,
      }
    })

    return NextResponse.json<SearchProductsResponse>({
      success: true,
      products: products as unknown as MatchCandidate[],
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json<SearchProductsResponse>(
      { success: false, products: [], error: 'Internal server error' },
      { status: 500 }
    )
  }
}

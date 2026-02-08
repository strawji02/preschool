/**
 * Test script to compare findComparisonMatches vs /api/products/search
 * 
 * Usage: npx tsx scripts/test-search-comparison.ts
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function main() {
  const supabase = createClient(supabaseUrl, supabaseKey)
  
  // Test queries
  const testQueries = [
    '국내산깻잎',
    '깻잎(국내산)',
    '깻잎',
  ]
  
  console.log('=== Semantic Search Comparison Test ===\n')
  
  for (const query of testQueries) {
    console.log(`\n--- Query: "${query}" ---\n`)
    
    // 1. Generate embedding
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 384,
    })
    
    const embedding = embeddingResponse.data[0].embedding
    
    // 2. Call search_products_vector for SHINSEGAE
    const { data: ssgResults, error: ssgError } = await supabase.rpc('search_products_vector', {
      query_embedding: embedding,
      limit_count: 5,
      supplier_filter: 'SHINSEGAE',
      similarity_threshold: 0.3,
    })
    
    if (ssgError) {
      console.error('SSG Error:', ssgError)
      continue
    }
    
    console.log('SHINSEGAE Results:')
    if (ssgResults && ssgResults.length > 0) {
      ssgResults.forEach((r: any, i: number) => {
        console.log(`  ${i + 1}. ${r.product_name} (similarity: ${(r.similarity * 100).toFixed(1)}%, price: ${r.standard_price})`)
      })
    } else {
      console.log('  (No results)')
    }
    
    // 3. Call search_products_vector for CJ
    const { data: cjResults, error: cjError } = await supabase.rpc('search_products_vector', {
      query_embedding: embedding,
      limit_count: 5,
      supplier_filter: 'CJ',
      similarity_threshold: 0.3,
    })
    
    if (cjError) {
      console.error('CJ Error:', cjError)
      continue
    }
    
    console.log('\nCJ Results:')
    if (cjResults && cjResults.length > 0) {
      cjResults.forEach((r: any, i: number) => {
        console.log(`  ${i + 1}. ${r.product_name} (similarity: ${(r.similarity * 100).toFixed(1)}%, price: ${r.standard_price})`)
      })
    } else {
      console.log('  (No results)')
    }
  }
  
  console.log('\n=== Test Complete ===')
}

main().catch(console.error)

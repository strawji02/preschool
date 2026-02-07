# Phase 2: Semantic Search Implementation

## Overview

Integrated semantic vector search into the API using OpenAI embeddings and Supabase `search_products_vector` RPC function. This provides superior matching accuracy compared to trigram-based fuzzy search.

## Implementation Summary

### Files Modified

1. **`src/lib/embedding.ts`** (NEW)
   - OpenAI embedding generation utilities
   - `generateEmbedding()`: Single text embedding
   - `generateEmbeddings()`: Batch embedding generation
   - Uses `text-embedding-3-small` model with 384 dimensions

2. **`src/lib/matching.ts`** (UPDATED)
   - Added 'semantic' to SearchMode type
   - Updated `findMatches()` to support semantic search
   - Updated `findComparisonMatches()` to support semantic search
   - Converts similarity scores to match_score for consistency
   - Falls back gracefully if embedding generation fails

3. **`src/app/api/products/search/route.ts`** (UPDATED)
   - Added semantic search mode support
   - Uses `search_products_vector` when mode is 'semantic'
   - Maintains backward compatibility with other modes

4. **`scripts/test-semantic-api.ts`** (NEW)
   - Integration test for semantic search
   - Tests both single and comparison matching
   - Validates end-to-end flow

5. **`.env.local`** (UPDATED)
   - Added `NEXT_PUBLIC_SEARCH_MODE=semantic`
   - Enables semantic search by default

## Technical Details

### Search Flow

1. **Query Processing**:
   ```typescript
   const embedding = await generateEmbedding(query)
   // → [384-dimensional vector]
   ```

2. **Vector Search**:
   ```typescript
   const result = await supabase.rpc('search_products_vector', {
     query_embedding: embedding,
     limit_count: 5,
     supplier_filter: 'CJ' | 'SHINSEGAE' | undefined,
     similarity_threshold: 0.3,
   })
   ```

3. **Score Conversion**:
   ```typescript
   match_score = similarity  // Direct mapping for consistency
   ```

### Performance Results

Test results from `test-semantic-api.ts`:

| Query | Top Match | Score | Status |
|-------|-----------|-------|--------|
| 흰우유,서울우유 | 흰우유 서울우유 | 0.940 | Auto-matched ✅ |
| 부침가루,오뚜기 | 부침가루 뚜레반 | 0.790 | Pending |
| 딸기잼,복음자리 | 딸기잼 가림 | 0.646 | Pending |
| 국산콩나물 | 국산콩 찌개용판두부 | 0.590 | Pending |
| 속이꽉찬 평양식왕만두 | 쉐프초이스 왕만두 | 0.534 | Pending |

**Overall Phase 2 Performance** (from previous tests):
- **Phase 2 (Semantic) Wins**: 94%
- **Phase 1 (Trigram) Wins**: 0%
- **Ties**: 6%

## Configuration

### Environment Variables

```bash
# .env.local
NEXT_PUBLIC_SEARCH_MODE=semantic  # Enable semantic search
OPENAI_API_KEY=sk-proj-...        # Required for embeddings
```

### Available Search Modes

- `semantic` - Phase 2 vector similarity (RECOMMENDED) ⭐
- `hybrid` - Phase 1 BM25 + Trigram fusion
- `bm25` - Keyword-based full-text search
- `trigram` - Legacy fuzzy search

## Usage Examples

### In Code

```typescript
import { findMatches } from '@/lib/matching'

// Auto-detects mode from NEXT_PUBLIC_SEARCH_MODE
const result = await findMatches('흰우유', supabase)

// Or explicitly specify mode
const result = await findMatches('흰우유', supabase, 'semantic')
```

### API Endpoint

```bash
# GET /api/products/search?q=흰우유&supplier=CJ
# Uses NEXT_PUBLIC_SEARCH_MODE from environment
```

## Database Requirements

- **RPC Function**: `search_products_vector(query_embedding, limit_count, supplier_filter?, similarity_threshold?)`
- **Embeddings**: 23,866 products with 384-dimensional vectors
- **Extension**: pgvector installed and configured

## Error Handling

- Embedding generation failures → returns error response
- Missing OPENAI_API_KEY → throws configuration error
- RPC failures → returns empty results with error message
- Graceful fallback to other modes if semantic fails

## Testing

Run integration tests:
```bash
npx tsx scripts/test-semantic-api.ts
```

Expected output:
- ✅ Embeddings generated successfully
- ✅ RPC function called correctly
- ✅ Similarity scores mapped to match_score
- ✅ Both single and comparison searches work

## Next Steps

1. ✅ Set `NEXT_PUBLIC_SEARCH_MODE=semantic` in `.env.local`
2. ✅ Restart dev server: `npm run dev`
3. ⏳ Test in browser UI with real queries
4. ⏳ Monitor OpenAI API usage and costs
5. ⏳ Consider hybrid approach combining semantic + keyword search

## Cost Considerations

- **Model**: `text-embedding-3-small` ($0.02 per 1M tokens)
- **Average query**: ~10 tokens = $0.0000002 per search
- **Batch processing**: Use `generateEmbeddings()` for bulk operations
- **Caching**: Consider caching common query embeddings

## Migration Path

Current setup allows seamless switching between modes:

```bash
# Production: Use semantic for best accuracy
NEXT_PUBLIC_SEARCH_MODE=semantic

# Fallback: Use hybrid if OpenAI issues
NEXT_PUBLIC_SEARCH_MODE=hybrid

# Legacy: Use trigram for testing
NEXT_PUBLIC_SEARCH_MODE=trigram
```

## Deployment Notes

Required environment variables in production:
```bash
OPENAI_API_KEY=sk-proj-...
NEXT_PUBLIC_SEARCH_MODE=semantic
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## References

- Test script: `scripts/test-phase1-vs-phase2.ts` (original performance comparison)
- Embedding generation: `scripts/generate-embeddings-openai.ts`
- Vector search verification: `scripts/test-vector-quick.ts`

/**
 * 임베딩이 없는 `products` 행을 채운다 — docs/systems/comparison.md §9
 *
 * ```
 *   npx tsx scripts/embed-missing-products.ts            (몇 개인지만 본다)
 *   npx tsx scripts/embed-missing-products.ts --apply
 * ```
 *
 * ★ **모델을 바꾸면 안 된다.** 기존 8,787행이 OpenAI `text-embedding-3-small`
 * **384차원**으로 들어가 있다. 다른 모델·차원으로 섞으면 코사인 거리가
 * 뒤죽박죽이 되어 엉뚱한 품목이 뜬다.
 *
 * ⚠️ **지금 운영에는 효과가 없다.** 운영은 `hybrid` 모드(BM25 + trigram)이고
 * 그 함수는 `embedding`을 쓰지 않는다 (2026-08-15 DB 정의 확인:
 * `search_products_hybrid(text,text,integer,text,real,real)`).
 * 그래도 채워 두는 이유 — `semantic` 모드를 켜는 날 `search_products_vector`가
 * `embedding IS NOT NULL`로 걸러서, 비어 있는 행은 **아예 안 보인다.**
 *
 * ⚠️ **다시 돌려도 안전하다.** 이미 있는 행은 건너뛴다.
 */

import { createClient } from '@supabase/supabase-js'
import * as path from 'path'
import * as fs from 'fs'

const MODEL = 'text-embedding-3-small'
const DIMENSIONS = 384
/** OpenAI는 한 번에 여러 문장을 받는다. 너무 크게 묶으면 토큰 상한에 걸린다. */
const EMBED_BATCH = 100

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m || process.env[m[1]]) return
    // 이 저장소의 .env.local은 값을 따옴표로 감싼다 — 벗기지 않으면 URL 검증에서 죽는다
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  })
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface Row {
  id: string
  product_name: string
}

/**
 * 임베딩 없는 행 전부.
 *
 * ⚠️ **정렬 없이 range로 넘기면 행을 빠뜨린다** (PostgREST가 순서를 보장하지 않는다).
 * 2026-08-15에 이 버그로 신규 품목 수를 320개로 잘못 셌다 (실제 107개).
 */
async function loadMissing(): Promise<Row[]> {
  const out: Row[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, product_name')
      .is('embedding', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`products 조회 실패: ${error.message}`)
    const rows = (data ?? []) as Row[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMENSIONS }),
  })
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    /*
      ⚠️ 키를 로그에 찍지 않는다. 2026-08-14에 내가 셸 표현식을 잘못 써서
      OPENAI_API_KEY를 대화에 노출시켰고 그 키를 폐기해야 했다.
    */
    throw new Error(`OpenAI 임베딩 실패 (HTTP ${res.status}): ${body}`)
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] }
  return json.data.map((d) => d.embedding)
}

async function main() {
  const apply = process.argv.includes('--apply')

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY가 없습니다. .env.local에 넣어 주세요.')
    process.exit(1)
  }

  console.log('\n1️⃣  임베딩 없는 행 찾기')
  const rows = await loadMissing()
  console.log(`   ${rows.length.toLocaleString()}개`)
  if (rows.length === 0) {
    console.log('\n   채울 것이 없습니다.')
    return
  }

  // 대략적인 비용 — 한글은 토큰이 글자당 1개 남짓이다
  const chars = rows.reduce((n, r) => n + (r.product_name?.length ?? 0), 0)
  console.log(`   품목명 총 ${chars.toLocaleString()}자 → 대략 $${((chars / 1_000_000) * 0.02).toFixed(4)}`)
  console.log(`   모델 ${MODEL} · ${DIMENSIONS}차원 (기존 행과 같아야 한다)`)

  if (!apply) {
    console.log('\n👀 DRY-RUN — 호출 없음. --apply 를 붙이면 실제로 만듭니다.')
    return
  }

  console.log('\n2️⃣  생성·저장')
  let done = 0
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const slice = rows.slice(i, i + EMBED_BATCH)
    const vectors = await embed(slice.map((r) => r.product_name ?? ''))
    if (vectors.length !== slice.length) {
      throw new Error(`응답 개수 불일치: ${vectors.length} ≠ ${slice.length}`)
    }
    /*
      ⚠️ **한 행씩 update한다.** upsert로 묶으면 NOT NULL 컬럼까지 다 실어야 하고,
      빠뜨리면 기존 값을 null로 덮어쓴다. 임베딩만 건드리는 게 안전하다.
    */
    for (let k = 0; k < slice.length; k++) {
      const { error } = await supabase
        .from('products')
        .update({ embedding: vectors[k] })
        .eq('id', slice[k].id)
      if (error) throw new Error(`저장 실패 (${slice[k].id}): ${error.message}`)
    }
    done += slice.length
    console.log(`   🧠 ${done}/${rows.length}`)
  }

  console.log('\n3️⃣  확인')
  const still = await loadMissing()
  console.log(`   임베딩 없는 행: ${still.length}개 ${still.length === 0 ? '(정상)' : '⚠️'}`)
  console.log(`\n✅ ${done.toLocaleString()}개 생성.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

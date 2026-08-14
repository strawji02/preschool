/**
 * 기준월 단가표를 한 번만 읽어 들고 있는다 — docs/systems/comparison.md §9
 *
 * ★ **왜** — 매칭은 품목 **한 건씩** 돌면서 후보 단가를 덮는다. 거래명세표 한 장이
 * 품목 200개면 단가표 조회가 200번 나간다. 그 달 단가표는 7,800행 남짓이라
 * **통째로 한 번 읽어 들고 있는 편이** 훨씬 싸다.
 *
 * ★ **동시 요청을 합친다.** 매칭은 `Promise.all`로 200건이 한꺼번에 출발한다.
 * "없으면 읽는다"만으로는 200번이 그대로 나가므로, **읽는 중인 약속 자체를**
 * 공유한다.
 *
 * ★ **여기는 DB를 모른다.** 읽는 방법은 `fetch`로 받는다 — 그래야 DB 없이
 * 테스트할 수 있다 (`src/lib/__tests__/price-book-cache.test.ts`).
 */

export type PeriodPriceMap = ReadonlyMap<string, { price: number }>

export interface PeriodPriceCacheOptions {
  fetch: (period: string) => Promise<PeriodPriceMap>
  /** 기본 5분. 단가표를 새로 올렸을 수 있으니 영구 보관하지 않는다 */
  ttlMs?: number
  now?: () => number
}

export interface PeriodPriceCache {
  get(period: string): Promise<PeriodPriceMap>
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

export function createPeriodPriceCache(opts: PeriodPriceCacheOptions): PeriodPriceCache {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const now = opts.now ?? Date.now

  /** 읽는 중이거나 다 읽은 약속. 시각은 **읽기 시작한** 때 */
  const entries = new Map<string, { at: number; map: Promise<PeriodPriceMap> }>()

  return {
    get(period: string): Promise<PeriodPriceMap> {
      const hit = entries.get(period)
      if (hit && now() - hit.at < ttlMs) return hit.map

      const map = opts.fetch(period)
      entries.set(period, { at: now(), map })

      /*
        ⚠️ **실패는 기억하지 않는다.** 빈 맵으로 남겨 두면 그 뒤 모든 품목이 조용히
        낡은 단가를 쓴다 — 우리가 고치려는 버그 그 자체다. 다만 이미 이 약속을
        받아 간 동시 요청들에게는 **실패가 그대로 전달돼야** 한다. 그래서 지우기만
        하고 삼키지 않는다.
      */
      map.catch(() => {
        if (entries.get(period)?.map === map) entries.delete(period)
      })

      return map
    },
  }
}

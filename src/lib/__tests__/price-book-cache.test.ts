import { describe, it, expect, vi } from 'vitest'
import { createPeriodPriceCache } from '@/features/shared/price-book/cache'

/**
 * [비교] 기준월 단가표 캐시 (docs/systems/comparison.md §9)
 *
 * ★ **왜 캐시가 필요한가** — 매칭은 **품목 한 건씩** 돌고 각 건이 후보 단가를
 * 덮는다. 거래명세표 한 장이 품목 200개면 단가표 조회가 **200번** 나간다.
 * 그 달 단가표는 7,800행 남짓이라 **한 번 통째로 읽어 들고 있는 편이** 훨씬 싸다.
 *
 * ★ **동시 요청을 합쳐야 한다.** `Promise.all`로 200건이 한꺼번에 출발하므로,
 * "아직 안 읽었으면 읽는다"만으로는 200번이 그대로 나간다. 읽는 중인 약속을
 * 공유해야 실제로 1번이 된다.
 *
 * ⚠️ **실패는 캐시하지 않는다.** 조회가 한 번 실패했다고 그 달을 빈 것으로
 * 기억해 버리면, 그 뒤 모든 품목이 조용히 낡은 단가를 쓴다 — 고치려는 버그
 * 그 자체가 된다.
 */

const AUG = new Map([['902769', { price: 8140 }]])
const JUL = new Map([['902769', { price: 8000 }]])

describe('createPeriodPriceCache — 기준월 단가표를 한 번만 읽는다', () => {
  it('같은 달을 여러 번 물어도 한 번만 읽는다', async () => {
    const fetch = vi.fn(async () => AUG)
    const cache = createPeriodPriceCache({ fetch })

    expect(await cache.get('2026-08')).toBe(AUG)
    expect(await cache.get('2026-08')).toBe(AUG)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('동시에 200건이 물어도 한 번만 읽는다', async () => {
    // ⚠️ 이게 이 캐시의 존재 이유다 — 매칭은 Promise.all로 한꺼번에 출발한다
    const fetch = vi.fn(async () => AUG)
    const cache = createPeriodPriceCache({ fetch })

    const all = await Promise.all(Array.from({ length: 200 }, () => cache.get('2026-08')))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(all.every((m) => m === AUG)).toBe(true)
  })

  it('다른 달은 따로 읽는다', async () => {
    const fetch = vi.fn(async (period: string) => (period === '2026-08' ? AUG : JUL))
    const cache = createPeriodPriceCache({ fetch })

    expect((await cache.get('2026-08')).get('902769')?.price).toBe(8140)
    expect((await cache.get('2026-07')).get('902769')?.price).toBe(8000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('보관 시간이 지나면 다시 읽는다 — 단가표를 새로 올렸을 수 있다', async () => {
    let clock = 1_000
    const fetch = vi.fn(async () => AUG)
    const cache = createPeriodPriceCache({ fetch, ttlMs: 60_000, now: () => clock })

    await cache.get('2026-08')
    clock += 59_000
    await cache.get('2026-08')
    expect(fetch).toHaveBeenCalledTimes(1)

    clock += 2_000
    await cache.get('2026-08')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('실패는 기억하지 않는다 — 다음 요청에서 다시 읽는다', async () => {
    // ⚠️ 빈 맵으로 기억하면 그 뒤 전부 낡은 단가를 조용히 쓴다
    let attempt = 0
    const fetch = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('조회 실패')
      return AUG
    })
    const cache = createPeriodPriceCache({ fetch })

    await expect(cache.get('2026-08')).rejects.toThrow('조회 실패')
    expect(await cache.get('2026-08')).toBe(AUG)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('실패가 동시 요청 전부에 전달된다 — 일부만 조용히 통과하면 안 된다', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('조회 실패')
    })
    const cache = createPeriodPriceCache({ fetch })

    const results = await Promise.allSettled([cache.get('2026-08'), cache.get('2026-08')])
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

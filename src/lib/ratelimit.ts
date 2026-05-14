/**
 * API Rate limiting (2026-05-12)
 *
 * Hybrid 전략:
 * - UPSTASH_REDIS_REST_URL이 있으면 Upstash Redis (distributed, production-grade)
 * - 없으면 in-memory Map (Edge instance 단위, fallback)
 *
 * Upstash 추가 방법:
 *   Vercel Dashboard → Integrations → Upstash for Redis 설치
 *   자동으로 UPSTASH_REDIS_REST_URL/TOKEN 환경변수 추가됨
 *
 * Endpoint별 limit:
 * - /api/analyze/*: 분당 10회 (Gemini OCR 비용 큼)
 * - /api/products/search: 분당 60회
 * - 기본: 분당 120회
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export type RateLimitTier = 'analyze' | 'search' | 'default'

interface LimitConfig {
  requests: number
  windowMs: number
}

const LIMITS: Record<RateLimitTier, LimitConfig> = {
  analyze: { requests: 10, windowMs: 60_000 }, // 분당 10회 (LLM 호출)
  search: { requests: 60, windowMs: 60_000 }, // 분당 60회 (RPC)
  default: { requests: 120, windowMs: 60_000 }, // 분당 120회 (일반)
}

// Upstash가 있으면 distributed, 없으면 in-memory fallback
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN
const useUpstash = Boolean(upstashUrl && upstashToken)

let upstashRatelimits: Record<RateLimitTier, Ratelimit> | null = null

if (useUpstash) {
  const redis = new Redis({ url: upstashUrl!, token: upstashToken! })
  upstashRatelimits = {
    analyze: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMITS.analyze.requests, '60 s'),
      prefix: 'rl:analyze',
      analytics: true,
    }),
    search: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMITS.search.requests, '60 s'),
      prefix: 'rl:search',
      analytics: true,
    }),
    default: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(LIMITS.default.requests, '60 s'),
      prefix: 'rl:default',
      analytics: true,
    }),
  }
}

// In-memory fallback (Edge instance 단위로 분리됨 — 정확하지 않지만 layer)
// Map: key → { count, resetAt }
const memoryStore = new Map<string, { count: number; resetAt: number }>()

function memoryRatelimit(
  key: string,
  config: LimitConfig,
): { success: boolean; limit: number; remaining: number; reset: number } {
  const now = Date.now()
  const entry = memoryStore.get(key)

  if (!entry || entry.resetAt < now) {
    const resetAt = now + config.windowMs
    memoryStore.set(key, { count: 1, resetAt })
    // 메모리 누수 방지: 1000개 넘으면 만료된 entry 제거
    if (memoryStore.size > 1000) {
      for (const [k, v] of memoryStore.entries()) {
        if (v.resetAt < now) memoryStore.delete(k)
      }
    }
    return { success: true, limit: config.requests, remaining: config.requests - 1, reset: resetAt }
  }

  entry.count += 1
  const remaining = Math.max(0, config.requests - entry.count)
  return {
    success: entry.count <= config.requests,
    limit: config.requests,
    remaining,
    reset: entry.resetAt,
  }
}

/**
 * Rate limit 검사.
 *
 * @param identifier - 보통 IP 주소
 * @param tier - 'analyze' | 'search' | 'default'
 * @returns success=false일 때 429 응답 권장
 */
export async function checkRateLimit(
  identifier: string,
  tier: RateLimitTier = 'default',
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  if (upstashRatelimits) {
    const result = await upstashRatelimits[tier].limit(identifier)
    return {
      success: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    }
  }
  // Fallback
  const key = `${tier}:${identifier}`
  return memoryRatelimit(key, LIMITS[tier])
}

/**
 * 경로에 따른 tier 결정
 */
export function tierForPath(pathname: string): RateLimitTier {
  if (pathname.startsWith('/api/analyze/')) return 'analyze'
  if (pathname.startsWith('/api/products/search')) return 'search'
  return 'default'
}

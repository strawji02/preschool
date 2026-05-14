/**
 * API error response helper (2026-05-12)
 *
 * production에서는 Supabase/Postgres error.message가 schema 정보를 노출하므로
 * sanitized 메시지만 반환. 상세는 서버 log에만.
 *
 * 사용:
 *   try { ... } catch (e) { return apiError(e, 500, 'session fetch') }
 */
import { NextResponse } from 'next/server'

const IS_PROD = process.env.NODE_ENV === 'production'

type ErrorLike = { message?: string; code?: string; details?: string; hint?: string } | unknown

/**
 * 에러를 표준 JSON 응답으로 변환.
 * production: 일반화된 메시지만 반환, server log에는 전체 기록
 * dev: 전체 메시지 반환
 */
export function apiError(error: ErrorLike, status: number = 500, context?: string): NextResponse {
  const ctx = context ?? 'api'
  const e = error as { message?: string; code?: string; details?: string; hint?: string }

  // 서버 로그 (Vercel function log) — 항상 상세 기록
  console.error(`[${ctx}]`, {
    message: e?.message,
    code: e?.code,
    details: e?.details,
    hint: e?.hint,
  })

  // 클라이언트 응답 — production에서는 sanitized
  const clientMessage = IS_PROD
    ? sanitizeMessage(status, ctx)
    : e?.message ?? 'Unknown error'

  return NextResponse.json({ success: false, error: clientMessage }, { status })
}

/** production 일반화 메시지 — schema/internal 정보 노출 차단 */
function sanitizeMessage(status: number, context: string): string {
  if (status === 400) return 'Invalid request'
  if (status === 401) return 'Unauthorized'
  if (status === 403) return 'Forbidden'
  if (status === 404) return 'Not found'
  if (status === 409) return 'Conflict'
  if (status === 429) return 'Too many requests'
  if (status >= 500) return `Internal error (${context})`
  return 'Request failed'
}

/**
 * PostgREST .or() filter에 사용자 입력을 보간할 때 sanitize.
 * 콤마/괄호/와일드카드/연산자 문자 제거 — operator injection 방지.
 *
 * 예: q="foo,supplier.eq.CJ" → "foosupplier.eq.CJ" (콤마 제거)
 *     q="*%pattern%" → "pattern"
 */
export function sanitizeOrFilterValue(s: string): string {
  return s.replace(/[,()*%\\]/g, '').trim()
}

/** UUID v4 형식 검증 — storage path traversal/ID guessing 차단 */
export function isValidUuid(s: string | undefined | null): s is string {
  if (!s) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

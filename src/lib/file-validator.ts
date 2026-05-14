/**
 * File upload validator (2026-05-12)
 *
 * 보안 audit H2 — /api/analyze/page에서 base64 image 크기/타입 검증 없음.
 * 큰 payload로 메모리 압박 + 잘못된 mime type 저장 차단.
 */

export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB (base64 decode 후 크기)
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_SIZE_BYTES * 1.4) // base64는 ~33% 큼

/** 이미지 magic byte signatures */
const MAGIC_BYTES = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF (WEBP는 8번째 byte부터 "WEBP")
  gif: [0x47, 0x49, 0x46, 0x38],
} as const

export type ImageType = 'jpeg' | 'png' | 'webp' | 'gif'

export interface ValidatedImage {
  ok: true
  buffer: Buffer
  type: ImageType
  size: number
}

export interface ValidationError {
  ok: false
  status: number
  error: string
}

/**
 * base64 image 검증:
 * 1. base64 문자열 길이 검사 (decode 전 빠른 reject)
 * 2. decode 후 buffer 크기 검사
 * 3. magic byte로 실제 이미지 타입 식별
 *
 * @param base64 - 헤더 없는 raw base64 (data:image/... 헤더 있으면 strip)
 */
export function validateImageBase64(base64: string): ValidatedImage | ValidationError {
  if (!base64 || typeof base64 !== 'string') {
    return { ok: false, status: 400, error: 'Missing image data' }
  }

  // data URL prefix 제거 — "data:image/jpeg;base64,..." → "..."
  const stripped = base64.startsWith('data:')
    ? base64.replace(/^data:image\/[a-z]+;base64,/, '')
    : base64

  // base64 문자열 길이 빠른 검사 (decode 비용 회피)
  if (stripped.length > MAX_IMAGE_BASE64_LENGTH) {
    return {
      ok: false,
      status: 413,
      error: `Image too large (base64 ${stripped.length} chars, max ${MAX_IMAGE_BASE64_LENGTH})`,
    }
  }

  // base64 문자 검증 (영문/숫자/+/= 만 허용)
  if (!/^[A-Za-z0-9+/=]+$/.test(stripped.slice(0, 100))) {
    return { ok: false, status: 400, error: 'Invalid base64 image data' }
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(stripped, 'base64')
  } catch {
    return { ok: false, status: 400, error: 'Failed to decode base64' }
  }

  if (buffer.length === 0) {
    return { ok: false, status: 400, error: 'Empty image data' }
  }

  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Image too large (${buffer.length} bytes, max ${MAX_IMAGE_SIZE_BYTES})`,
    }
  }

  // Magic byte 검사 (실제 이미지인지 확인)
  const type = detectImageType(buffer)
  if (!type) {
    return {
      ok: false,
      status: 400,
      error: 'Invalid image format (expected JPEG/PNG/WebP/GIF)',
    }
  }

  return { ok: true, buffer, type, size: buffer.length }
}

function detectImageType(buffer: Buffer): ImageType | null {
  if (buffer.length < 12) return null
  if (matchBytes(buffer, MAGIC_BYTES.jpeg)) return 'jpeg'
  if (matchBytes(buffer, MAGIC_BYTES.png)) return 'png'
  if (matchBytes(buffer, MAGIC_BYTES.gif)) return 'gif'
  // WEBP: RIFF....WEBP
  if (matchBytes(buffer, MAGIC_BYTES.webp) && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  return null
}

function matchBytes(buffer: Buffer, signature: readonly number[]): boolean {
  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) return false
  }
  return true
}

/** ImageType → mime type */
export function imageTypeToMime(type: ImageType): string {
  return `image/${type}`
}

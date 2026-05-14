import type { NextConfig } from "next";

// 빌드 시간 생성 (한국 시간)
const buildTime = new Date().toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// (2026-05-12) 보안 헤더 — Phase 6
// 모든 response에 적용되는 기본 보안 헤더
const SECURITY_HEADERS = [
  // 1년 HSTS — HTTPS 강제 (모든 subdomain + preload list)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // clickjacking 방지 — iframe 차단
  { key: 'X-Frame-Options', value: 'DENY' },
  // MIME sniffing 방지
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrer 정책 — cross-origin에는 origin만, same-origin은 full path
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // 카메라/마이크/지오로케이션 등 차단 (사용 안 함)
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // CSP — report-only로 시작 (회귀 모니터링 후 enforce로 전환)
  // 'unsafe-inline'/'unsafe-eval'은 Next.js 호환 위해 유지
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: *.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https: wss: *.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  // Cloud Run deployment - standalone output
  output: 'standalone',

  // 빌드 시간 환경 변수
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },

  // Experimental features
  experimental: {
    // Optimize server components
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  // 보안 헤더 — 모든 경로에 적용
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
};

export default nextConfig;

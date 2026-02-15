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
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run deployment - standalone output
  output: 'standalone',
  
  // Experimental features
  experimental: {
    // Optimize server components
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;

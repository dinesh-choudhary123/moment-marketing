import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    // Use unoptimized globally — removes ALL domain restrictions,
    // images load directly from source without Next.js image API overhead.
    // This is the most reliable setting for an app with many external CDN sources.
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
};

export default nextConfig;

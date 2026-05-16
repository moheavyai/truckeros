import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack + webpack conflict fix (this is what we needed)
  turbopack: {},

  // Optional but recommended settings for Next.js 16 + React 19 + Tailwind
  reactStrictMode: true,

  // If you need any custom webpack config later, you can add it here
  // webpack: (config) => {
  //   return config;
  // },
};

export default nextConfig;
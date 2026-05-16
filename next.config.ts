import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  webpack: (config) => {
    return config;
  },
  postcss: {
    plugins: {
      tailwindcss: require('tailwindcss'),
      autoprefixer: require('autoprefixer'),
    },
  },
};

export default nextConfig;

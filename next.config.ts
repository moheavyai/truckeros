import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      tailwindcss: require.resolve('tailwindcss'),
    };
    return config;
  },
  postcss: {
    plugins: {
      tailwindcss: require.resolve('tailwindcss'),
      autoprefixer: require.resolve('autoprefixer'),
    },
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile our workspace packages so Next can consume their raw TS sources.
  transpilePackages: ['@porch/core', '@porch/db', '@porch/types', '@porch/ui'],
  experimental: {
    // Silence the "outputFileTracingRoot" warning in a monorepo.
    outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  },
};

export default nextConfig;

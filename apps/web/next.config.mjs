/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile our workspace packages so Next can consume their raw TS sources.
  transpilePackages: ['@porch/core', '@porch/db', '@porch/types', '@porch/ui'],
  experimental: {
    // Silence the "outputFileTracingRoot" warning in a monorepo.
    outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  },
  // Workspace packages use TS-ESM style imports with `.js` extensions
  // that resolve to `.ts` sources (moduleResolution: "Bundler" in tsconfig).
  // Webpack doesn't do this mapping by default — teach it.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },
};

export default nextConfig;

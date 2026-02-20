const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

// Inject build-time version info (git SHA, timestamp)
const { execSync } = require('child_process');
const getGitSha = () => {
  try { return execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim(); }
  catch { return process.env.GIT_SHA || 'unknown'; }
};
const BUILD_GIT_SHA = getGitSha();
const BUILD_TIMESTAMP = new Date().toISOString();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  // Build-time version info — available in server-side code via process.env
  env: {
    GIT_SHA: BUILD_GIT_SHA,
    GIT_SHA_SHORT: BUILD_GIT_SHA.slice(0, 8),
    BUILD_TIMESTAMP,
  },

  // TypeScript and ESLint
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Performance optimizations
  compiler: {
    // Remove console logs in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },

  // Image optimization
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/**',
      },
    ],
  },

  // Disable static generation to prevent SSR issues
  experimental: {
    // Enable optimized package imports for tree-shaking
    optimizePackageImports: [
      '@tanstack/react-query',
      'react-icons',
      'lucide-react',
      'date-fns',
      'zod',
      'react-hot-toast',
      '@heroicons/react',
    ],
  },

  // Security and performance headers
  generateEtags: false,
  poweredByHeader: false,
  compress: true, // Enable gzip compression

  // Cache headers to prevent stale JavaScript errors during active development
  async headers() {
    return [
      {
        // HTML pages - always revalidate (prevents stale JS references)
        source: '/:path*',
        has: [
          {
            type: 'header',
            key: 'accept',
            value: '.*text/html.*',
          },
        ],
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, must-revalidate',
          },
        ],
      },
      {
        // Static assets with hashes - cache for 1 year (safe because filename changes)
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // API routes - never cache
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate',
          },
        ],
      },
    ];
  },

  // Redirects for backwards compatibility
  async redirects() {
    return [
      // dr-photo-unified → activate redirects
      {
        source: '/dr-photo-unified',
        destination: '/activate',
        permanent: true,
      },
      {
        source: '/dr-photo-unified/:path*',
        destination: '/activate/:path*',
        permanent: true,
      },
      {
        source: '/api/dr-photo-unified/:path*',
        destination: '/api/activate/:path*',
        permanent: true,
      },

      // Procurement menu restructure redirects (old list pages → new tab pages)
      // Sourcing
      {
        source: '/suppliers',
        destination: '/procurement/sourcing?tab=suppliers',
        permanent: true,
      },
      {
        source: '/procurement/boq',
        destination: '/procurement/sourcing?tab=boq',
        permanent: true,
      },
      {
        source: '/procurement/rfq',
        destination: '/procurement/sourcing?tab=rfq',
        permanent: true,
      },
      // Purchasing
      {
        source: '/procurement/quotes',
        destination: '/procurement/purchasing?tab=quotes',
        permanent: true,
      },
      {
        source: '/procurement/requisitions',
        destination: '/procurement/purchasing?tab=requisitions',
        permanent: true,
      },
      {
        source: '/procurement/purchase-orders',
        destination: '/procurement/purchasing?tab=purchase-orders',
        permanent: true,
      },
      {
        source: '/procurement/grn',
        destination: '/procurement/purchasing?tab=grn',
        permanent: true,
      },
      // Inventory
      {
        source: '/procurement/stock',
        destination: '/procurement/inventory?tab=stock',
        permanent: true,
      },
      {
        source: '/procurement/stock-items',
        destination: '/procurement/inventory?tab=items',
        permanent: true,
      },
      {
        source: '/procurement/stock-categories',
        destination: '/procurement/inventory?tab=categories',
        permanent: true,
      },
      {
        source: '/procurement/bundles',
        destination: '/procurement/inventory?tab=bundles',
        permanent: true,
      },
      {
        source: '/procurement/stock-takes',
        destination: '/procurement/inventory?tab=takes',
        permanent: true,
      },
      // field-stock has its own standalone page with 8 sub-tabs (PRD-027)
      // Financial
      {
        source: '/procurement/budget',
        destination: '/procurement/financial?tab=budget',
        permanent: true,
      },
      {
        source: '/procurement/cost-centers',
        destination: '/procurement/financial?tab=cost-centers',
        permanent: true,
      },
    ];
  },

  // DISABLED: Legacy neon/api/server.ts proxy - zero-auth CRUD server
  // The Neon API server has no authentication and should not be proxied.
  // SOW imports now use proper Next.js API routes with withAuth.
  // If you need this, add auth to neon/api/server.ts first.
  // async rewrites() {
  //   return [
  //     { source: '/poles', destination: 'http://localhost:3001/' },
  //     { source: '/poles/:path*', destination: 'http://localhost:3001/:path*' },
  //   ];
  // },

  // Fix file watching issues
  webpack: (config, { dev, isServer }) => {
    // Try to fix Watchpack issues with minimal configuration
    if (dev && !isServer) {
      config.watchOptions = {
        ignored: ['**/node_modules/**'],
        aggregateTimeout: 300,
        poll: 1000,
      };
    }

    // Let Next.js handle chunk splitting (its defaults are well-optimized)

    // Ensure proper handling of undefined paths
    if (config.resolve && config.resolve.alias) {
      // Remove any undefined aliases that might cause issues
      Object.keys(config.resolve.alias).forEach(key => {
        if (config.resolve.alias[key] === undefined) {
          delete config.resolve.alias[key];
        }
      });
    }

    return config;
  },

  // Disable static optimization to prevent router mounting issues
  trailingSlash: false,
};

module.exports = withBundleAnalyzer(nextConfig);
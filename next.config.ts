import type { NextConfig } from 'next';

const isVercelBuild = Boolean(process.env.VERCEL);

// EdgeOne Pages（Makers）与 Vercel 一样是无状态边缘平台：由平台托管
// Next.js 运行时，应用不产出 standalone 服务端包。上游只在 VERCEL 时
// 关闭 standalone；EdgeOne 部署若沿用 standalone，平台会拿到一份
// 无人启动的服务器产物，表现为路由 404 或静态资源缺失。
//
// 注意：`output` 是**构建期**产物形态的决定项，而 `next start` 会在**运行期**
// 重新求值本文件。EdgeOne / Vercel 控制台配置的环境变量在构建与运行两侧
// 都能读到，所以平台上一致。但本地自检时若"构建带了 EDGEONE=1、运行没带"，
// 运行期会判成 standalone，与产物形态不匹配，静态资源路由就会异常
// （表现为路由 404 或静态资源缺失）。
// 因此本地必须**构建与运行都带 EDGEONE=1**，见 deploy/README.md §8。
//
// 这是**另一条**独立的坑，别与上面那条混为一谈：重建产物后若没有重启服务
// 进程，旧进程会按旧 BUILD_ID 返回 HTML，引用已被新构建删除的 chunk，
// 于是 React 不水合、整站按钮静默失效（页面文字却完全正常）。
// 排查步骤见 deploy/README.md §8.0 与 scripts/check-physics-e2e.mjs 的
// 「BUILD_ID 与目标产物一致」检查项。
const isEdgeOneBuild = Boolean(process.env.EDGEONE);

const nextConfig: NextConfig = {
  env: {
    // Pin even the unset/default value in both client and server bundles.
    // A runtime-only override must not disable the route the built client uses.
    NEXT_PUBLIC_PI_CHAT_ENABLED: process.env.NEXT_PUBLIC_PI_CHAT_ENABLED ?? '',
  },
  // Vercel / EdgeOne 不产出 standalone 产物；其余场景保留上游的 standalone
  // 产物，供自托管 Docker（node .next/standalone/server.js）使用。
  output: isVercelBuild || isEdgeOneBuild ? undefined : 'standalone',
  outputFileTracingIncludes: {
    '/*': [
      'lib/server/agent-runtime/import-pptx-worker.mjs',
      'skills/openmaic/**',
      'skills/agent-runtime/**',
      // Loaded through a runtime-only `import('undici')` (see the LLM
      // dispatcher in lib/ai/providers.ts and the Google proxy transport), so
      // the output tracer never sees it and standalone builds ship without it.
      'node_modules/undici/**',
      // sharp's native libvips libraries are loaded via dlopen and are not
      // statically analyzable, so Next.js standalone tracing omits them. Two
      // sharp versions resolve in the tree (0.34.5 transitive -> libvips
      // 1.2.4, 0.35.4 direct -> libvips 1.3.3); tracing picked the wrong one
      // and the runtime dlopen of sharp 0.35.4 failed with
      // "libvips-cpp.so.8.18.6: No such file or directory" on self-hosted
      // Docker (Alpine/musl) deployments. Force-include every sharp-libvips
      // native lib dir for standalone builds. Vercel packages its runtime
      // dependencies itself; including every native variant there bloats each
      // traced function and can push Hobby deployments past 12 bundles.
      ...(!isVercelBuild
        ? ['node_modules/.pnpm/@img+sharp-libvips-*/node_modules/@img/sharp-libvips-*/lib/**']
        : []),
    ],
  },
  typescript: {
    tsconfigPath: process.env.NODE_ENV === 'production' ? 'tsconfig.build.json' : 'tsconfig.json',
  },
  transpilePackages: ['mathml2omml', 'pptxgenjs', '@openmaic/importer'],
  // These agent packages do a runtime `import(specifier)` with a computed
  // specifier (to lazily load node:fs/os/path without breaking browser/Vite
  // builds). webpack can't statically analyze that and bundling it throws
  // "Cannot find module as expression is too dynamic" at runtime on the server
  // (the "Edit with AI" Pro-mode path), which broke the #619 keep-alive e2e.
  // Mark them server-external so Next loads them natively and the dynamic
  // import resolves as a real Node call.
  serverExternalPackages: [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@openmaic/generation',
    // Optional peers of @openmaic/storage, reached through deliberately
    // untraced dynamic imports. Externalizing keeps them out of the bundle,
    // and the static anchor in lib/persistence/asset-byte-store.ts gets them
    // traced into the standalone image -- without it, S3 mode and redirect
    // egress cannot resolve their SDK in the shipped deployment.
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async headers() {
    const extraAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim();
    const frameAncestors = extraAncestors ? `'self' ${extraAncestors}` : "'self'";

    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;

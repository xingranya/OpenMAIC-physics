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
      // EdgeOne Pages 的云函数包有 **128MiB 硬上限**（超限直接部署失败）。六个
      // 平台的 libvips 变体合计约 210MiB（darwin/linux/linuxmusl × arm64/x64
      // × 两个 sharp 版本），仅此一项就把函数包顶到 420MiB。EdgeOne 的函数
      // 运行时固定是 linux-x64，其余变体在 EdgeOne 上永远不会被 dlopen，
      // 所以这里只带 linux-x64 的两份（libvips 1.2.4 + 1.3.3，约 34MiB）。
      ...(isEdgeOneBuild
        ? [
            'node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/lib/**',
          ]
        : !isVercelBuild
          ? ['node_modules/.pnpm/@img+sharp-libvips-*/node_modules/@img/sharp-libvips-*/lib/**']
          : []),
    ],
  },
  // `outputFileTracingIncludes` 只能「加」文件，sharp 的其余平台变体是 Next
  // 顺着 sharp 的 optionalDependencies 自动追踪进来的，必须用 excludes 剔除。
  // EdgeOne 的函数运行时是 linux-x64，其余 5 个变体（darwin ×2、linux-arm64、
  // linuxmusl ×2）在这里永远不会被 dlopen，带上纯属把函数包顶出 128MiB 上限。
  outputFileTracingExcludes: {
    '/*': isEdgeOneBuild
      ? [
          'node_modules/.pnpm/@img+sharp-libvips-darwin-*/**',
          'node_modules/.pnpm/@img+sharp-libvips-linux-arm64/**',
          'node_modules/.pnpm/@img+sharp-libvips-linuxmusl-*/**',
          'node_modules/.pnpm/@img+sharp-darwin-*/**',
          'node_modules/.pnpm/@img+sharp-linux-arm64/**',
          'node_modules/.pnpm/@img+sharp-linuxmusl-*/**',
        ]
      : [],
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

    /**
     * 安全响应头的取舍（为什么是这几条、为什么**没有** script-src）。
     *
     * 全站有 11 处 `dangerouslySetInnerHTML`（场景内容、PBL 面板），安全性
     * 完全押在 `lib/server/sanitize-scene-content.ts` 那层白名单上。白名单
     * 只要漏一个标签（`sanitize-html` 历史上出过 mXSS 类问题），就没有第二道
     * 防线。所以这里补上**不依赖 nonce**、加了也不会改变页面行为的那几条。
     *
     * `script-src` 的强制版**这里做不了**：Next 的引导脚本是内联的，要靠
     * middleware 给每次请求生成 nonce 再拼进 CSP；而 EdgeOne Pages **不部署
     * Next 中间件**（见 middleware.ts 顶部说明），线上没有生成 nonce 的地方。
     * 硬上 `script-src 'self'` 会让整站脚本被拦、页面白屏。
     *
     * 所以真正的脚本来源限制走 `Content-Security-Policy-Report-Only`：
     * 它**只报告不拦截**，用来在控制台里量出「到底有多少内联脚本会被挡」。
     * 等 nonce 通道落地（或平台支持 middleware）再把同一份策略转成强制版。
     * 这条不能含糊成「已上 CSP」——现在拦住脚本注入的仍然只有白名单。
     */
    const enforcingCsp = [
      `frame-ancestors ${frameAncestors}`,
      // 站内没有任何 <object>/<embed>；禁掉可以顺手掐死一类老式注入。
      "object-src 'none'",
      // 防 <base href> 劫持：所有相对 URL 都锚在文档自身上。
      "base-uri 'self'",
      // 防「注入一个 form 把数据 POST 到外部」。
      "form-action 'self'",
    ].join('; ');

    /**
     * 目标策略（只报告）。刻意写得比现状严格——它存在的意义就是**暴露差距**，
     * 写得和现状一样宽就什么也测不出来。
     */
    const reportOnlyCsp = [
      "default-src 'self'",
      "script-src 'self'",
      // Tailwind 与若干组件用内联 style 属性，这条短期内无法去掉。
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "font-src 'self' data:",
      // 模型/搜索调用全部经由本站 API 转发，不需要放开第三方 connect 目标。
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          { key: 'Content-Security-Policy', value: enforcingCsp },
          { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp },
          // 别让浏览器猜 MIME：`/api/classroom-media` 按 Range 吐文件，
          // 猜错类型会让「下载下来变成 html」这类问题成立。
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 站点只有 HTTPS 入口。一年 + includeSubDomains，不加 preload
          // （preload 是提交给浏览器厂商的不可逆清单，不该由配置文件替人决定）。
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // 跨站时不泄露路径与查询串（课堂 id 在路径里）。
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 只有麦克风是真的要用（语音输入 / 音色克隆）。相机、定位、支付、
          // USB 全关——关掉的能力即使被注入脚本也调不起来。
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

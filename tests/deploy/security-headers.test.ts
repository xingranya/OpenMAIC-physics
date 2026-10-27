/**
 * 安全响应头。
 *
 * ## 为什么要为「几个常量」写测试
 *
 * `next.config.ts` 的 `headers()` 是一段**没有类型约束**的字符串拼装：
 * 少一个分号、把 `frame-ancestors` 拼进 `default-src`、或者某次重构把
 * 整个数组删掉，构建照样成功、页面照样能开，**线上只是少了防护**。
 * 这类退化没有任何症状，只能靠断言盯着。
 *
 * ## 断言的是「有」与「没有」
 *
 * 每条头都从两个方向验：该有的指令在，且**不该松的地方没被放松**。
 * 例如 `script-src` 里一旦出现 `'unsafe-inline'`，报告用的那份策略就
 * 失去意义了——它本来是拿来量「有多少内联脚本会被挡」的。
 */
import { describe, expect, it } from 'vitest';

import nextConfig from '@/next.config';

/** 取 `headers()` 里那条通配规则的头，转成小写键的表。 */
async function headerMap(): Promise<Record<string, string>> {
  const rules = await nextConfig.headers!();
  const rule = rules.find((item) => item.source === '/(.*)');
  expect(rule, '缺少通配响应头规则').toBeDefined();
  return Object.fromEntries(rule!.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

describe('安全响应头', () => {
  it('五条基础头都在', async () => {
    const headers = await headerMap();
    for (const name of [
      'x-content-type-options',
      'strict-transport-security',
      'referrer-policy',
      'permissions-policy',
      'content-security-policy',
    ]) {
      expect(headers[name], `缺少 ${name}`).toBeTruthy();
    }
  });

  it('nosniff 就是 nosniff（不能写成 none）', async () => {
    expect((await headerMap())['x-content-type-options']).toBe('nosniff');
  });

  it('HSTS 至少一年，且带 includeSubDomains', async () => {
    const value = (await headerMap())['strict-transport-security']!;
    const maxAge = Number(/max-age=(\d+)/.exec(value)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);
    expect(value).toContain('includeSubDomains');
    // preload 是提交给浏览器厂商的不可逆清单，不该由配置文件替人决定。
    expect(value).not.toContain('preload');
  });

  it('Referrer-Policy 不泄露路径（课堂 id 在路径里）', async () => {
    expect((await headerMap())['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('Permissions-Policy 只放开麦克风，其余全关', async () => {
    const value = (await headerMap())['permissions-policy']!;
    // 语音输入与音色克隆要用麦克风，这是唯一真的需要的能力。
    expect(value).toContain('microphone=(self)');
    for (const feature of ['camera', 'geolocation', 'payment', 'usb']) {
      expect(value, `${feature} 应被关闭`).toContain(`${feature}=()`);
    }
  });

  it('强制 CSP 保留 frame-ancestors，且补上 object-src / base-uri / form-action', async () => {
    const value = (await headerMap())['content-security-policy']!;
    expect(value).toContain("frame-ancestors 'self'");
    expect(value).toContain("object-src 'none'");
    expect(value).toContain("base-uri 'self'");
    expect(value).toContain("form-action 'self'");
  });

  it('强制 CSP 里**没有** script-src（有就说明有人硬上，会把整站脚本拦掉）', async () => {
    // EdgeOne 不部署 Next 中间件，没有生成 nonce 的地方；强制 script-src
    // 必然拦掉 Next 的内联引导脚本 → 白屏。这条断言是那个结论的看门人。
    const value = (await headerMap())['content-security-policy']!;
    expect(value).not.toContain('script-src');
    expect(value).not.toContain('default-src');
  });

  it('报告用的 CSP 存在，且 script-src 是严格的（留着量差距）', async () => {
    const value = (await headerMap())['content-security-policy-report-only']!;
    expect(value).toBeTruthy();
    expect(value).toContain("script-src 'self'");
    // 一旦被「修」成允许内联，这份策略就再也测不出东西了。
    expect(value).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(value).toContain("object-src 'none'");
    expect(value).toContain("base-uri 'self'");
  });

  it('X-Frame-Options 与 frame-ancestors 同时存在（老浏览器只认前者）', async () => {
    const headers = await headerMap();
    if (process.env.ALLOWED_FRAME_ANCESTORS?.trim()) {
      // 配了自定义祖先时 X-Frame-Options 无法表达 allow-list，只能省略。
      expect(headers['x-frame-options']).toBeUndefined();
      return;
    }
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});

/**
 * 生成类接口的入参体量上限。
 *
 * ## 这里防的是什么
 *
 * `/api/generate-classroom` 收 `pdfContent: { text, images: string[] }`，
 * `images` 是一串 base64。`req.json()` 会把整个 body 读进内存再解析——
 * 也就是说**在拿到任何字段之前**内存已经花出去了。构造一个几百 MB 的
 * JSON 就能把云函数的内存打爆，而且请求本身完全「合法」。
 *
 * ## 三层，缺一层就有缝
 *
 * 1. 中间件查 `content-length`——便宜，但客户端可以不发、可以撒谎；
 * 2. `readJsonBody` 在**流上**数真实字节——撒谎与 chunked 都挡得住；
 * 3. 字段级上限——总字节合规不代表单个字段合理（一张 20 MiB 的图
 *    解码后还要再复制，峰值是 3 倍）。
 *
 * 三层的测试分别打在不同的地方，不要合并成一条。
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  buildRequestOrigin: vi.fn(),
  createClassroomGenerationJob: vi.fn(),
  runClassroomGenerationJob: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: mocks.after };
});

vi.mock('@/lib/server/classroom-job-store', () => ({
  createClassroomGenerationJob: mocks.createClassroomGenerationJob,
}));

vi.mock('@/lib/server/classroom-job-runner', () => ({
  runClassroomGenerationJob: mocks.runClassroomGenerationJob,
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: mocks.buildRequestOrigin,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  GENERATION_INPUT_LIMITS,
  checkClassroomInput,
  readJsonBody,
} from '@/lib/server/generation-input-limits';

/** 造一个只有 `headers` 与 `body` 的 Request 替身，专打「流上数字节」那条路径。 */
function streamingRequest(chunks: string[], headers: Record<string, string> = {}): Request {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]!));
      index += 1;
    },
  });
  return { headers: new Headers(headers), body } as unknown as Request;
}

describe('readJsonBody · 流上数字节', () => {
  it('没有 content-length 也拦得住（chunked 场景）', async () => {
    // 刻意不设 content-length：这正是「声明长度」那层拦不住的情形。
    const chunk = 'x'.repeat(400);
    const result = await readJsonBody(streamingRequest(Array(20).fill(chunk)), 1_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('content-length 撒谎也不影响——按真实字节算', async () => {
    // 声明 10 字节，实际给了 8000 字节。
    const result = await readJsonBody(
      streamingRequest(['{"a":"', 'y'.repeat(8_000), '"}'], { 'content-length': '10' }),
      1_000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it('声明的长度已经超限 → 不读 body 直接 413', async () => {
    const result = await readJsonBody(
      streamingRequest(['{"a":1}'], {
        'content-length': String(GENERATION_INPUT_LIMITS.jsonBodyBytes + 1),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      const body = (await result.response.json()) as { errorCode?: string };
      expect(body.errorCode).toBe('PAYLOAD_TOO_LARGE');
    }
  });

  it('刚好到上限仍然放行（别把上限做成「少一字节就拦」）', async () => {
    const payload = '{"a":1}';
    const result = await readJsonBody(streamingRequest([payload]), payload.length);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toEqual({ a: 1 });
  });

  it('非法 JSON → 400，而不是 500', async () => {
    // 加上限之前这里是 `await req.json()` 抛异常 → 被 catch 归成 500，
    // 「客户端发了坏 JSON」表现成「服务器内部错误」，排查时极误导。
    const result = await readJsonBody(streamingRequest(['{not json']));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = (await result.response.json()) as { errorCode?: string };
      expect(body.errorCode).toBe('INVALID_REQUEST');
    }
  });

  it('空 body → 400', async () => {
    const result = await readJsonBody(streamingRequest([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it('JSON 数组/标量 → 400（这些路由的契约是对象）', async () => {
    for (const payload of ['[]', '"text"', '42', 'null']) {
      const result = await readJsonBody(streamingRequest([payload]));
      expect(result.ok, payload).toBe(false);
      if (!result.ok) expect(result.response.status, payload).toBe(400);
    }
  });
});

describe('checkClassroomInput · 字段级上限', () => {
  const limits = GENERATION_INPUT_LIMITS;

  it('正常入参不拦（这是回归项：别把上限加得过紧）', () => {
    expect(
      checkClassroomInput({
        requirement: '高中物理 · 电磁感应，4 个场景',
        pdfContent: { text: '教材正文', images: ['AAAA', 'BBBB'] },
      }),
    ).toBeNull();
  });

  it('requirement 超长 → 违规', () => {
    const violation = checkClassroomInput({
      requirement: 'a'.repeat(limits.classroomRequirementChars + 1),
    });
    expect(violation?.field).toBe('requirement');
  });

  it('requirement 刚好等于上限 → 放行', () => {
    expect(checkClassroomInput({ requirement: 'a'.repeat(limits.classroomRequirementChars) })).toBeNull();
  });

  it('pdfContent.text 超长 → 违规', () => {
    const violation = checkClassroomInput({
      pdfContent: { text: 'a'.repeat(limits.classroomPdfTextChars + 1), images: [] },
    });
    expect(violation?.field).toBe('pdfContent.text');
  });

  it('图片张数超限 → 违规', () => {
    const images = Array.from({ length: limits.classroomPdfImageCount + 1 }, () => 'AAAA');
    const violation = checkClassroomInput({ pdfContent: { text: '', images } });
    expect(violation?.field).toBe('pdfContent.images');
  });

  it('单张图片过大 → 违规', () => {
    const violation = checkClassroomInput({
      pdfContent: { text: '', images: ['a'.repeat(limits.classroomPdfImageBase64Chars + 1)] },
    });
    expect(violation?.field).toBe('pdfContent.images[]');
  });

  it('单张都不超但合计超了 → 违规（防止用多张小图绕过）', () => {
    // 每张 5 MiB、单张上限 6 MiB，合计上限 24 MiB → 5 张就该撞线。
    const perImage = 5 * 1024 * 1024;
    const images = Array.from({ length: 5 }, () => 'a'.repeat(perImage));
    const violation = checkClassroomInput({ pdfContent: { text: '', images } });
    expect(violation?.field).toBe('pdfContent.images');
    expect(violation?.message).toContain('总大小');
  });

  it('没有 pdfContent 时不炸（PDF 是可选的）', () => {
    expect(checkClassroomInput({ requirement: '随便' })).toBeNull();
  });
});

describe('POST /api/generate-classroom · 上限接线', () => {
  async function post(body: unknown, headers: Record<string, string> = {}) {
    vi.resetModules();
    // 每次重建替身：否则「job 没被创建」这条断言会被上一条用例的调用记录污染，
    // 表现成「明明 413 了却还创建了 job」——一个假的真红。
    mocks.createClassroomGenerationJob.mockReset();
    mocks.buildRequestOrigin.mockReset();
    mocks.buildRequestOrigin.mockReturnValue('http://localhost');
    mocks.createClassroomGenerationJob.mockResolvedValue({
      status: 'queued',
      step: 'queued',
      message: 'Classroom generation job queued',
    });
    const { POST } = await import('@/app/api/generate-classroom/route');
    const request = new NextRequest('http://localhost/api/generate-classroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return POST(request);
  }

  it('正常请求仍然 202（上限没有误伤）', async () => {
    const response = await post({ requirement: '高中物理 · 电磁感应' });
    expect(response.status).toBe(202);
  });

  it('requirement 超长 → 413 且指明字段', async () => {
    const response = await post({
      requirement: 'a'.repeat(GENERATION_INPUT_LIMITS.classroomRequirementChars + 1),
    });
    expect(response.status).toBe(413);
    const body = (await response.json()) as { errorCode?: string; details?: string };
    expect(body.errorCode).toBe('PAYLOAD_TOO_LARGE');
    expect(body.details).toContain('requirement');
  });

  it('图片过多 → 413（不进生成流水线）', async () => {
    const images = Array.from({ length: GENERATION_INPUT_LIMITS.classroomPdfImageCount + 1 }, () => 'AA');
    const response = await post({ requirement: '物理', pdfContent: { text: '', images } });
    expect(response.status).toBe(413);
    // 最关键的一条：job 根本没被创建，等于没有花钱。
    expect(mocks.createClassroomGenerationJob).not.toHaveBeenCalled();
  });

  it('非法 JSON → 400（不是 500）', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/generate-classroom/route');
    const request = new NextRequest('http://localhost/api/generate-classroom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

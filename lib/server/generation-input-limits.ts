/**
 * 生成类接口的**入参体量上限**：按字节截断读取 + 按字段设上限。
 *
 * ## 为什么中间件里的 `content-length` 检查不够
 *
 * `middleware.ts` 已经会对生成类前缀查 `content-length`，但那是**客户端自己声明的值**：
 *
 * - 可以不发（`Transfer-Encoding: chunked` 时压根没有这个头）；
 * - 可以撒谎（声明 100 字节，实际传 500 MB）；
 * - 中间件在某些部署形态下根本不参与（EdgeOne Pages 不部署 Next 中间件）。
 *
 * 真正拦得住的是**读的时候数**。`req.json()` 会把整个 body 一次性读进内存再解析，
 * 等它返回时内存已经花出去了——所以上限必须加在**流上**，超了立刻 `cancel`。
 *
 * ## 为什么在总字节之外还要按字段设上限
 *
 * 总量 32 MiB 不代表单个字段合理。`/api/generate-classroom` 收的是
 * `pdfContent: { text, images: string[] }`：
 *
 * - 一张 32 MiB 的 base64 图片，解码后还要再复制一份 `Buffer`，峰值是 3 倍；
 * - `images` 塞十万个空字符串，字节数很小，但逐个跑视觉模型的分发逻辑会先被拖死；
 * - `requirement` 直接进提示词，长度无上限等于把 token 预算交给调用方。
 *
 * 所以这里按「维度」而不是只按「总量」设限。
 *
 * ## 用法
 *
 * 不抛异常，返回判别式结果——生成路由的 `catch` 块普遍把未知错误归成 500，
 * 抛异常会让「请求体过大」表现成「服务器内部错误」，排查时非常误导。
 */

import { NextResponse } from 'next/server';

import { apiError } from '@/lib/server/api-response';
import { RATE_LIMIT_POLICY } from '@/lib/server/rate-limit';

/**
 * 各项上限。
 *
 * 数值取「够用且明显异常就拦」的量级，不是精确计费：
 * 一次真实的 4 场景生成，`requirement` 通常几十到几百字，
 * PDF 文本十万字符已是一本教材的量级。
 *
 * 注意与 `lib/constants/generation.ts` 里的 `MAX_PDF_CONTENT_CHARS`（5 万字符）
 * 和 `MAX_VISION_IMAGES`（20 张）**不是一回事**，也不冲突：
 * 那两个是**进提示词前的截断**（超了正常截断，不影响请求成功），
 * 这里是**传输层的拒绝**（超了直接 413）。运输上限刻意比提示词上限松，
 * 这样「文档有点长」是静默截断，而「body 有 300 MB」才是报错。
 */
export const GENERATION_INPUT_LIMITS = {
  /** 与中间件同源，避免两处各写一个数字后漂移。 */
  jsonBodyBytes: RATE_LIMIT_POLICY.maxBodyBytes,
  /** 课堂需求描述（进提示词）。 */
  classroomRequirementChars: 4_000,
  /** PDF 抽取出的正文。 */
  classroomPdfTextChars: 500_000,
  /** PDF 图片张数。 */
  classroomPdfImageCount: 60,
  /** 单张图片的 base64 长度。 */
  classroomPdfImageBase64Chars: 6 * 1024 * 1024,
  /** 全部图片的 base64 长度合计。 */
  classroomPdfImagesTotalBase64Chars: 24 * 1024 * 1024,
} as const;

/** 读 body 的结果。失败时直接带着可以 `return` 的响应。 */
export type JsonReadResult<T> = { ok: true; body: T } | { ok: false; response: NextResponse };

/** 把字节数说成人话（MB），用于错误文案。 */
function toMiB(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MiB`;
}

/**
 * 在**流上**限量读取请求体并解析成 JSON。
 *
 * 顺序是刻意的：先看声明的 `content-length`（最便宜，能挡掉绝大多数误传），
 * 再在读取过程中累加真实字节（挡掉撒谎与 chunked）。
 */
export async function readJsonBody<T>(
  request: Request,
  maxBytes: number = GENERATION_INPUT_LIMITS.jsonBodyBytes,
): Promise<JsonReadResult<T>> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: tooLargeResponse(maxBytes) };
  }

  const body = request.body;
  if (!body) {
    return {
      ok: false,
      response: apiError('INVALID_REQUEST', 400, 'Request body must be a JSON object'),
    };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // 立刻断开，不再把剩下的字节读进内存——这正是这个函数存在的理由。
        await reader.cancel().catch(() => {});
        return { ok: false, response: tooLargeResponse(maxBytes) };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      response: apiError('INVALID_REQUEST', 400, 'Failed to read request body'),
    };
  } finally {
    reader.releaseLock?.();
  }

  if (total === 0) {
    return {
      ok: false,
      response: apiError('INVALID_REQUEST', 400, 'Request body must be a JSON object'),
    };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    return { ok: false, response: apiError('INVALID_REQUEST', 400, 'Request body is not valid JSON') };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      response: apiError('INVALID_REQUEST', 400, 'Request body must be a JSON object'),
    };
  }

  return { ok: true, body: parsed as T };
}

function tooLargeResponse(maxBytes: number): NextResponse {
  return apiError(
    'PAYLOAD_TOO_LARGE',
    413,
    `请求体过大（上限 ${toMiB(maxBytes)}）`,
    'Reduce the payload size, or upload the source document through /api/materials instead.',
  );
}

/** 单字段超限的结果。 */
export interface FieldViolation {
  field: string;
  message: string;
}

/**
 * 课堂生成入参的字段级校验。
 *
 * 只做**上限**，不做必填与类型——那些是路由自己的职责，这里混进来会让
 * 「缺字段」和「超限」两种错误互相盖住。
 */
export function checkClassroomInput(body: {
  requirement?: unknown;
  pdfContent?: { text?: unknown; images?: unknown };
}): FieldViolation | null {
  const { requirement, pdfContent } = body;

  if (typeof requirement === 'string' && requirement.length > GENERATION_INPUT_LIMITS.classroomRequirementChars) {
    return {
      field: 'requirement',
      message: `requirement 过长（${requirement.length} 字，上限 ${GENERATION_INPUT_LIMITS.classroomRequirementChars} 字）`,
    };
  }

  if (!pdfContent) return null;

  if (
    typeof pdfContent.text === 'string' &&
    pdfContent.text.length > GENERATION_INPUT_LIMITS.classroomPdfTextChars
  ) {
    return {
      field: 'pdfContent.text',
      message: `pdfContent.text 过长（${pdfContent.text.length} 字符，上限 ${GENERATION_INPUT_LIMITS.classroomPdfTextChars}）`,
    };
  }

  const images = pdfContent.images;
  if (!Array.isArray(images)) return null;

  if (images.length > GENERATION_INPUT_LIMITS.classroomPdfImageCount) {
    return {
      field: 'pdfContent.images',
      message: `pdfContent.images 过多（${images.length} 张，上限 ${GENERATION_INPUT_LIMITS.classroomPdfImageCount} 张）`,
    };
  }

  let totalChars = 0;
  for (const image of images) {
    if (typeof image !== 'string') continue;
    if (image.length > GENERATION_INPUT_LIMITS.classroomPdfImageBase64Chars) {
      return {
        field: 'pdfContent.images[]',
        message: `单张图片过大（${image.length} 字符，上限 ${GENERATION_INPUT_LIMITS.classroomPdfImageBase64Chars}）`,
      };
    }
    totalChars += image.length;
    if (totalChars > GENERATION_INPUT_LIMITS.classroomPdfImagesTotalBase64Chars) {
      return {
        field: 'pdfContent.images',
        message: `图片总大小过大（合计超过 ${GENERATION_INPUT_LIMITS.classroomPdfImagesTotalBase64Chars} 字符）`,
      };
    }
  }

  return null;
}

/** 把字段级违规变成 413。 */
export function fieldViolationResponse(violation: FieldViolation): NextResponse {
  return apiError('PAYLOAD_TOO_LARGE', 413, violation.message, `field: ${violation.field}`);
}

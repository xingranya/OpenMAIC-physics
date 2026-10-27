/**
 * 浏览器下载适配层。
 *
 * 报告**生成**是纯函数（`lib/physics/report.ts`），而**触发下载**是浏览器
 * 行为。把两者分开，报告层就可以在 Node 脚本与测试里直接使用。
 */

/**
 * 触发一次文本文件下载。
 *
 * 统一带 BOM：Excel / WPS 双击打开 CSV 时不会把中文识别成乱码。
 * 这一点在 Windows 上尤其明显——没有 BOM 的 UTF-8 CSV 打开就是一片锟斤拷。
 */
export function downloadText(
  filename: string,
  content: string,
  mime = 'text/plain;charset=utf-8',
): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

/**
 * 触发一次 Markdown 文件下载。
 *
 * 带 BOM 输出，Excel / WPS 直接双击打开时不会把中文识别成乱码。
 */
export function downloadMarkdown(filename: string, content: string): void {
  downloadText(filename, content, 'text/markdown;charset=utf-8');
}

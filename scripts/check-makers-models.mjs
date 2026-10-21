#!/usr/bin/env node
/**
 * 连通性自检：查询 EdgeOne Makers Models 网关当前可用的模型。
 *
 * 官方文档：https://cloud.tencent.com/document/product/1552/132748
 * 配额文档：https://cloud.tencent.com/document/product/1552/132789
 *
 * 用途：部署前确认「配了 MAKERS_MODELS_KEY 之后到底能调哪些模型」，
 * 并把可以直接粘进 EdgeOne 控制台的 `DEFAULT_MODEL` 打出来——省掉
 * "配了 Key 却说没有可用模型" 这类现场事故。
 *
 * 用法：
 *   MAKERS_MODELS_KEY=xxx node scripts/check-makers-models.mjs
 *   node scripts/check-makers-models.mjs --key xxx
 *
 * 退出码：0 = 网关可达且列出了模型；1 = Key 缺失或网关返回错误。
 */
import { MAKERS_MODELS_BASE_URL, MAKERS_MODELS_PROVIDER_ID } from './makers-models.constants.mjs';

function readKey() {
  const argv = process.argv.slice(2);
  const flagIndex = argv.indexOf('--key');
  if (flagIndex >= 0 && argv[flagIndex + 1]) return argv[flagIndex + 1].trim();
  return (process.env.MAKERS_MODELS_KEY ?? '').trim();
}

const key = readKey();
if (!key) {
  console.error('缺少 MAKERS_MODELS_KEY。请在 EdgeOne 控制台签发后重新运行：');
  console.error('  MAKERS_MODELS_KEY=<your-key> node scripts/check-makers-models.mjs');
  process.exit(1);
}

const url = `${MAKERS_MODELS_BASE_URL}/models`;
console.log(`查询网关模型列表：${url}`);

let response;
try {
  response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
} catch (error) {
  console.error(`网关不可达：${error instanceof Error ? error.message : String(error)}`);
  console.error('排查：确认网络可达 ai-gateway.edgeone.link，且 Key 属于已开通 Makers 的账号。');
  process.exit(1);
}

if (!response.ok) {
  const body = await response.text().catch(() => '');
  console.error(`网关返回 ${response.status} ${response.statusText}`);
  if (body) console.error(body.slice(0, 500));
  process.exit(1);
}

const payload = await response.json().catch(() => null);
const models = Array.isArray(payload?.data) ? payload.data : [];
const ids = models
  .map((item) => (typeof item === 'string' ? item : item?.id))
  .filter((id) => typeof id === 'string' && id.length > 0);

if (ids.length === 0) {
  console.error('网关可达，但没有返回任何模型 id。请检查账号的 Makers 开通状态与模型额度。');
  process.exit(1);
}

console.log(`\n可用模型 ${ids.length} 个：`);
for (const id of ids) console.log(`  - ${id}`);

const recommended = ids[0];
console.log('\n在 EdgeOne 控制台配置：');
console.log(`  MAKERS_MODELS_KEY=<your-key>`);
console.log(`  DEFAULT_MODEL=${MAKERS_MODELS_PROVIDER_ID}:${recommended}`);
console.log('\n若只想固定使用某一个模型，可再显式配置白名单（逗号分隔）：');
console.log(`  MAKERS_MODELS=${ids.slice(0, 3).join(',')}`);

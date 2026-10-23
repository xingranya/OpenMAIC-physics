/**
 * 找一个**确定在仓库之外**、且**向上找不到任何 node_modules** 的临时目录。
 *
 * ## 为什么不能直接用 os.tmpdir()
 *
 * 探针必须「向上找不到任何 node_modules」，否则它会顺着父目录找到**仓库根的
 * node_modules**，把产物里缺失的文件全给补上——探针照样全绿，验的根本不是
 * 将要上线的那份产物。
 *
 * 而 `os.tmpdir()` **不一定**在仓库外：受限环境里 TMPDIR 常被指到仓库内的
 * 临时目录（本项目就曾把 TMPDIR 设成 `<repo>/.tmp`）。那样一来，
 * `<repo>/.tmp/<探针>/` 向上走两步就是 `<repo>/node_modules`——门禁被骗了，
 * 而且是**长期**被骗：线上「凡是加载 @openmaic/storage 的路由全部返回空体
 * 500」，本地却一路绿灯。
 *
 * ## 两道互相独立的不变量
 *
 * 只判「不在仓库内」是不够的——仓库根判错了（跑在错误的 cwd、checklist
 * 拷贝、非 git 目录）就等于没判。所以这里同时用两道判据：
 *
 *   1. **相对判据**：路径不在仓库根之内（相对 `detectRepoRoot()`）。
 *   2. **绝对判据**：从探针目录向上到根，**每一层都没有 node_modules**。
 *      这条与「仓库根在哪」无关，只要命中就一定是在拿仓库的依赖冒充产物。
 *
 * 第 2 条实测能抓到第 1 条抓不到的东西：本机 `~/node_modules` **是存在的**，
 * 所以 `~/.cache` 这类「在仓库外但在 home 底下」的候选目录同样会骗人。
 */
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let counter = 0;

/** 判断 path 是否位于 root 之内（含 root 自身）。 */
export function isInside(root, path) {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + sep);
}

/**
 * 找出仓库根。
 *
 * 从本模块所在位置**向上**找 `.git`（文件或目录都算）——不依赖调用时的
 * cwd，所以从任意目录执行脚本，仓库根都是对的。
 *
 * 找不到 `.git`（比如从压缩包展开的副本里跑）时退回 cwd；此时第 2 道
 * 绝对判据仍然生效，门禁不会因此失效。
 */
export function detectRepoRoot(from = dirname(fileURLToPath(import.meta.url))) {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(process.cwd());
}

/**
 * 从 dir 向上到根，找出第一个含有 `node_modules` 的祖先目录。
 *
 * 找不到返回 null。
 *
 * Node 的模块解析就是「从文件所在目录逐级向上找 node_modules」——所以只要
 * 这条链上有一层带 node_modules，探针就一定会从那里捞到仓库的依赖。
 */
export function findNodeModulesAncestor(dir) {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, 'node_modules'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * 从候选目录里挑一个合规的，并记录每个被否掉的原因。
 *
 * ## 为什么把「挑选」与「创建」拆开
 *
 * 两道判据在真实环境里**高度重叠**：仓库根装着 node_modules，所以「在仓库内」
 * 的候选几乎必然也命中「向上有 node_modules」。若只看最终挑了谁，
 * 把其中一道判据改坏时另一道会替它挡刀，测试照样全绿——护栏就成了摆设。
 *
 * 所以这里把**拒绝原因**显式返回：
 *   - `in-repo` → 第 1 道（相对判据）失守
 *   - `node-modules` → 第 2 道（绝对判据）失守
 *
 * 测试按 reason 精确断言，两道判据就都能被单独证伪。
 *
 * @param {string[]} candidates 候选目录
 * @param {string} repoRoot 仓库根
 * @param {string} prefix 选中后建目录的前缀
 * @returns {{dir: string|null, rejected: Array<{candidate: string, reason: string, via?: string}>}}
 */
export function pickOutsideRepoTemp(candidates, repoRoot, prefix = 'probe') {
  const rejected = [];
  for (const candidate of candidates) {
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    if (isInside(repoRoot, real)) {
      rejected.push({ candidate: real, reason: 'in-repo' });
      continue;
    }
    const hit = findNodeModulesAncestor(real);
    if (hit) {
      rejected.push({ candidate: real, reason: 'node-modules', via: hit });
      continue;
    }
    const dir = join(real, `${prefix}-${process.pid}-${counter++}`);
    mkdirSync(dir, { recursive: true });
    return { dir, rejected };
  }
  return { dir: null, rejected };
}

/**
 * 造一个位于仓库之外、且向上无 node_modules 的临时目录。
 *
 * @param {string} prefix 目录名前缀
 * @param {string} repoRoot 仓库根（默认自动探测）
 * @returns {string} 已创建好的目录绝对路径
 */
export function outsideRepoTemp(prefix, repoRoot = detectRepoRoot()) {
  const candidates = [tmpdir(), '/tmp', '/var/tmp', join(homedir(), '.cache')];
  const { dir, rejected } = pickOutsideRepoTemp(candidates, repoRoot, prefix);
  if (dir) return dir;
  throw new Error(
    `找不到满足「在仓库 ${repoRoot} 之外且向上无 node_modules」的临时目录。\n` +
      `已排除：\n  - ${
        rejected
          .map((r) => `${r.candidate}（${r.reason}${r.via ? `：${r.via}` : ''}）`)
          .join('\n  - ') || '（无）'
      }\n` +
      '探针必须向上找不到任何 node_modules，否则会把产物里缺失的文件' +
      '用仓库自己的 node_modules 补上，门禁形同虚设。',
  );
}

/**
 * 探针落位的**显式**断言：必须在仓库之外，且向上无 node_modules。
 *
 * ## 为什么要在调用点再断言一次
 *
 * `outsideRepoTemp()` 自己已经挑了合规目录，但**调用点**才是真正的失守点：
 * 有人把 `outsideRepoTemp('edgeone-runtime')` 换成
 * `join(process.cwd(), '.tmp', …)` 时，`outsideRepoTemp` 根本不会执行，
 * 门禁就会从红翻绿，还照样打印「通过：仓库外运行无 5xx」——
 * 验的根本不是将要上线的那份产物。
 *
 * 所以这道断言必须独立存在于调用路径上：不依赖被调用方是否守规矩。
 *
 * ## 两道判据必须能被**分别**证伪
 *
 * 现实中「在仓库内」几乎必然同时触发「向上有 node_modules」（仓库根就装着
 * 依赖）。如果错误消息只笼统说「不在仓库外」，那么把其中一道判据改坏时，
 * 另一道会替它挡刀，测试照样全绿——护栏就成了摆设。
 *
 * 所以这里给每道判据一个**稳定关键字**，测试按关键字精确断言：
 *   - `不在仓库内` → 第 1 道（相对判据）失守
 *   - `向上存在 node_modules` → 第 2 道（绝对判据）失守
 */
export function assertProbeOutsideRepo(dir, repoRoot = detectRepoRoot()) {
  const problems = [];
  if (isInside(repoRoot, dir)) {
    problems.push(`不在仓库内：探针目录 ${dir} 位于仓库 ${repoRoot} 之内`);
  }
  const hit = findNodeModulesAncestor(dir);
  if (hit) {
    problems.push(
      `向上存在 node_modules：探针目录 ${dir} 向上到 ${hit} 存在 node_modules，会用仓库依赖冒充产物`,
    );
  }
  if (problems.length > 0) {
    throw new Error(
      `运行期探针必须放在仓库之外：\n  - ${problems.join('\n  - ')}\n` +
        '探针一旦向上能找到 node_modules，就会把产物里缺失的文件用仓库里的副本补齐，' +
        '门禁假绿而线上空体 500。拒绝放行。',
    );
  }
  return dir;
}

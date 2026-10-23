/**
 * 找一个**确定在仓库之外**的临时目录。
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
 * 所以这里显式校验：候选目录必须不在仓库根之内，否则换下一个。
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

let counter = 0;

/** 判断 path 是否位于 root 之内（含 root 自身）。 */
export function isInside(root, path) {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + sep);
}

/**
 * 造一个位于仓库之外的临时目录。
 *
 * @param {string} prefix 目录名前缀
 * @param {string} repoRoot 仓库根（默认当前工作目录）
 * @returns {string} 已创建好的目录绝对路径
 */
export function outsideRepoTemp(prefix, repoRoot = process.cwd()) {
  const candidates = [tmpdir(), '/tmp', '/var/tmp', join(homedir(), '.cache')];
  for (const candidate of candidates) {
    let real;
    try {
      real = realpathSync(candidate);
    } catch {
      continue;
    }
    if (isInside(repoRoot, real)) continue; // 在仓库内 → 不可用
    const dir = join(real, `${prefix}-${process.pid}-${counter++}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  throw new Error(
    `找不到位于仓库（${repoRoot}）之外的临时目录：` +
      '探针必须向上找不到任何 node_modules，否则会把产物里缺失的文件' +
      '用仓库自己的 node_modules 补上，门禁形同虚设。',
  );
}

#!/usr/bin/env node
/**
 * 确定性类型检查。
 *
 * 背景：Next.js 16 的 `next dev` 会把 `next-env.d.ts` 改写成
 *
 *   import "./.next/dev/types/routes.d.ts";
 *   import "./.next/dev/types/root-params.d.ts";
 *
 * 而 `next build` 生成的是 `.next/types/**`。两套文件都声明同名的全局
 * 路由类型（`LayoutRoutes` / `AppRoutes` / `ParamMap`），一旦同时进入
 * TypeScript 程序，后进入的那套会覆盖前一套，把 `LayoutRoutes` 退化成
 * `never`，于是报出与业务代码毫无关系的假错误：
 *
 *   .next/types/validator.ts(25,44): error TS2344:
 *     Type 'Route' does not satisfy the constraint 'never'.
 *
 * 典型触发路径：先 `pnpm dev`，再 `pnpm typecheck`。
 *
 * 本脚本的做法：在检查前把 `next-env.d.ts` 归一化到"当前存在的那一套"
 * 生成物上，检查结束后原样还原。`next-env.d.ts` 是 Next.js 生成的��件，
 * 还原它不影响 dev server（它只关心自己那一份），也不影响构建
 * （`next build` 每次都会重写它）。
 *
 * 用法：node scripts/typecheck.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_D_TS = join(ROOT, 'next-env.d.ts');
const BUILD_TYPES = join(ROOT, '.next', 'types');
const DEV_TYPES = join(ROOT, '.next', 'dev', 'types');

/** 生成物类型目录里必须存在的文件。 */
const TYPE_FILES = ['routes.d.ts', 'root-params.d.ts'];

/** 选择要引用的那一套生成物；两套都没有时返回 null。 */
function pickTypeDir() {
  const buildReady = TYPE_FILES.every((file) => existsSync(join(BUILD_TYPES, file)));
  const devReady = TYPE_FILES.every((file) => existsSync(join(DEV_TYPES, file)));
  // 构建产物优先：它反映最后一次生产构建的路由表。
  if (buildReady) return '.next/types';
  if (devReady) return '.next/dev/types';
  return null;
}

function main() {
  if (!existsSync(ENV_D_TS)) {
    console.error('next-env.d.ts 不存在；请先运行 `pnpm dev` 或 `pnpm build` 生成它。');
    process.exit(1);
  }

  const original = readFileSync(ENV_D_TS, 'utf8');
  const target = pickTypeDir();

  // 去掉指向生成物的 import 行，改为引用选中的那一套。
  const withoutImports = original
    .split('\n')
    .filter((line) => !/^\s*import\s+["']\.\/\.next\/(dev\/)?types\//.test(line))
    .join('\n');

  const normalized =
    target === null
      ? withoutImports
      : `${withoutImports.replace(/\s*$/, '')}\nimport "./${target}/routes.d.ts";\nimport "./${target}/root-params.d.ts";\n`;

  let wrote = false;
  if (normalized !== original) {
    writeFileSync(ENV_D_TS, normalized, 'utf8');
    wrote = true;
  }

  try {
    const tsc = join(ROOT, 'node_modules', '.bin', 'tsc');
    const result = spawnSync(tsc, ['--noEmit', '-p', 'tsconfig.typecheck.json'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    process.exit(result.status ?? 1);
  } finally {
    if (wrote) writeFileSync(ENV_D_TS, original, 'utf8');
  }
}

main();

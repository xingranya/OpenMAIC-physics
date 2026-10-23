import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
    // **必须**去重 react / react-dom。
    //
    // 这个仓库是 pnpm workspace，hoisted 布局下根 `node_modules/react` 是
    // **真实目录**（不是指向 .pnpm store 的软链），而
    // `packages/@openmaic/renderer/node_modules/react` 是**另一份物理副本**。
    // 两者同时被加载时，渲染器用的 React 与 react-dom 用的不是同一个实例，
    // 于是 hooks 的 dispatcher 为 null，报 "Invalid hook call"——
    // 症状长��像「组件写错了」，根因却是模块解析出了两份 React。
    //
    // dedupe 让所有 'react' / 'react-dom' 解析到同一份，从根上消除这类失败。
    dedupe: ['react', 'react-dom'],
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup-env.ts'],
  },
});

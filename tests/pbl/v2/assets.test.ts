import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

function expectPng(path: string) {
  const bytes = readFileSync(path);

  expect(bytes.length).toBeGreaterThan(0);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

describe('PBL v2 static assets', () => {
  test('ships the instructor avatar referenced by the runtime UI', () => {
    expectPng('public/avatars/instructor.png');
  });

  test('ships the school emblem used in the workspace header', () => {
    // 工作区头图用的是**校本院徽**（lib/school/identity.ts 的 SCHOOL.emblemSrc
    // 指向 public/brand/college-brand.png），不再是上游品牌标记。
    expectPng('public/brand/college-brand.png');
  });
});

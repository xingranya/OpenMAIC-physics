import { describe, expect, it } from 'vitest';
import { isValidClassroomId } from '@/lib/classroom/id';

/**
 * 课堂 id 的形状校验。
 *
 * 这个函数现在有两类调用方，约束不一样：
 *
 * - 服务端存储与 API 路由用它挡**路径穿越**（id 会被拼进文件路径）；
 * - 课堂页的外壳用它决定**要不要 404**。
 *
 * 所以「拒绝什么」比「接受什么」更重要。下面按攻击面而不是按字符集组织。
 */
describe('isValidClassroomId', () => {
  it('接受生成侧的形状（nanoid 10 位）', () => {
    expect(isValidClassroomId('aB3xY9zQ2m')).toBe(true);
    expect(isValidClassroomId('abc-def_123')).toBe(true);
  });

  it('拒绝路径穿越', () => {
    expect(isValidClassroomId('..')).toBe(false);
    expect(isValidClassroomId('../etc/passwd')).toBe(false);
    expect(isValidClassroomId('a/../../b')).toBe(false);
    expect(isValidClassroomId('a\\b')).toBe(false);
  });

  it('拒绝带分隔符或空白的值', () => {
    expect(isValidClassroomId('a/b')).toBe(false);
    expect(isValidClassroomId('a b')).toBe(false);
    expect(isValidClassroomId(' a')).toBe(false);
    expect(isValidClassroomId('a\n')).toBe(false);
    expect(isValidClassroomId('')).toBe(false);
  });

  it('拒绝超长值', () => {
    // 上界存在的意义：id 会被当作文件名与 Map 键，无上界就是一条廉价的
    // 内存/路径长度攻击面。
    expect(isValidClassroomId('a'.repeat(64))).toBe(true);
    expect(isValidClassroomId('a'.repeat(65))).toBe(false);
    expect(isValidClassroomId('a'.repeat(10_000))).toBe(false);
  });

  it('拒绝非字符串', () => {
    expect(isValidClassroomId(undefined)).toBe(false);
    expect(isValidClassroomId(null)).toBe(false);
    expect(isValidClassroomId(42)).toBe(false);
    expect(isValidClassroomId({})).toBe(false);
  });
});

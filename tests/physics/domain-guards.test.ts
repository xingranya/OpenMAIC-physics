import { describe, expect, it } from 'vitest';

import { findViolations } from '../../scripts/check-physics-domain-purity.mjs';
import { buildSlideFooterSpec, buildSlideHeaderSpec } from '@/lib/school/branding';
import { pickCoveredDimensions } from '@/lib/physics/engine';
import { findShortcutsForPalette } from '@/lib/physics/shortcuts';
import { COURSE, SCHOOL } from '@/lib/school/identity';

describe('物理域依赖分层门禁（自检）', () => {
  it('能抓到纯领域层里的 React import', () => {
    // 回归护栏：门禁曾经先剥离字符串字面量再匹配 import，导致
    // `from 'react'` 永远匹配不到，整条 React 规则形同虚设。
    const violations = findViolations(
      'lib/physics/engine.ts',
      "import * as React from 'react';\nexport const x = 1;\n",
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join('\n')).toContain('React');
  });

  it('能抓到纯领域层里的 Next.js 与 UI 组件 import', () => {
    expect(
      findViolations('lib/physics/engine.ts', "import { cookies } from 'next/headers';\n").length,
    ).toBeGreaterThan(0);
    expect(
      findViolations('lib/physics/engine.ts', "import { Button } from '@/components/ui/button';\n")
        .length,
    ).toBeGreaterThan(0);
    expect(
      findViolations('lib/physics/engine.ts', "import { route } from '@/app/route';\n").length,
    ).toBeGreaterThan(0);
  });

  it('能抓到纯领域层里的 DOM 与浏览器存储访问', () => {
    expect(
      findViolations('lib/physics/engine.ts', 'const el = document.getElementById("x");\n').length,
    ).toBeGreaterThan(0);
    expect(
      findViolations('lib/physics/engine.ts', 'const v = localStorage.getItem("x");\n').length,
    ).toBeGreaterThan(0);
  });

  it('HTML 字符串里的 DOM 调用不算纯领域层违规', () => {
    // presets/ultrasonic-lab.ts 把脚本内嵌在 HTML 字符串里，属于误报豁免。
    const violations = findViolations(
      'lib/physics/presets/ultrasonic-lab.ts',
      'export const html = `<script>document.getElementById("dv");</script>`;\n',
    );
    expect(violations).toEqual([]);
  });

  it('浏览器适配层允许 React（use-shortcuts 是 React Hook）', () => {
    const violations = findViolations(
      'lib/physics/use-shortcuts.ts',
      "import * as React from 'react';\nexport const useX = () => null;\n",
    );
    expect(violations).toEqual([]);
  });

  it('真实物理域源码通过门禁', () => {
    expect(
      findViolations('lib/physics/data.ts', "import { COURSE } from '@/lib/school/identity';\n"),
    ).toEqual([]);
  });
});

describe('导出页眉页脚规格', () => {
  it('页眉贴顶、页脚贴底，且两端都带学校与课程', () => {
    const header = buildSlideHeaderSpec(960, '#1e293b', '力学 · 运动与力');
    const footer = buildSlideFooterSpec(960, 0.5625, '#94a3b8', COURSE.teacher);

    expect(header.text).toContain(SCHOOL.college);
    expect(header.text).toContain(COURSE.name);
    expect(header.text).toContain('力学 · 运动与力');
    expect(footer.text).toContain(SCHOOL.college);
    expect(footer.text).toContain(COURSE.name);
    expect(footer.text).toContain(COURSE.teacher);

    // 页眉在上、页脚在下，两者不重叠
    expect(header.top).toBeLessThan(100);
    expect(footer.top).toBeGreaterThan(400);
  });

  it('章节与教师缺省时只保留固定标识', () => {
    expect(buildSlideHeaderSpec(960, '#000').text).toBe(`${SCHOOL.college} · ${COURSE.name}`);
    expect(buildSlideFooterSpec(960, 0.5625, '#000').text).toBe(
      `${SCHOOL.college} · ${COURSE.name}`,
    );
  });
});

describe('诊断维度交集', () => {
  it('未考查的维度即使是 0 分也不出现', () => {
    const dimensions = {
      力学: 90,
      波动: 80,
      热学: 0,
      电磁学: 70,
      光学: 60,
      近代物理: 0,
      实验: 85,
    };
    const picked = pickCoveredDimensions(dimensions, ['力学', '波动', '电磁学', '光学', '实验']);
    expect(Object.keys(picked).sort()).toEqual(['力学', '光学', '实验', '波动', '电磁学'].sort());
    expect(picked['热学']).toBeUndefined();
    expect(picked['近代物理']).toBeUndefined();
  });

  it('没有诊断结果时返回空集合', () => {
    expect(pickCoveredDimensions(undefined, ['力学'])).toEqual({});
  });
});

describe('命令面板的重置作用域', () => {
  it('学生只看到"重置我的学习记录"，看不到清空全量', () => {
    const labels = findShortcutsForPalette('student').map((binding) => binding.label);
    expect(labels).toContain('重置我的学习记录');
    expect(labels).not.toContain('清空本地全部数据');
  });

  it('教师只看到"清空本地全部数据"，看不到学生侧重置', () => {
    const labels = findShortcutsForPalette('teacher').map((binding) => binding.label);
    expect(labels).toContain('清空本地全部数据');
    expect(labels).not.toContain('重置我的学习记录');
  });
});

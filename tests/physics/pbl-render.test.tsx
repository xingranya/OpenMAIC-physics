import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// 与上游 tests/pbl/legacy/read.test.ts 一致：只关心分支选择，不关心文案。
vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'zh-CN' }),
}));

import { PBLRenderer } from '@/components/scene-renderers/pbl-renderer';
import { PRESET_CLASSROOMS, buildPresetClassroom } from '@/lib/physics/presets';
import { isRunnablePBLProjectV2 } from '@/lib/pbl/v2/types';

interface LoosePblScene {
  type: string;
  content: {
    type: string;
    projectV2?: unknown;
  };
}

/**
 * 课堂播放器真正渲染 PBL 场景时的回归。
 *
 * 光有"结构合法"不够：渲染器会用运行期水合后的 projectV2 再判一次，
 * 只有真正渲染出项目内容才算预置包可用。
 */
describe('PBL 场景在课堂渲染器中的实际渲染', () => {
  it('预置包的 PBL 场景不会降级为「项目尚未生成」占位', () => {
    const preset = PRESET_CLASSROOMS.find((item) => item.pbl);
    expect(preset).toBeTruthy();

    const { scenes } = buildPresetClassroom(preset!);
    const loose = scenes as unknown as LoosePblScene[];
    const pblScene = loose.find((scene) => scene.type === 'pbl');
    expect(pblScene).toBeTruthy();

    const projectV2 = pblScene!.content.projectV2;
    expect(isRunnablePBLProjectV2(projectV2)).toBe(true);

    const markup = renderToStaticMarkup(
      createElement(PBLRenderer, {
        content: { type: 'pbl', projectV2: projectV2 as never },
        mode: 'playback',
        sceneId: pblScene!.content.type,
      }),
    );

    expect(markup).not.toContain('pbl.emptyProject');
    expect(markup).toContain(preset!.pbl!.title);
  });
});

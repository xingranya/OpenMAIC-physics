import { describe, expect, it } from 'vitest';

import { isRunnablePBLProjectV2 } from '@/lib/pbl/v2/types';
import {
  PHYSICS_CONSTRAINTS,
  buildPhysicsRequirement,
  hasPhysicsConstraints,
} from '@/lib/physics/prompts/physics-constraints';
import {
  PRESET_CLASSROOMS,
  buildPresetClassroom,
  buildUltrasonicLabHtml,
  getPresetByChapter,
  getPresetById,
} from '@/lib/physics/presets';

/**
 * 宽松的场景形状：DSL 的 `Scene` 默认泛型只覆盖 slide / quiz，
 * 而本项目的构建器会产出 interactive 场景，测试按运行时形状读取。
 */
interface LooseScene {
  type: string;
  content: { type: string; html?: string };
}

/**
 * PBL 场景的宽松形状：Scene 的默认泛型不覆盖 pbl，
 * 测试按运行时形状读取 projectV2。
 */
interface LoosePblScene {
  type: string;
  content: {
    type: string;
    projectV2?: {
        title: string;
        uiPhase: string;
        status: string;
        milestones: { status: string }[];
        roles: { type: string }[];
        scenario?: { characters: unknown[] };
    };
  };
}

describe('物理领域约束', () => {
  it('约束文本包含符号量纲、常见误区、实验安全与思政四类', () => {
    expect(PHYSICS_CONSTRAINTS).toContain('符号与量纲规范');
    expect(PHYSICS_CONSTRAINTS).toContain('常见误区');
    expect(PHYSICS_CONSTRAINTS).toContain('实验与安全');
    expect(PHYSICS_CONSTRAINTS).toContain('课程思政');
  });

  it('把约束拼在用户需求之后，不覆盖原需求', () => {
    const requirement = '大学物理 第三章 牛顿运动定律';
    const result = buildPhysicsRequirement(requirement);
    expect(result.startsWith(requirement)).toBe(true);
    expect(result).toContain('符号与量纲规范');
  });

  it('空需求不产生多余约束', () => {
    expect(buildPhysicsRequirement('   ')).toBe('');
  });

  it('可识别已含约束的文本，避免重复拼接', () => {
    expect(hasPhysicsConstraints(buildPhysicsRequirement('力学'))).toBe(true);
    expect(hasPhysicsConstraints('力学')).toBe(false);
  });
});

describe('预置课堂包', () => {
  it('提供 6 个章节的剧本，覆盖多个模块', () => {
    expect(PRESET_CLASSROOMS).toHaveLength(6);
    const chapters = PRESET_CLASSROOMS.map((preset) => preset.chapterNo);
    expect(new Set(chapters).size).toBe(6);
  });

  it('每个剧本都有目标、场景、测验与思政锚点', () => {
    PRESET_CLASSROOMS.forEach((preset) => {
      expect(preset.objectives.length).toBeGreaterThan(0);
      expect(preset.scenes.length).toBeGreaterThan(0);
      expect(preset.quiz.length).toBeGreaterThan(0);
      expect(preset.ideologyKey).toBeTruthy();
      preset.quiz.forEach((question) => {
        expect(question.options.length).toBeGreaterThanOrEqual(3);
        expect(question.correctIndex).toBeGreaterThanOrEqual(0);
        expect(question.correctIndex).toBeLessThan(question.options.length);
        expect(question.analysis).toBeTruthy();
      });
    });
  });

  it('按章号与 id 都能取到剧本', () => {
    const preset = PRESET_CLASSROOMS[0];
    expect(getPresetByChapter(preset.chapterNo)?.id).toBe(preset.id);
    expect(getPresetById(preset.id)?.id).toBe(preset.id);
    expect(getPresetByChapter(999)).toBeUndefined();
  });
});

describe('课堂文档构建器', () => {
  it('生成合法的 Stage 与场景序列', () => {
    const preset = PRESET_CLASSROOMS[0];
    const { stage, scenes, currentSceneId } = buildPresetClassroom(preset, 1_700_000_000_000);

    expect(stage.id).toBeTruthy();
    expect(stage.name).toContain(preset.title);
    expect(stage.createdAt).toBe(1_700_000_000_000);
    expect(scenes.length).toBeGreaterThan(preset.scenes.length);
    expect(currentSceneId).toBe(scenes[0].id);

    // 场景顺序必须连续，且 stageId 一致。
    scenes.forEach((scene, index) => {
      expect(scene.order).toBe(index);
      expect(scene.stageId).toBe(stage.id);
    });
  });

  it('讲演场景生成带讲稿的幻灯片，页脚含学校标识', () => {
    const preset = PRESET_CLASSROOMS[0];
    const { scenes } = buildPresetClassroom(preset);
    const slideScene = scenes.find(
      (scene) => scene.type === 'slide' && scene.content.type === 'slide',
    );
    expect(slideScene).toBeDefined();
    if (!slideScene || slideScene.content.type !== 'slide') return;

    const canvas = slideScene.content.canvas;
    expect(canvas.elements.length).toBeGreaterThan(0);
    expect(canvas.script).toBeTruthy();
    const texts = canvas.elements
      .filter((element) => element.type === 'text')
      .map((element) => (element as { content: string }).content);
    expect(texts.some((text) => text.includes('长江大学文理学院'))).toBe(true);
  });

  it('测验场景带选项与答案键', () => {
    const preset = PRESET_CLASSROOMS[0];
    const { scenes } = buildPresetClassroom(preset);
    const quizScene = scenes.find(
      (scene) => scene.type === 'quiz' && scene.content.type === 'quiz',
    );
    expect(quizScene).toBeDefined();
    if (!quizScene || quizScene.content.type !== 'quiz') return;

    const questions = quizScene.content.questions;
    expect(questions.length).toBe(preset.quiz.length);
    questions.forEach((question) => {
      expect(question.type).toBe('single');
      expect(question.options?.length).toBeGreaterThanOrEqual(3);
      expect(question.answer?.[0]).toMatch(/^[A-D]$/);
    });
  });

  it('带交互仿真的剧本会生成 interactive 场景，且 HTML 自包含', () => {
    const preset = PRESET_CLASSROOMS.find((item) => item.hasInteractive);
    expect(preset).toBeDefined();
    if (!preset) return;

    const { scenes } = buildPresetClassroom(preset);
    // Scene 的默认泛型只覆盖 slide / quiz，这里按运行时形状读取 interactive。
    const interactive = (scenes as unknown as LooseScene[]).find(
      (scene) => scene.type === 'interactive' && scene.content.type === 'interactive',
    );
    expect(interactive).toBeDefined();
    if (!interactive) return;

    const html = interactive.content.html ?? '';
    expect(html.length).toBeGreaterThan(0);
    // 不得引用任何外部资源。
    expect(html).not.toMatch(/src=["']https?:/);
    expect(html).not.toMatch(/href=["']https?:/);
  });
});

describe('课堂动作：旁白 / 白板演算 / 讨论', () => {
  it('每个讲授场景都带旁白动作', () => {
    const preset = PRESET_CLASSROOMS[0];
    const { scenes } = buildPresetClassroom(preset);
    const lectureScenes = scenes.filter(
      (scene) => scene.type === 'slide' && (scene as { content: { type: string } }).content.type === 'slide',
    );
    expect(lectureScenes.length).toBeGreaterThan(0);
    lectureScenes.forEach((scene) => {
      const actions = (scene as { actions?: { type: string }[] }).actions ?? [];
      expect(actions.some((action) => action.type === 'speech')).toBe(true);
    });
  });

  it('带白板步骤的场景按 开板→演算→关板 的顺序产出动作', () => {
    const preset = PRESET_CLASSROOMS.find((item) =>
      item.scenes.some((scene) => scene.whiteboard && scene.whiteboard.length > 0),
    );
    expect(preset).toBeDefined();
    if (!preset) return;

    const { scenes } = buildPresetClassroom(preset);
    const withBoard = scenes.find((scene) => {
      const actions = (scene as { actions?: { type: string }[] }).actions ?? [];
      return actions.some((action) => action.type === 'wb_open');
    });
    expect(withBoard).toBeDefined();
    if (!withBoard) return;

    const actions = ((withBoard as { actions?: { type: string }[] }).actions ?? []).map(
      (action) => action.type,
    );
    expect(actions[0]).toBe('speech');
    expect(actions.indexOf('wb_open')).toBeLessThan(actions.indexOf('wb_close'));
    expect(actions.filter((type) => type === 'wb_draw_latex').length).toBeGreaterThan(0);
  });

  it('最后一节讲授课带讨论动作与多智能体配置', () => {
    const preset = PRESET_CLASSROOMS[0];
    const { scenes } = buildPresetClassroom(preset);
    const lectureScenes = scenes.filter(
      (scene) => scene.type === 'slide' && (scene as { content: { type: string } }).content.type === 'slide',
    );
    const last = lectureScenes[lectureScenes.length - 1] as unknown as {
      actions?: { type: string }[];
      multiAgent?: { enabled: boolean; agentIds: string[] };
    };
    expect(last.multiAgent?.enabled).toBe(true);
    expect(last.multiAgent?.agentIds.length).toBeGreaterThan(0);
    expect(last.actions?.some((action) => action.type === 'discussion')).toBe(true);
  });

  it('课堂名册使用本校智能体人格', () => {
    const preset = PRESET_CLASSROOMS[0];
    const { stage } = buildPresetClassroom(preset);
    const roster = stage.generatedAgentConfigs ?? [];
    expect(roster.length).toBeGreaterThan(0);
    expect(roster.some((agent) => agent.role === 'teacher')).toBe(true);
    expect(roster.some((agent) => agent.role === 'student')).toBe(true);
    expect(roster.every((agent) => agent.persona.length > 0)).toBe(true);
  });
});

describe('PBL 项目场景', () => {
  it('生成结构完整的 PBLProject', () => {
    const preset = PRESET_CLASSROOMS.find((item) => item.pbl);
    expect(preset).toBeDefined();
    if (!preset) return;

    const { scenes } = buildPresetClassroom(preset);
    const pblScene = (scenes as unknown as LoosePblScene[]).find(
      (scene) => scene.type === 'pbl' && scene.content.type === 'pbl',
    );
    expect(pblScene).toBeDefined();
    if (!pblScene) return;

    const project = pblScene.content.projectV2;
    expect(project).toBeDefined();
    if (!project) return;

    expect(project.title).toBe(preset.pbl?.title);
    expect(project.milestones.length).toBe(preset.pbl?.milestones.length);
    expect(project.roles.length).toBeGreaterThan(0);
    expect(project.roles.some((role) => role.type === 'user')).toBe(true);
    expect(project.scenario?.characters.length).toBeGreaterThan(0);
    expect(project.uiPhase).toBe('hero');
    expect(project.status).toBe('active');
    // 第一步里程碑激活，其余锁定。
    expect(project.milestones[0].status).toBe('active');
    expect(project.milestones[1]?.status).toBe('locked');
  });
});

describe('自包含交互仿真', () => {
  it('不依赖任何外部脚本或样式', () => {
    const html = buildUltrasonicLabHtml();
    expect(html).toContain('<script>');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });

  it('包含测距核心公式与关键参数', () => {
    const html = buildUltrasonicLabHtml();
    expect(html).toContain('d = v·t / 2');
    expect(html).toContain('超声波测距');
  });
});

describe('PBL 场景可运行性（与课堂播放器同一套校验）', () => {
  function findPblProject(presetId: string) {
    const preset = PRESET_CLASSROOMS.find((item) => item.id === presetId);
    expect(preset, `找不到预置包 ${presetId}`).toBeTruthy();
    const { scenes } = buildPresetClassroom(preset!);
    const loose = scenes as unknown as LoosePblScene[];
    const pblScene = loose.find((scene) => scene.type === 'pbl');
    expect(pblScene, `${presetId} 缺少 PBL 场景`).toBeTruthy();
    return pblScene!.content.projectV2;
  }

  it('所有带 PBL 的预置包，其 projectV2 都通过上游 isRunnablePBLProjectV2', () => {
    const withPbl = PRESET_CLASSROOMS.filter((preset) => preset.pbl);
    expect(withPbl.length).toBeGreaterThan(0);

    withPbl.forEach((preset) => {
      const project = findPblProject(preset.id);
      expect(
        isRunnablePBLProjectV2(project),
        `${preset.id} 的 PBL 项目未通过可运行性校验（会被降级为「项目尚未生成」）`,
      ).toBe(true);
    });
  });

  it('PBL 项目里至少有一个 instructor 角色与带微任务的里程碑', () => {
    const preset = PRESET_CLASSROOMS.find((item) => item.pbl);
    expect(preset).toBeTruthy();
    const project = findPblProject(preset!.id) as unknown as {
      roles: { type: string }[];
      milestones: { microtasks: { id: string; title: string }[] }[];
    };

    expect(project.roles.some((role) => role.type === 'instructor')).toBe(true);
    project.milestones.forEach((milestone) => {
      expect(milestone.microtasks.length).toBeGreaterThan(0);
      milestone.microtasks.forEach((task) => {
        expect(task.id.length).toBeGreaterThan(0);
        expect(task.title.length).toBeGreaterThan(0);
      });
    });
  });
});

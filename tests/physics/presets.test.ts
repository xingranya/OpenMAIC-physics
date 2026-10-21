import { describe, expect, it } from 'vitest';

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

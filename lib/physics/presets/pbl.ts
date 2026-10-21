/**
 * 预置课堂包 —— PBL 项目构建器。
 *
 * 真实生成的课堂里，PBL 场景承载"学生扮演一个角色，与 AI 角色协作完成
 * 一个有里程碑的任务"。预置包必须提供结构完全一致的 PBLProject，
 * 否则课堂播放器会把它当成普通场景降级处理。
 *
 * 本模块是纯函数：不依赖 React / DOM，可单测。
 */

import type { PBLProject, PBLRoleType } from '@openmaic/dsl';

import type { PresetPbl } from './types';

/** 情境角色：由剧本里的讨论角色转成 PBL 里的协作者。 */
interface ScenarioCharacter {
  id: string;
  name: string;
  persona: string;
  situation?: string;
  /**
   * PBL 角色类型。课堂播放器的可运行性校验要求项目里至少有一个
   * `instructor` 角色，否则整个 PBL 场景会被降级成「项目尚未生成」。
   */
  roleType?: Exclude<PBLRoleType, 'user'>;
}

/** 构建 PBL 项目。 */
export function buildPblProject(
  presetId: string,
  pbl: PresetPbl,
  options: { now?: string; characters?: readonly ScenarioCharacter[] } = {},
): PBLProject {
  const now = options.now ?? new Date().toISOString();
  const characters: ScenarioCharacter[] = options.characters?.length
    ? [...options.characters]
    : [
        {
          id: `${presetId}-mentor`,
          name: '课题指导教师',
          roleType: 'instructor',
          persona:
            '你是一位耐心、严谨的课题指导教师。你的职责是提供必要的理论支撑与实验规范，' +
            '而不是替学生完成分析。回答时先确认学生的模型假设，再指出下一步该做什么。',
          situation: '你是本次课题的指导教师，学生已经拿到任务书，正在推进第一个里程碑。',
        },
      ];

  return {
    uiPhase: 'hero',
    title: pbl.title,
    description: pbl.goal,
    learningObjective: pbl.goal,
    gains: [
      '用物理模型解释真实问题，而不是套用公式',
      '把结论建立在可复核的过程证据上',
      '在协作中说明个人贡献与团队成果的边界',
    ],
    tags: ['大学物理', '项目式学习', pbl.role],
    language: 'zh-CN',
    languageDirective: '全程使用简体中文，物理量使用规范符号，公式给出量纲检查。',
    scenario: {
      setting: '大学物理课程的项目式学习环节。',
      goal: pbl.goal,
      // DSL 的 scenario.rules 是单字符串，不是数组。
      rules: [
        '每一步结论都要写明所依据的物理规律与模型假设',
        '数据必须先做误差分析再下结论',
        '讨论中区分个人贡献与团队成果',
      ].join('；'),
      learnerRole: pbl.role,
      characters,
    },
    proficiency: 'intermediate',
    status: 'active',
    roles: [
      {
        id: `${presetId}-learner`,
        type: 'user',
        name: pbl.role,
        description: `你扮演的角色：${pbl.role}。目标是${pbl.goal}`,
        systemPrompt: `你正在完成《大学物理》项目任务「${pbl.title}」。你的角色是${pbl.role}。`,
      },
      ...characters.map((character) => ({
        id: character.id,
        type: character.roleType ?? ('collaborator' as const),
        name: character.name,
        description: character.situation,
        systemPrompt: character.persona,
      })),
    ],
    milestones: pbl.milestones.map((milestone, index) => ({
      id: `${presetId}-ms-${index}`,
      title: milestone,
      description: undefined,
      status: index === 0 ? ('active' as const) : ('locked' as const),
      order: index,
      // 每个里程碑至少要有一个微任务，否则课堂播放器的可运行性校验不通过。
      microtasks: [
        {
          id: `${presetId}-ms-${index}-task-0`,
          title: milestone,
          description: '完成这一步并留下可复核的过程记录：数据、模型假设、所用公式与推导。',
          status: 'todo' as const,
          assignee: 'user' as const,
          hints: ['先写清模型假设与所用物理规律，再动手取数'],
          order: 0,
          completionCriteria: '提交含数据与推导的过程记录，能被同伴复核。',
        },
        {
          id: `${presetId}-ms-${index}-task-1`,
          title: `复核：${milestone}`,
          description: '用量纲检查与数量级估算复核上一步的结论，并写明结论成立的边界条件。',
          status: 'todo' as const,
          assignee: 'user' as const,
          hints: ['量纲对不上说明公式或单位记错了', '数量级差一个数量级以上，先回头查单位'],
          order: 1,
          completionCriteria: '给出量纲与数量级复核结论，并说明适用边界。',
        },
      ],
      briefing: `完成「${milestone}」。要求：写清物理依据、保留可复核的过程记录。`,
      completionCriteria: '提交可复核的过程记录，并说明结论成立的边界条件。',
      debrief: '对照初始假设说明方案哪里被数据改进了、哪里仍然没有解释清楚。',
      scenarioStage:
        index === 0
          ? ('prep' as const)
          : index === pbl.milestones.length - 1
            ? ('wrapup' as const)
            : ('roleplay' as const),
    })),
    submissions: [],
    evaluations: [],
    threads: characters.map((character) => ({
      agentId: character.id,
      messages: [],
    })),
    engagementEvents: [],
    createdAt: now,
    updatedAt: now,
  };
}

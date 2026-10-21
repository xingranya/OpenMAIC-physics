'use client';

/**
 * 教师端 · 教学洞察。
 *
 * 汇总各模块的优势 / 改进 / 风险，并给出可执行的调控方案与 AI 使用边界。
 */

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Lightbulb, ShieldCheck, TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, PageHeader, SectionCard, SimpleBarChart } from '@/components/physics/shared';
import { CHAPTER_MAPPINGS, DEMO_STUDENTS, TEACHING_PLANS } from '@/lib/physics/data';
import { IDEOLOGY_POINTS, SCHOOL_LABS } from '@/lib/school';
import Link from 'next/link';

/** 规则引擎给出的模块级洞察。 */
const MODULE_INSIGHTS = [
  {
    module: '力学',
    strength: 88,
    improvement: 62,
    risk: 41,
    note: '受力分析与建模路径掌握较好，能量转化环节易遗漏势能变化。',
  },
  {
    module: '振动与波',
    strength: 74,
    improvement: 58,
    risk: 52,
    note: '"波速—振动速度"混淆率偏高，波的传播与能量传递需专门澄清。',
  },
  {
    module: '热学',
    strength: 79,
    improvement: 70,
    risk: 38,
    note: '状态方程应用熟练，宏观与微观视角的切换仍需练习。',
  },
  {
    module: '电磁学',
    strength: 66,
    improvement: 52,
    risk: 68,
    note: '概念混淆集中，方向与回路的处理是主要失分点。',
  },
  {
    module: '光学',
    strength: 73,
    improvement: 61,
    risk: 45,
    note: '几何光学与波动光学的判别不稳，实验与算法结合环节参与度低。',
  },
  {
    module: '近代物理',
    strength: 61,
    improvement: 48,
    risk: 57,
    note: '量子化图像建立不足，跨尺度建模能力偏弱。',
  },
];

export function TeacherInsights() {
  const { state } = usePhysicsState();
  const reviewed = Object.keys(state.evaluationReviews).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="教学洞察"
        description="模块级优势 / 改进 / 风险，配套调控方案与 AI 使用边界。洞察来自本地规则引擎，供讲评课备课参考。"
      />

      <SectionCard title="模块画像" description="优势 / 改进 / 风险 三条基线">
        <SimpleBarChart
          caption="各模块优势指数"
          unit=" 分"
          data={MODULE_INSIGHTS.map((item) => ({ label: item.module, value: item.strength }))}
        />
        <ul className="mt-4 flex flex-col gap-2">
          {MODULE_INSIGHTS.map((item) => (
            <li key={item.module} className="rounded-lg border border-border/70 p-3">
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                {item.module}
                <Badge variant="secondary" className="font-normal">
                  优势 {item.strength}
                </Badge>
                <Badge variant="outline" className="font-normal">
                  改进 {item.improvement}
                </Badge>
                <Badge variant="destructive" className="font-normal">
                  风险 {item.risk}
                </Badge>
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{item.note}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard title="优势">
          <ul className="flex flex-col gap-2 text-[12.5px]">
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--school-success)]" aria-hidden="true" />
              力学建模路径完整，受力图表达规范。
            </li>
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--school-success)]" aria-hidden="true" />
              热学部分宏观—微观转换意识已建立。
            </li>
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-[var(--school-success)]" aria-hidden="true" />
              项目实践参与度高，动手意愿强。
            </li>
          </ul>
        </SectionCard>

        <SectionCard title="改进">
          <ul className="flex flex-col gap-2 text-[12.5px]">
            <li className="flex items-start gap-1.5">
              <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-[var(--school-warning)]" aria-hidden="true" />
              电磁学概念混淆需要专项讲评与错题归因。
            </li>
            <li className="flex items-start gap-1.5">
              <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-[var(--school-warning)]" aria-hidden="true" />
              误差分析深度不足，多数停留在「读数偏大」。
            </li>
            <li className="flex items-start gap-1.5">
              <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-[var(--school-warning)]" aria-hidden="true" />
              跨尺度建模（经典→量子）经验不足。
            </li>
          </ul>
        </SectionCard>

        <SectionCard title="风险">
          <ul className="flex flex-col gap-2 text-[12.5px]">
            <li className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--school-danger)]" aria-hidden="true" />
              {DEMO_STUDENTS.filter((student) => student.risk === '高风险').length} 名学生处于高风险层。
            </li>
            <li className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--school-danger)]" aria-hidden="true" />
              仅 {reviewed} / {DEMO_STUDENTS.length} 人完成人工复核，建议优先覆盖高风险学生。
            </li>
            <li className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--school-danger)]" aria-hidden="true" />
              实验小组分工不均，存在「个人成果」替代团队成果的风险。
            </li>
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="教学调控方案" description="可作为讲评课与分组辅导的备课抓手">
        <ul className="flex flex-col gap-2.5">
          {TEACHING_PLANS.map((plan) => (
            <li key={plan.id} className="rounded-lg border border-border/70 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                <Lightbulb className="size-3.5 text-primary" aria-hidden="true" />
                {plan.title}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{plan.content}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="课程思政落点" description="每章一条锚点，可直接写进讲评课 PPT">
          <ul className="flex flex-col gap-2">
            {IDEOLOGY_POINTS.map((point) => (
              <li key={point.key} className="rounded-lg border border-border/70 p-2.5">
                <p className="text-[12.5px] font-medium">{point.theme}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {point.summary}
                </p>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="AI 使用边界" description="平台内 AI 能力的责任划分">
          <ul className="flex flex-col gap-2 text-[12.5px]">
            {[
              'AI 只产出建议分、提示与参考材料，不直接决定成绩。',
              '教师复核结果始终覆盖 AI 建议分，学习报告以复核分为准。',
              '所有破坏性动作（重置记录、重新诊断、切换项目）都有二次确认与 24 小时可恢复快照。',
              '学生数据全部保存在本地浏览器，不写回任何教务系统。',
              'AI 生成的课堂内容需教师审阅后再进入正式教学。',
            ].map((rule, index) => (
              <li key={rule} className="flex items-start gap-1.5">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="mr-1 font-medium text-muted-foreground">{index + 1}.</span>
                  {rule}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="实验资源" description={`校内实验项目 ${SCHOOL_LABS.length} 个（示例清单）`}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {SCHOOL_LABS.map((lab) => (
            <li key={lab.id} className="rounded-lg border border-border/70 p-2.5">
              <p className="text-[12.5px] font-medium">{lab.name}</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {lab.dimension} · {lab.hours} 学时 · {lab.measurand}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          课程共 {CHAPTER_MAPPINGS.length} 章，映射 {CHAPTER_MAPPINGS.length} 个章节项目案例。
        </p>
      </SectionCard>

      <HintBar>
        本页洞察由本地规则引擎基于课程示例数据生成，<strong>不是真实模型推理日志</strong>；
        使用前请与实际教学情况核对。
      </HintBar>

      <Button asChild variant="outline">
        <Link href="/teacher/evaluation">回到评价复核</Link>
      </Button>
    </div>
  );
}

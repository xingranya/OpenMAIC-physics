'use client';

/**
 * 教师端 · 教学驾驶舱。
 *
 * 面向任课教师的总览：班级风险分布、模块进度与教学调控建议。
 * 所有数据为课程示例数据；AI 建议只作提示，教师保留最终判断权。
 */

import * as React from 'react';
import { AlertTriangle, ClipboardCheck, Lightbulb, TrendingUp, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePhysicsState } from '@/components/physics/state-provider';
import {
  HintBar,
  MetricTile,
  PageHeader,
  RiskBadge,
  SectionCard,
  SimpleBarChart,
} from '@/components/physics/shared';
import { DEMO_STUDENTS, TEACHING_PLANS } from '@/lib/physics/data';
import { COURSE, SCHOOL } from '@/lib/school';
import { routeFor } from '@/lib/physics/shortcuts';

export function TeacherDashboard() {
  const { state } = usePhysicsState();

  const riskCounts = DEMO_STUDENTS.reduce<Record<string, number>>((acc, student) => {
    acc[student.risk] = (acc[student.risk] ?? 0) + 1;
    return acc;
  }, {});
  const attention = DEMO_STUDENTS.filter(
    (student) => student.risk === '高风险' || student.risk === '关注',
  );

  const moduleProgress = [
    { label: '力学', value: 62 },
    { label: '振动与波', value: 48 },
    { label: '热学', value: 71 },
    { label: '电磁学', value: 39 },
    { label: '光学', value: 55 },
    { label: '近代物理', value: 30 },
  ];

  const averageScore = Math.round(
    DEMO_STUDENTS.reduce((sum, student) => sum + student.score, 0) / DEMO_STUDENTS.length,
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <PageHeader
        title="教学驾驶舱"
        description={`${SCHOOL.college} · ${COURSE.className} · ${COURSE.name} · ${COURSE.teacher}`}
        actions={
          <Badge variant="secondary" className="font-normal">
            课程示例数据
          </Badge>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="班级指标">
        <MetricTile label="班级人数" value={DEMO_STUDENTS.length} unit="人" hint="示例名单" />
        <MetricTile
          label="平均诊断分"
          value={averageScore}
          unit="/100"
          tone={averageScore >= 75 ? 'success' : 'warning'}
        />
        <MetricTile
          label="需关注"
          value={attention.length}
          unit="人"
          tone={attention.length > 2 ? 'danger' : 'warning'}
          hint="关注 + 高风险"
        />
        <MetricTile
          label="已复核"
          value={Object.keys(state.evaluationReviews).length}
          unit="人"
          hint="教师人工复核覆盖"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="风险分布"
          description="按学情诊断与任务进度综合判定"
          action={
            <Button asChild variant="outline" size="sm">
              <a href={routeFor('teacher', 'class')}>
                <Users className="size-3.5" />
                班级画像
              </a>
            </Button>
          }
        >
          <SimpleBarChart
            caption="班级风险分层人数"
            unit=" 人"
            data={[
              { label: '优秀', value: riskCounts['优秀'] ?? 0 },
              { label: '正常', value: riskCounts['正常'] ?? 0 },
              { label: '关注', value: riskCounts['关注'] ?? 0 },
              { label: '高风险', value: riskCounts['高风险'] ?? 0 },
            ]}
          />
        </SectionCard>

        <SectionCard title="模块进度" description="各知识模块的平均完成度">
          <SimpleBarChart caption="各模块平均完成度" unit="%" data={moduleProgress} />
        </SectionCard>
      </div>

      <SectionCard
        title="需要关注的学生"
        description="按风险优先排序，点击进入评价复核"
        action={
          <Button asChild variant="outline" size="sm">
            <a href={routeFor('teacher', 'evaluation')}>
              <ClipboardCheck className="size-3.5" />
              评价复核
            </a>
          </Button>
        }
      >
        <ul className="flex flex-col gap-2">
          {attention.map((student) => (
            <li
              key={student.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-medium">
                  {student.name}
                  <RiskBadge risk={student.risk} />
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  薄弱维度 {student.weakDimension} · 项目「{student.project}」· 进度 {student.progress}%
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-[15px] font-semibold tabular-nums">{student.score}</span>
                {student.risk === '高风险' ? (
                  <AlertTriangle className="size-4 text-[var(--school-danger)]" aria-hidden="true" />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="教学调控建议"
        description="基于模块诊断的启发式建议，可作为讲评课备课参考"
        action={
          <Button asChild variant="ghost" size="sm">
            <a href={routeFor('teacher', 'insights')}>
              <Lightbulb className="size-3.5" />
              教学洞察
            </a>
          </Button>
        }
      >
        <ul className="flex flex-col gap-2.5">
          {TEACHING_PLANS.map((plan) => (
            <li key={plan.id} className="rounded-lg border border-border/70 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                <TrendingUp className="size-3.5 text-primary" aria-hidden="true" />
                {plan.title}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{plan.content}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <HintBar>
        驾驶舱数据来自课程示例名单与本地规则引擎，<strong>非真实教务数据</strong>；
        建议仅供备课参考，最终教学判断由任课教师作出。
      </HintBar>
    </div>
  );
}

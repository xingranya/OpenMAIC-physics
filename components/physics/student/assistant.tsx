'use client';

/**
 * 学生端 · AI 助教「知物」。
 *
 * 助教回答由本地规则引擎产生（离线可用），并在每次回答后引导到
 * AI 智能课堂——那里有真正的多智能体讨论、白板演算与课件。
 */

import * as React from 'react';
import { Bot, Send, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePhysicsState } from '@/components/physics/state-provider';
import { HintBar, PageHeader, SectionCard } from '@/components/physics/shared';
import { aiReply } from '@/lib/physics/engine';
import { AGENT_PERSONAS, getTeacherPersona } from '@/lib/school';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const QUICK_ASKS = [
  '超声测距为什么要除以 2？',
  '实验误差应该怎么分类排查？',
  '牛顿第二定律怎么用来建模？',
  '怎么判断一个方案是否合理？',
  '谐振为什么能提高传输效率？',
  '透镜成像和干涉该怎么区分？',
];

export function StudentAssistant() {
  const { state, update } = usePhysicsState();
  const [draft, setDraft] = React.useState('');
  const persona = getTeacherPersona();

  const send = (question: string) => {
    const text = question.trim();
    if (!text) return;
    update({
      chat: [...state.chat, { role: 'user', text }, { role: 'ai', text: aiReply(text) }],
    });
    setDraft('');
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader
        title="AI 助教 · 知物"
        description="先自己想一步，再来问。助教不会替你完成作业——它用追问和提示把物理链条摆出来。"
        actions={
          <Badge variant="secondary" className="font-normal">
            本地规则引擎 · 离线可用
          </Badge>
        }
      />

      {persona ? (
        <SectionCard title="助教人格" description={persona.persona}>
          <ul className="flex flex-col gap-1">
            {persona.guidelines.map((guideline) => (
              <li key={guideline} className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                {guideline}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2 text-[12.5px] text-muted-foreground">
            口头禅：{persona.catchphrase}
          </p>
        </SectionCard>
      ) : null}

      <SectionCard title="对话" description={`已提问 ${state.chat.filter((m) => m.role === 'user').length} 次`}>
        {state.chat.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Bot className="size-8 text-primary" aria-hidden="true" />
            <p className="text-[13px] text-muted-foreground">
              还没有提问。可以从下面的快捷问题开始，或直接描述你卡住的步骤。
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.chat.map((message, index) => (
              <li
                key={`${message.role}-${index}`}
                className={cn(
                  'max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap',
                  message.role === 'user'
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'border border-border/70 bg-muted/50',
                )}
              >
                <span className="sr-only">{message.role === 'user' ? '我的提问：' : '助教回答：'}</span>
                {message.text}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-border/70 pt-4">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ASKS.map((ask) => (
              <button
                key={ask}
                type="button"
                onClick={() => send(ask)}
                className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {ask}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  send(draft);
                }
              }}
              placeholder="描述你卡住的步骤…（⌘/Ctrl + Enter 发送）"
              rows={3}
              aria-label="向助教提问"
            />
            <Button onClick={() => send(draft)} disabled={draft.trim() === ''}>
              <Send className="size-4" />
              提问
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="课堂里的多智能体" description="AI 智能课堂可让 AI 教师与同学参与讨论、圆桌辩论与白板演算">
        <div className="flex flex-col gap-2">
          {AGENT_PERSONAS.map((item) => (
            <div key={item.id} className="rounded-lg border border-border/70 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
                {item.name}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{item.persona}</p>
            </div>
          ))}
        </div>
        <Button asChild className="mt-4 w-full">
          <Link href="/">进入 AI 智能课堂</Link>
        </Button>
      </SectionCard>

      <HintBar>
        助教回答由本地规则引擎生成，不调用外部大模型，因此断网时依然可用；
        需要真正的多智能体讨论与课件生成时，请进入 AI 智能课堂。
      </HintBar>
    </div>
  );
}

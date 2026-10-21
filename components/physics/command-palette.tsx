'use client';

/**
 * 命令面板：⌘K / Ctrl+K 唤起，支持中文与拼音首字母过滤。
 */

import * as React from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileBarChart,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Library,
  Lightbulb,
  ListChecks,
  LogOut,
  Network,
  RotateCcw,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ShortcutBinding } from '@/lib/physics/shortcuts';
import type { UserRole } from '@/lib/physics/types';

const iconMap: Record<string, React.ElementType> = {
  overview: LayoutDashboard,
  dashboard: LayoutDashboard,
  diagnosis: ClipboardCheck,
  curriculum: Network,
  projects: Library,
  tasks: ListChecks,
  assistant: Bot,
  lab: FlaskConical,
  report: FileBarChart,
  class: Users,
  evaluation: ClipboardCheck,
  insights: Lightbulb,
  'open-shortcuts-help': FileText,
  'goto-ai-classroom': Sparkles,
  logout: LogOut,
  reset: RotateCcw,
  default: ArrowRight,
};

function iconFor(binding: ShortcutBinding): React.ElementType {
  if (binding.action.type === 'navigate') {
    return iconMap[binding.action.view] ?? iconMap.default;
  }
  return iconMap[binding.action.id] ?? iconMap.default;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: UserRole | null;
  shortcuts: ShortcutBinding[];
  onSelect: (binding: ShortcutBinding) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  role,
  shortcuts,
  onSelect,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    // 延后重置，避免在 effect体内同步 setState。
    window.queueMicrotask(() => {
      setQuery('');
      setActiveIndex(0);
    });
    window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  const filtered = React.useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return shortcuts;
    return shortcuts.filter((binding) => {
      const label = binding.label.toLowerCase();
      const hint = binding.hint.toLowerCase();
      return label.includes(lower) || hint.includes(lower);
    });
  }, [query, shortcuts]);

  // 列表变短时夹紧当前索引，而不是每次按键都重置。
  const clampedActiveIndex =
    filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1);

  const pick = (binding: ShortcutBinding) => {
    onOpenChange(false);
    onSelect(binding);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % Math.max(1, filtered.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(
        (index) => (index - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[clampedActiveIndex];
      if (target) pick(target);
    } else if (event.key === 'Escape') {
      onOpenChange(false);
    }
  };

  const groups = React.useMemo(() => {
    const seen: Record<string, ShortcutBinding[]> = {};
    filtered.forEach((binding) => {
      const key =
        binding.scope === 'global' ? '操作' : role === 'teacher' ? '教师工作台' : '学生工作台';
      seen[key] = seen[key] ? [...seen[key], binding] : [binding];
    });
    return Object.entries(seen);
  }, [filtered, role]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg overflow-hidden p-0"
        onKeyDown={onKeyDown}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">命令面板</DialogTitle>
        <DialogDescription className="sr-only">
          通过命令面板快速跳转页面或触发操作。
        </DialogDescription>
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入以过滤命令…（支持拼音 / 中文）"
            aria-label="命令搜索"
            className="h-10"
          />
          <p className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
              ↑
            </kbd>
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
              ↓
            </kbd>
            选择 ·
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
              ↵
            </kbd>
            执行 ·
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
              esc
            </kbd>
            关闭
          </p>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              没有匹配「{query}」的命令。
            </div>
          ) : null}
          {groups.map(([groupLabel, items]) => (
            <div key={groupLabel} className="mb-2 last:mb-0">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {groupLabel}
              </p>
              <ul role="listbox" aria-label={groupLabel}>
                {items.map((binding) => {
                  const index = filtered.indexOf(binding);
                  const Icon = iconFor(binding);
                  const active = index === clampedActiveIndex;
                  return (
                    <li key={binding.label}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => pick(binding)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-[var(--school-primary-softer)] dark:hover:bg-primary/10',
                        )}
                      >
                        <span
                          className={cn(
                            'grid size-7 shrink-0 place-items-center rounded-md',
                            active
                              ? 'bg-white/15 text-white'
                              : 'bg-[var(--school-primary-softer)] text-primary dark:bg-primary/15',
                          )}
                        >
                          <Icon className="size-3.5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {binding.label}
                          </span>
                          {binding.combo ? (
                            <span
                              className={cn(
                                'mt-0.5 block font-mono text-[10px] uppercase tracking-[0.14em]',
                                active ? 'text-white/80' : 'text-muted-foreground',
                              )}
                            >
                              {binding.combo.split('').join(' ')}
                            </span>
                          ) : null}
                        </span>
                        <ArrowRight
                          className={cn(
                            'size-3.5 shrink-0',
                            active ? 'text-white' : 'text-muted-foreground',
                          )}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span>
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
              g
            </kbd>
            然后按字母跳转 ·
            <kbd className="ml-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
              ⌘ K
            </kbd>
            打开面板
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--school-success)]">
            <CheckCircle2 className="size-3" />
            {filtered.length} 条命令
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

/**
 * 键盘快捷键 Hook。
 *
 * 顶层监听 keydown：⌘K / Ctrl+K 打开命令面板，"?" 打开快捷键帮助，
 * "g + 字母" 执行序列跳转。输入框、文本域与可编辑区域内的按键不参与。
 */

import * as React from 'react';

import {
  findShortcutByCombo,
  isEditableTarget,
  shortcuts,
  type ShortcutBinding,
} from './shortcuts';
import { routeFor } from './shortcuts';
import type { UserRole } from './types';

interface UseShortcutsOptions {
  role: UserRole | null;
  navigate: (route: string) => void;
  onCommand?: (id: string) => void;
  onShowHelp?: () => void;
}

interface ShortcutState {
  buffer: string;
  lastKeyAt: number;
}

/** 序列键缓冲的复位窗口。 */
const BUFFER_RESET_MS = 1200;

export function useShortcuts({ role, navigate, onCommand, onShowHelp }: UseShortcutsOptions) {
  const [open, setOpen] = React.useState(false);
  const stateRef = React.useRef<ShortcutState>({ buffer: '', lastKeyAt: 0 });

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      // 命令面板：⌘K / Ctrl+K —— 即便在文本框也允许，提供引导。
      if (isMod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (!isMod && event.key === '?' && !isEditableTarget(event.target)) {
        event.preventDefault();
        if (onShowHelp) onShowHelp();
        return;
      }
      if (isMod || event.altKey || isEditableTarget(event.target)) return;

      const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
      if (key.length !== 1) return;

      const fresh = Date.now() - stateRef.current.lastKeyAt < BUFFER_RESET_MS;
      const next = fresh ? `${stateRef.current.buffer} ${key}` : key;
      stateRef.current = { buffer: next, lastKeyAt: Date.now() };
      const combo = next.trim();
      const binding = findShortcutByCombo(role, combo);
      if (binding) {
        event.preventDefault();
        stateRef.current = { buffer: '', lastKeyAt: 0 };
        if (binding.action.type === 'navigate') {
          navigate(routeFor(binding.action.role, binding.action.view));
        } else if (binding.action.type === 'command') {
          if (onCommand) onCommand(binding.action.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, navigate, onCommand, onShowHelp]);

  return {
    open,
    setOpen,
    shortcuts: shortcuts.filter(
      (binding) => binding.scope === 'global' || (role !== null && binding.scope === role),
    ),
  };
}

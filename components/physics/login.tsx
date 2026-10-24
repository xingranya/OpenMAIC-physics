'use client';

/**
 * 物理工作台登录页。
 *
 * ## 两条路径
 *
 * 1. **注册 + 登录**（主路径）：账号由用户自己创建，密码用 PBKDF2 哈希后
 *    存在**本浏览器**里，登录时校验。账号系统不接数据库、不连教务系统，
 *    换浏览器需要重新注册——这一点在页面上写明，不含糊。
 * 2. **一键进入**（访客体验）：以预置演示身份直接进入，不校验口令。
 *    现场演示与应急动线都依赖它，所以保留。
 *
 * 演示快捷入口：`/login?demo=student` 或 `/login?demo=teacher` 会直接以该角色进入。
 * **角色门禁依然存在**：未登录直接访问 `/physics/*` 仍会被重定向回登录页。
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, GraduationCap, Sparkles, UserCog, UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePhysicsState } from '@/components/physics/state-provider';
import { BRAND_FULL_NAME, COURSE, DEMO, PLATFORM, SCHOOL } from '@/lib/school';
import { DEMO_HINT } from '@/lib/physics/session';
import { routeFor } from '@/lib/physics/shortcuts';
import type { AccountErrorCode } from '@/lib/physics/accounts';

type AuthTab = 'login' | 'register';

/** 账号域的错误码 → 人话。**逐项可区分**，界面要能说清到底哪里不对。 */
const ERROR_MESSAGES: Record<AccountErrorCode, string> = {
  'username-required': '请填写账号。',
  'username-too-short': '账号至少 3 个字符。',
  'username-too-long': '账号最多 32 个字符。',
  'username-invalid': '账号只能包含字母、数字、下划线、连字符或中文。',
  'username-taken': '这个账号已被占用，换一个试试。',
  'username-reserved': '这个账号是演示账号，请换一个。',
  'password-required': '请填写密码。',
  'password-too-short': '密码至少 8 位。',
  'password-too-long': '密码最多 128 位。',
  'display-name-too-long': '显示名最多 24 个字符。',
  'role-invalid': '请选择身份。',
  'invalid-credentials': '账号或密码不正确。',
  'storage-unavailable': '当前浏览器不允许保存账号，无法完成注册。',
  'storage-corrupt': '本地账号数据已损坏，已自动备份原数据。请清除本站数据后重新注册。',
};

export function PhysicsLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, register, enterAsDemo, session } = usePhysicsState();
  const [tab, setTab] = React.useState<AuthTab>('login');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [role, setRole] = React.useState<'student' | 'teacher'>('student');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const demoRole = searchParams.get('demo');
  const autoEntered = React.useRef(false);

  // 命中演示快捷入口时以该角色为准，否则沿用已有会话。
  const demoHint = React.useMemo(
    () => DEMO_HINT.find((item) => item.role === demoRole),
    [demoRole],
  );

  React.useEffect(() => {
    // 已有会话且没有指定演示角色时，按角色跳转。
    if (session && !demoHint) {
      router.replace(routeFor(session.role, session.role === 'student' ? 'overview' : 'dashboard'));
    }
  }, [router, session, demoHint]);

  // 演示快捷入口：直接以该演示身份进入。
  // 即使当前已有其他角色的会话也要执行——访问 ?demo=teacher 本身就是
  // "我要以教师身份进入"的明确意图，演示现场常在同一个标签里先学生后教师。
  React.useEffect(() => {
    if (autoEntered.current || !demoHint) return;
    autoEntered.current = true;
    enterAsDemo(demoHint.role);
    router.replace(routeFor(demoHint.role, demoHint.role === 'student' ? 'overview' : 'dashboard'));
  }, [demoHint, router, enterAsDemo]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const outcome =
        tab === 'register'
          ? await register({ username, password, displayName, role })
          : await signIn(username, password);
      if (!outcome.ok) {
        setError(ERROR_MESSAGES[outcome.error] ?? '操作失败，请重试。');
        return;
      }
      // 落点按**会话里的角色**决定：教师进驾驶舱，学生进学习总览。
      router.replace(
        routeFor(
          outcome.session.role,
          outcome.session.role === 'teacher' ? 'dashboard' : 'overview',
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (demoUsername: string) => {
    setTab('login');
    setUsername(demoUsername);
    setPassword(DEMO.password);
    setError(null);
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-muted/40 px-4 py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[url('/brand/teaching-login-bg.jpg')] bg-cover bg-center opacity-[0.12]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/4 size-96 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-border/70 bg-background/95 p-7 shadow-2xl backdrop-blur">
          <div className="flex flex-col items-center text-center">
            {/* 这里用**方形圆章**而不是 260×60 的品牌横幅：
                横幅自带书法校名，深色主题下深色笔画会整片消失，
                而且下面的文字已经把校名说清楚了，重复一遍反而更糊。 */}
            <img
              src={SCHOOL.emblemMarkSrc}
              alt={`${SCHOOL.college} 校徽`}
              width={62}
              height={60}
              className="h-14 w-14 object-contain"
            />
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {SCHOOL.college}
            </p>
            <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{PLATFORM.systemName}</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {PLATFORM.tagline}
            </p>
          </div>

          {/* 登录 / 注册 切换 */}
          <div
            role="tablist"
            aria-label="登录或注册"
            className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1"
          >
            {(['login', 'register'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={tab === item}
                onClick={() => {
                  setTab(item);
                  setError(null);
                }}
                className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                  tab === item
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {item === 'login' ? '登录' : '注册新账号'}
              </button>
            ))}
          </div>

          <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
            <div>
              <label
                htmlFor="physics-username"
                className="mb-1.5 block text-[12px] font-medium text-foreground"
              >
                账号
              </label>
              <Input
                id="physics-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={tab === 'register' ? '自己起一个账号，如 2026010118' : '输入账号'}
                autoComplete="username"
                autoFocus
              />
            </div>

            {tab === 'register' ? (
              <div>
                <label
                  htmlFor="physics-display-name"
                  className="mb-1.5 block text-[12px] font-medium text-foreground"
                >
                  显示名（选填）
                </label>
                <Input
                  id="physics-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="留空则用账号"
                  autoComplete="name"
                />
              </div>
            ) : null}

            {tab === 'register' ? (
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-foreground">身份</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['student', 'teacher'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setRole(item)}
                      aria-pressed={role === item}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] transition-colors ${
                        role === item
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/40'
                      }`}
                    >
                      {item === 'student' ? (
                        <GraduationCap className="size-3.5" aria-hidden="true" />
                      ) : (
                        <UserCog className="size-3.5" aria-hidden="true" />
                      )}
                      {item === 'student' ? '学生' : '教师'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="physics-password"
                className="mb-1.5 block text-[12px] font-medium text-foreground"
              >
                密码
              </label>
              <div className="relative">
                <Input
                  id="physics-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={tab === 'register' ? '至少 8 位' : '输入密码'}
                  autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p role="alert" className="text-[12px] text-destructive">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="mt-1 w-full" disabled={busy}>
              {busy ? '处理中…' : tab === 'register' ? '注册并进入' : '登录'}
              {tab === 'register' ? (
                <UserPlus className="size-4" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </Button>

            {tab === 'register' ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                账号保存在<strong className="font-medium text-foreground">本浏览器</strong>
                里（密码经 PBKDF2 哈希后存储，不保存明文）。
                本产品不接数据库、不连教务系统——换浏览器或换设备需要重新注册。
              </p>
            ) : null}
          </form>

          <div className="mt-5 rounded-lg border border-dashed border-border p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              访客体验（演示账号）
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {DEMO_HINT.map((hint) => (
                <li key={hint.role} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="inline-flex items-center gap-1.5">
                    {hint.role === 'student' ? (
                      <GraduationCap
                        className="size-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : (
                      <UserCog className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    )}
                    {hint.label} · {hint.username}
                  </span>
                  <button
                    type="button"
                    onClick={() => fillDemo(hint.username)}
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    填入
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              统一密码 <code className="font-mono">{DEMO.password}</code> · 演示学生{' '}
              {DEMO.studentName}（{DEMO.studentClassName}）· 任课教师 {COURSE.teacher}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-dashed border-border pt-3">
              <span className="self-center text-[11px] text-muted-foreground">一键进入：</span>
              {DEMO_HINT.map((hint) => (
                <Link
                  key={hint.role}
                  href={`/login?demo=${hint.role}`}
                  className="rounded-full border border-primary/40 px-2.5 py-1 text-[11.5px] text-primary transition-colors hover:border-primary hover:bg-primary/5"
                >
                  {hint.role === 'student' ? '学生视角' : '教师视角'}
                </Link>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              「一键进入」是以预置演示身份直接体验产品，不校验口令；
              你的学习记录同样保存在本浏览器，与注册账号互不可见。
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center gap-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
            <Sparkles className="size-3.5" />
            直接进入 AI 智能课堂
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {BRAND_FULL_NAME} · {PLATFORM.tagline}
          </p>
          <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
            账号仅用于当前产品的登录校验，不连接真实教务系统、统一身份认证或大模型。
          </p>
        </div>
      </div>
    </div>
  );
}

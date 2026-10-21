'use client';

/**
 * 物理工作台登录页。
 *
 * 账号用于当前产品的登录校验，不连接真实教务系统、统一身份认证或大模型。
 * 登录后按角色进入学生工作台 / 教师驾驶舱。
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, GraduationCap, Sparkles, UserCog } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePhysicsState } from '@/components/physics/state-provider';
import { BRAND_FULL_NAME, COURSE, DEMO, PLATFORM, SCHOOL } from '@/lib/school';
import { DEMO_HINT } from '@/lib/physics/session';
import { routeFor } from '@/lib/physics/shortcuts';

export function PhysicsLogin() {
  const router = useRouter();
  const { signIn, session } = usePhysicsState();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (session) {
      router.replace(routeFor(session.role, session.role === 'student' ? 'overview' : 'dashboard'));
    }
  }, [router, session]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!signIn(username, password)) {
      setError('账号或密码不正确。演示账号见下方提示。');
      return;
    }
  };

  const fillDemo = (demoUsername: string) => {
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
            <img
              src={SCHOOL.emblemSrc}
              alt={`${SCHOOL.college} 校徽`}
              width={260}
              height={60}
              className="h-12 w-auto object-contain"
            />
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {SCHOOL.college}
            </p>
            <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{PLATFORM.systemName}</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {PLATFORM.tagline}
            </p>
          </div>

          <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
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
                placeholder="student 或 teacher"
                autoComplete="username"
                autoFocus
              />
            </div>
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
                  placeholder="演示密码"
                  autoComplete="current-password"
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

            <Button type="submit" className="mt-1 w-full">
              登录
              <ArrowRight className="size-4" />
            </Button>
          </form>

          <div className="mt-5 rounded-lg border border-dashed border-border p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              演示账号
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {DEMO_HINT.map((hint) => (
                <li key={hint.role} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="inline-flex items-center gap-1.5">
                    {hint.role === 'student' ? (
                      <GraduationCap className="size-3.5 text-muted-foreground" aria-hidden="true" />
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
              统一密码 <code className="font-mono">{DEMO.password}</code> · 演示学生 {DEMO.studentName}
              （{DEMO.studentClassName}）· 任课教师 {COURSE.teacher}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col items-center gap-2 text-center">
          <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
            <Sparkles className="size-3.5" />
            直接进入 AI 智能课堂
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {BRAND_FULL_NAME} · 基于 OpenMAIC 二次开发
          </p>
          <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
            账号仅用于当前产品的登录校验，不连接真实教务系统、统一身份认证或大模型。
          </p>
        </div>
      </div>
    </div>
  );
}

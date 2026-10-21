'use client';

import { useEffect, useState, ReactNode } from 'react';
import { AccessCodeModal } from '@/components/access-code-modal';
import { resolveAccessGate } from '@/lib/access-code-gate';
import { useSettingsStore } from '@/lib/store/settings';

export function AccessCodeGuard({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{
    enabled: boolean;
    authenticated: boolean;
    loading: boolean;
  }>({ enabled: false, authenticated: false, loading: true });

  useEffect(() => {
    let cancelled = false;
    const settle = (next: { enabled: boolean; authenticated: boolean }) => {
      if (!cancelled) setStatus({ ...next, loading: false });
    };

    fetch('/api/access-code/status')
      .then(async (res) => {
        // 响应体不是合法 JSON 时按 `undefined` 处理，交给判定函数走
        // "非预期响应 → 按未授权处理"这条分支，而不是冒泡成网络失败。
        const body = await res.json().catch(() => undefined);
        settle(resolveAccessGate({ kind: 'response', status: res.status, body }));
      })
      .catch(() => {
        // 只有 fetch 本身失败（连接被拒 / 超时 / DNS 失败）才到这里：
        // 服务端联系不上，弹访问码框只会挡住断网演示。
        //
        // 放行也不会削弱安全：真正的鉴权在服务端——未授权的 API 一律 401，
        // 客户端这道门只是体验层。服务不可达时内容照常渲染、交互自然降级，
        // 但服务端仍然照常拒绝未授权请求。
        settle(resolveAccessGate({ kind: 'network-error' }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsAuth = !status.loading && status.enabled && !status.authenticated;

  return (
    <>
      {needsAuth && (
        <AccessCodeModal
          open={true}
          onSuccess={() => {
            setStatus((s) => ({ ...s, authenticated: true }));
            // ServerProvidersInit runs on mount, which on an ACCESS_CODE-gated
            // deployment is before any access cookie exists: the middleware
            // answers 401 and the store silently keeps its blank defaults.
            // Nothing re-fetches afterwards, so every server-configured
            // provider reads as unconfigured until a manual reload. Re-fetch
            // now that the request will be authorized.
            void useSettingsStore.getState().fetchServerProviders();
          }}
        />
      )}
      {children}
    </>
  );
}

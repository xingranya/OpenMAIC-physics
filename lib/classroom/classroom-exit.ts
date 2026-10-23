export type ClassroomExitDecision = { readonly kind: 'push'; readonly href: '/' };

interface ClassroomExitContext {
  readonly searchParams: Pick<URLSearchParams, 'get'>;
}

interface ClassroomExitRouter {
  readonly push: (href: string) => void;
}

/**
 * Resolve where a standalone classroom should exit without depending on
 * browser globals, so direct links and SSR callers get the same safe default.
 *
 * A classic classroom always exits to home. The previous history entry is
 * often an entry-time flow (generation-preview) that is not a return target —
 * backing into it shows a dead "no generation in progress" page — so browser
 * history is never used for the classic arrow, which is labeled "back to
 * home" anyway.
 *
 * 上游的「返回工作台」分支（`from=workspace`）已随 `/workspace` 一并移除：
 * 工作台不存在了，指针就没有合法的落点，留着只会让退出去向指向一个 404。
 */
export function resolveClassroomExit({
  searchParams,
}: ClassroomExitContext): ClassroomExitDecision {
  // Leaving Pro playback opens the ordinary classroom with an explicit home
  // return contract. Browser history may still contain a stale entry, so
  // without this rule the home arrow would contradict it.
  if (searchParams.get('returnTo') === 'home') {
    return { kind: 'push', href: '/' };
  }
  return { kind: 'push', href: '/' };
}

/** Resolve against the current browser, then perform the selected exit. */
export function exitClassroom(
  router: ClassroomExitRouter,
  searchParams: Pick<URLSearchParams, 'get'>,
): void {
  router.push(resolveClassroomExit({ searchParams }).href);
}

export function classroomExitLabelKey(): 'generation.backToHome' {
  return 'generation.backToHome';
}

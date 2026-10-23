import { describe, expect, it, vi } from 'vitest';
import {
  classroomExitLabelKey,
  exitClassroom,
  resolveClassroomExit,
} from '@/lib/classroom/classroom-exit';

const params = (query = '') => new URLSearchParams(query);

describe('resolveClassroomExit', () => {
  it('goes home for a classic classroom even when browser history exists', () => {
    // The previous history entry is often an entry-time flow (generation-preview)
    // that must never be a return target, so the classic arrow always pushes home.
    expect(resolveClassroomExit({ searchParams: params() })).toEqual({ kind: 'push', href: '/' });
  });

  it('falls back to home for a direct link such as /shared/<token>', () => {
    expect(resolveClassroomExit({ searchParams: params() })).toEqual({ kind: 'push', href: '/' });
  });

  it('returns to home explicitly instead of reopening Pro through browser history', () => {
    expect(resolveClassroomExit({ searchParams: params('returnTo=home') })).toEqual({
      kind: 'push',
      href: '/',
    });
  });

  it('never points at the removed Pro workspace', () => {
    // `/workspace` no longer exists: a stale `from=workspace` link must not
    // resurrect a destination that would 404.
    expect(resolveClassroomExit({ searchParams: params('from=workspace') })).toEqual({
      kind: 'push',
      href: '/',
    });
  });
});

describe('exitClassroom', () => {
  it('pushes the resolved destination and never uses browser history', () => {
    const router = { push: vi.fn() };

    exitClassroom(router, params());

    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('pushes home even for a stale workspace-attached link', () => {
    const router = { push: vi.fn() };

    exitClassroom(router, params('from=workspace'));

    expect(router.push).toHaveBeenCalledWith('/');
  });
});

describe('classroom navigation metadata', () => {
  it('always uses home copy for the classroom exit', () => {
    expect(classroomExitLabelKey()).toBe('generation.backToHome');
  });
});

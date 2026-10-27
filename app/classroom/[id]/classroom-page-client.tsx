'use client';

import { ClassroomSurface } from '@/components/classroom/ClassroomSurface';

/**
 * 课堂页的客户端部分。
 *
 * 从 `page.tsx` 抽出来，是因为外壳要在**服务端**判 404：`useParams()` 拿不到
 * 结果之前没法做任何判定，而那时响应头（200）已经发出去了。
 */
export function ClassroomPageClient({ classroomId }: { classroomId: string }) {
  return <ClassroomSurface classroomId={classroomId} variant="page" />;
}

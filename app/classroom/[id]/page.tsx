import { notFound } from 'next/navigation';
import { isValidClassroomId } from '@/lib/classroom/id';
import { ClassroomPageClient } from './classroom-page-client';

/**
 * 课堂播放页。
 *
 * ## 为什么外壳在服务端
 *
 * 原先这里是一个纯客户端组件，用 `useParams()` 取 id。问题是**响应头在客户端
 * 代码跑起来之前就发出去了**：`/classroom/not-a-classroom` 拿到的是 200，
 * 页面再自己渲染「课堂不存在」。对用户是「先白屏一下再说不存在」，
 * 对爬虫/监控是「这个 URL 有效」。
 *
 * 现在形状非法的 id 在服务端就 `notFound()`，直接 404。
 *
 * ## 为什么只判形状，不查存在性
 *
 * 存在性**不能**在服务端判，三个理由任一都成立：
 *
 * 1. `lib/classroom/load-classroom.ts` 是「先 IndexedDB，再服务端」——
 *    大量课堂只存在于浏览器里，服务端查不到就 404 等于误杀；
 * 2. `readClassroom` 对生成中的课堂（`reserved`）返回 `null`，
 *    正在生成时打开链接会被判成不存在；
 * 3. 课堂数据落在云函数的本地文件（见 `deploy/README.md` 的互斥项说明），
 *    多实例下 A 实例写的文件 B 实例读不到，服务端判定本身就不可信。
 *
 * 所以「形状合法但确实不存在」仍交给 `ClassroomSurface` 的终态 UI——
 * 它还能区分 `absent`（真没有）与 `unavailable`（服务端暂时答不上来），
 * 这个区分服务端做不到。
 */
export default async function ClassroomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidClassroomId(id)) notFound();

  return <ClassroomPageClient classroomId={id} />;
}

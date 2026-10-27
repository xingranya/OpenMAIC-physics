/**
 * 课堂 id 的形状校验。
 *
 * ## 为什么单独一个文件
 *
 * 这段判断有两个使用方，而它们的运行时约束完全相反：
 *
 * - **服务端**（`lib/server/classroom-storage.ts`、各 API 路由）需要它，
 *   但那个文件 `import fs`，页面组件引用它会把 Node 模块拖进客户端图；
 * - **页面**（`app/classroom/[id]/page.tsx`）也要它，用来在**服务端**把
 *   形状非法的 id 直接判成 404，而不是渲染一个「加载中 → 不存在」的 200。
 *
 * 所以把它抽成一个零依赖模块：两边都能引，谁也不用迁就谁。
 */

/** 课堂 id 允许的字符与长度。生成侧是 `nanoid(10)`，留出余量到 64。 */
const CLASSROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * 这个字符串能不能当作课堂 id。
 *
 * 只判**形状**，不判存在性——存在性必须由调用方按自己的数据源决定：
 * 服务端有文件存储，客户端还有 IndexedDB（`load-classroom.ts` 先读它），
 * 两者覆盖的课堂集合并不相同。
 */
export function isValidClassroomId(id: unknown): id is string {
  return typeof id === 'string' && CLASSROOM_ID_PATTERN.test(id);
}

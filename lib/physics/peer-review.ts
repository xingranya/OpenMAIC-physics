/**
 * 组内互评：团队合作维度「评」这一环的证据来源。
 *
 * ## 为什么互评要单独一层
 *
 * 量化评价表里，团队合作的评价证据写的是「分工表 / 任务日志 / 作品版本 /
 * **匿名互评**及 AI 证据摘要」，核验指标是「贡献证据可追溯率」。
 * 前两类有现成载体（`preClass.groupRole`、`taskChecks`），作品版本由
 * `ArtifactVersion` 承担，**互评此前完全没有**——没有互评，
 * 「贡献大小」就只能由 AI 从发言条数里猜，那正是申请书批评的
 * 「机器评价的机械性和单一化」。
 *
 * ## 匿名是单向的
 *
 * 互评对**同组同学**匿名（界面上只显示「组内 3 人已评」），对**教师**实名
 * （教师复核时要能追问「这条为什么给 60 分」）。两个方向相反不是矛盾：
 * 学生之间看得到名字，评价会变成人情分；教师看不到名字，复核就无从下手。
 *
 * ## 为什么成员是算出来的而不是让教师录
 *
 * 课堂现场没有时间维护一份成员名单。组员由「同一层级 + 同一组号」从班级
 * 名册稳定推导，刷新不变，教师也不用额外操作。代价是：**跨真实班级时
 * 这套推导不成立**，需要在服务端接入教务名单才能换掉——这条边界写在
 * 页面提示里，不假装已经支持。
 *
 * ## 演示名册会补人，真实名册不会
 *
 * 演示名册只有 6 人，却要分到 4 个组里，纯靠哈希有相当概率「本组除我之外
 * 没人」——界面会显示「还没有同组同学」，看着像坏掉。所以**只在调用方没传
 * `roster` 时**按组号确定性地补到 3 人；传了真实名单就照名单来，一个人都
 * 不编。编出来的同组同学比一个空列表更糟，这条界线不能糊。
 */

import { DEMO_STUDENTS } from './data';
import { assignGroup, groupRolesOf } from './stages';
import type { AbilityTier, PeerReview } from './types';

export interface GroupMember {
  id: string;
  name: string;
  /** 组内分工。 */
  role: string;
  isSelf: boolean;
  /** 是否已经给这位同学写过互评。 */
  reviewed: boolean;
}

/**
 * 一个小组最少要有几个人（含本人）。
 *
 * 演示名册只有 6 人，却要分到 4 个组里：纯靠哈希推导，
 * 有相当概率「本组除我之外一个人都没有」，界面上就显示
 * 「还没有同组同学」——看着像坏掉，其实是名册太小。
 * 所以演示模式（调用方没传 roster）下补足到 3 人。
 */
const MIN_GROUP_SIZE = 3;

/**
 * 推导当前学生所在小组的成员。
 *
 * `roster` 可注入，便于测试与将来接真实名单。**注入名单时不补人**：
 * 真实班级有多少人就是多少人，编出来的同学比空列表更糟。
 */
export function groupMembersOf(input: {
  studentId: string;
  studentName: string;
  tier: AbilityTier;
  reviews?: readonly PeerReview[];
  roster?: readonly { id: string; name: string }[];
}): GroupMember[] {
  const { studentId, studentName, tier, reviews = [], roster } = input;
  const self = assignGroup(tier, studentId);
  const roles = groupRolesOf(tier);
  // 演示名册只带姓名，没有账号 id（那是真实登录才有的东西）。这里用
  // `demo:<姓名>` 造一个**稳定**的合成 id：分组哈希与「是否已评」都要一个
  // 跨刷新不变的键，而姓名在名册内唯一，正好够用。等接入真实名单后，
  // 调用方传 `roster` 就能整体换掉这段推导。
  const demoMode = roster === undefined;
  const base =
    roster ??
    [
      { id: studentId, name: studentName },
      ...DEMO_STUDENTS.map((student) => ({ id: `demo:${student.name}`, name: student.name })),
    ];

  const sameGroup = base.filter((person) => assignGroup(tier, person.id).groupId === self.groupId);
  const people = [...sameGroup];

  if (demoMode && people.length < MIN_GROUP_SIZE) {
    // 按组号确定性地补人：同一组号每次补到的是同一批人，
    // 换一个组号补到的是另一批——刷新多少次都不会变。
    const groupNo = Number(/(\d+)/.exec(self.groupId)?.[1] ?? '1');
    const pool = base.filter((person) => !people.some((item) => item.id === person.id));
    if (pool.length > 0) {
      const offset = ((groupNo - 1) * (MIN_GROUP_SIZE - 1)) % pool.length;
      const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
      people.push(...rotated.slice(0, MIN_GROUP_SIZE - people.length));
    }
  }

  // 名册里同一个 id 出现两次（手抄名单常见）只算一个人。
  const seen = new Set<string>();
  const unique = people.filter((person) => {
    if (seen.has(person.id)) return false;
    seen.add(person.id);
    return true;
  });

  // 本人排第一：界面上「我」永远在最上面，后面的才是要评的人。
  unique.sort((left, right) =>
    left.id === studentId ? -1 : right.id === studentId ? 1 : 0,
  );

  // 分工按组内顺序错开，避免三个人拿到同一个分工。
  const selfRoleIndex = Math.max(0, roles.indexOf(self.groupRole));
  const reviewedIds = new Set(reviews.map((item) => item.targetId));

  return unique.map((person, index) => ({
    id: person.id,
    name: person.name,
    role: roles[(selfRoleIndex + index) % roles.length] ?? self.groupRole,
    isSelf: person.id === studentId,
    reviewed: reviewedIds.has(person.id),
  }));
}

/** 互评填写的校验。返回 null 表示通过。 */
export function validatePeerReview(input: {
  contribution: number;
  cooperation: number;
  note: string;
}): string | null {
  const { contribution, cooperation, note } = input;
  if (!Number.isFinite(contribution) || contribution < 0 || contribution > 100) {
    return '贡献度需要在 0–100 之间。';
  }
  if (!Number.isFinite(cooperation) || cooperation < 0 || cooperation > 100) {
    return '协作表现需要在 0–100 之间。';
  }
  // 没有依据的互评在复核时没有价值，所以强制写一句。
  if (note.trim().length < 4) {
    return '请写一句依据（至少 4 个字）：你看到对方做了什么。';
  }
  return null;
}

/** 一名同学收到的互评汇总。 */
export interface PeerSummary {
  targetId: string;
  targetName: string;
  count: number;
  /** 平均贡献度（无数据时为 null，不要用 0 冒充）。 */
  avgContribution: number | null;
  avgCooperation: number | null;
  /** 依据摘要，教师复核时直接看这几句。 */
  notes: readonly string[];
}

/** 按被评人聚合互评。 */
export function summarisePeerReviews(
  reviews: readonly PeerReview[],
): PeerSummary[] {
  const buckets = new Map<string, PeerReview[]>();
  reviews.forEach((review) => {
    const list = buckets.get(review.targetId);
    if (list) list.push(review);
    else buckets.set(review.targetId, [review]);
  });

  return [...buckets.entries()]
    .map(([targetId, list]) => ({
      targetId,
      targetName: list[0]?.targetName ?? targetId,
      count: list.length,
      avgContribution: Math.round(
        list.reduce((sum, item) => sum + item.contribution, 0) / list.length,
      ),
      avgCooperation: Math.round(
        list.reduce((sum, item) => sum + item.cooperation, 0) / list.length,
      ),
      notes: list.map((item) => item.note).filter((note) => note.trim().length > 0),
    }))
    .sort((left, right) => right.count - left.count || left.targetName.localeCompare(right.targetName));
}

/** 组内互评完成度：应评人数（不含本人）里已评的比例。 */
export function peerReviewCoverage(members: readonly GroupMember[]): {
  done: number;
  total: number;
} {
  const peers = members.filter((member) => !member.isSelf);
  return { done: peers.filter((member) => member.reviewed).length, total: peers.length };
}

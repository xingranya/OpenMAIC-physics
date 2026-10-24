/**
 * Deployment-wide owner identity, for single-tenant installations.
 *
 * Course documents, folders, materials and agent sessions are partitioned by an
 * owner id. Without a host auth layer that id comes from a 30-day anonymous
 * cookie (`./owner.ts`), which means one physical browser is one learner: a
 * second browser sees an empty course list, a cleared cookie looks like a new
 * installation, and `POST /api/stages/[id]/publish` refuses every owner because
 * publishing an anonymous partition is not something the product allows.
 *
 * For one team behind one shared access gate that partitioning buys nothing — those
 * visitors already share the site password and can read each other's courses by
 * id. `PERSISTENCE_SHARED_OWNER_ID`
 * replaces the cookie-derived id with that fixed value, so the deployment has
 * one course library, and publishing works.
 *
 * It **requires a site-wide access gate**, and refuses to run without one: see the
 * note in {@link resolveSharedOwnerId}. It is also not a substitute for server
 * persistence — Postgres answers where courses live, this answers who owns
 * them, and a multi-user or multi-instance deployment still wants the former.
 *
 * Unset — the default — changes nothing: every request keeps resolving to its
 * cookie partition.
 */

const SHARED_OWNER_ENV = 'PERSISTENCE_SHARED_OWNER_ID';

/**
 * The value becomes an owner id and part of material object keys, so it is
 * restricted to characters that survive that path unchanged. `:` is excluded,
 * which also rules out the reserved `anon:` prefix — an id in that namespace
 * would still be refused by `publish` and would alias onto a cookie owner.
 */
const SHARED_OWNER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * The configured shared owner id, or `undefined` when the deployment has none.
 *
 * Read from the environment on each call so a value changed for a test is
 * observed without a module reload, matching `allowLocalNetworksEnabled()` in
 * `lib/server/ssrf-guard.ts`.
 *
 * An empty or whitespace-only value is treated as unset rather than rejected:
 * a blank variable is how `KEY=` in an env file reads, and it cannot be told
 * apart from an operator who meant to leave the feature off. Any other
 * malformed value throws instead of being ignored — silently falling back to
 * cookie owners would reproduce exactly the confusing behaviour this setting
 * exists to remove. `instrumentation.ts` calls this at startup so the mistake
 * fails a deployment rather than every request that follows.
 */
export function resolveSharedOwnerId(): string | undefined {
  const raw = process.env[SHARED_OWNER_ENV]?.trim();
  if (!raw) return undefined;
  if (!SHARED_OWNER_PATTERN.test(raw)) {
    throw new Error(
      `${SHARED_OWNER_ENV} must be 1-128 characters of [A-Za-z0-9._-], got ${JSON.stringify(raw)}. ` +
        'It becomes the owner id for every request and part of material object keys, so it ' +
        'cannot use the reserved "anon:" prefix or a character the key sanitiser would rewrite.',
    );
  }
  // 这套机制原本依赖**站点级门禁**：全员共用一个口令（访问码），进门就弹框。
  // 访问码已随账号系统一起退役——站点现在对所有访问者开放，
  // 而「所有请求共用一个 owner」在没有站点级门禁时等于把一份课程库
  // 交给任何能访问到的人（能读、能改、能发布）。
  // 因此这个模式在当前部署下**一律拒绝**：操作者要么恢复站点级门禁，
  // 要么取消这个变量。保持 fail-closed，而不是降级成一句警告。
  throw new Error(
    `${SHARED_OWNER_ENV} requires a site-wide access gate, which this deployment no longer has ` +
      '(the shared access code was retired in favour of per-user accounts). Resolving every ' +
      'request to one owner would expose a single course library to anyone who can reach the ' +
      `deployment. Restore a site-wide gate, or unset ${SHARED_OWNER_ENV}.`,
  );
}

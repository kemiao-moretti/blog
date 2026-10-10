/**
 * Cookie 同意状态中心。
 *
 * 契约唯一来源：`hugo.yaml` → `params.solitude.cookie_consent`，
 * 经 `_partials/config.html` 注入 `window.Solitude.config.cookie_consent`。
 *
 * 判定分两处，缺一不可：
 *   1. `<head>` 的 `_partials/consent-bootstrap.html`（同步、内联）——
 *      必须在浏览器执行 `extends.head` 里的惰性统计脚本之前就决定放行与否，
 *      所以它不能依赖这个 bundle（bundle 在 body 末尾且是 module，执行顺序晚于 head）。
 *      本模块的读/写/放行/激活全部委托给它，避免两套实现漂移。
 *   2. 本模块 —— 只负责弹窗交互与「拒绝」后的残留清理。
 *
 * 分类：
 *   - `analytics`：统计脚本（Umami），在 `extends.head` 里以
 *     `<script type="text/plain" data-consent="analytics" data-consent-src="…">` 声明。
 *   - `optional`：非必要功能请求（访客 IP 定位卡），由模块自己调 `hasConsent` 门禁。
 *   必要类（主题偏好、同意记录本身）不参与拦截，也不打 data-consent 标记。
 */

import { Solitude } from "./api";

/** 同意状态变化事件；detail = { state, category }。被拦模块据此就地启动或停用。 */
export const CONSENT_EVENT = "solitude:consent";

export type ConsentState = "accepted" | "rejected";
export type ConsentCategory = "analytics" | "optional";

interface ConsentConfig {
  cookie: string;
  version: string;
  maxAge: number;
  categories: string[];
}

/** `window.SolitudeConsent`：由 consent-bootstrap.html 提供。 */
interface ConsentApi {
  config: ConsentConfig;
  state: ConsentState | null;
  read: () => ConsentState | null;
  write: (state: ConsentState) => ConsentState;
  allowed: (category?: string | null) => boolean;
  activate: (category?: string | null) => void;
  refresh: () => ConsentState | null;
}

/**
 * 引导脚本缺失时的兜底（例如站点层覆盖了 head.html）。
 * 只保证弹窗还能读写状态，不负责激活惰性脚本。
 */
const FALLBACK_CONFIG: ConsentConfig = {
  cookie: "solitude_cookie_consent",
  version: "v1",
  maxAge: 31536000,
  categories: ["analytics", "optional"],
};

/**
 * 「拒绝非必要」时要清掉的第三方残留：键名前缀，小写比较。
 * - `umami`：Umami 自己的会话/访问记录（cookie 与 localStorage 同名空间）
 * - `meowloge-ip-welcome-`：访客定位卡的定位结果缓存
 */
const NON_ESSENTIAL_PREFIXES = ["umami", "meowloge-ip-welcome-"];

export const consentConfig = (): ConsentConfig => ({
  ...FALLBACK_CONFIG,
  ...(((Solitude.config as { cookie_consent?: Partial<ConsentConfig> } | undefined)?.cookie_consent) || {}),
});

const bootstrap = (): ConsentApi | null => {
  const api = (window as unknown as { SolitudeConsent?: ConsentApi }).SolitudeConsent;
  return api && typeof api.write === "function" && typeof api.activate === "function" ? api : null;
};

const readFallback = (config: ConsentConfig): ConsentState | null => {
  const item = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${config.cookie}=`));
  if (!item) return null;
  let value = item.slice(config.cookie.length + 1);
  try {
    value = decodeURIComponent(value);
  } catch {
    /* 保留原值继续比对 */
  }
  const prefix = `${config.version}:`;
  if (value === `${prefix}accepted` || value === `${prefix}rejected`) {
    return value.slice(prefix.length) as ConsentState;
  }
  return null;
};

const writeFallback = (config: ConsentConfig, state: ConsentState): void => {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${config.cookie}=${encodeURIComponent(`${config.version}:${state}`)}; Max-Age=${config.maxAge}; Path=/; SameSite=Lax${secure}`;
};

/** 读取当前选择；返回 null 表示尚未选择或版本已过期。 */
export const readConsent = (): ConsentState | null => bootstrap()?.read() ?? readFallback(consentConfig());

/** 写入选择结果。 */
export const writeConsent = (state: ConsentState): void => {
  const api = bootstrap();
  if (api) {
    api.write(state);
    return;
  }
  writeFallback(consentConfig(), state);
};

/** 某个非必要分类是否已获授权。 */
export const hasConsent = (category: ConsentCategory): boolean => {
  const api = bootstrap();
  if (api) return api.allowed(category);
  return readFallback(consentConfig()) === "accepted";
};

/** 让被拦下的惰性脚本按分类立即生效（不传分类 = 放行全部已授权分类）。 */
export const activateConsentScripts = (category?: ConsentCategory): void => {
  bootstrap()?.activate(category ?? null);
};

const dropCookie = (name: string): void => {
  const host = window.location.hostname;
  const registrable = host.split(".").slice(-2).join(".");
  const domains = Array.from(new Set(["", host, `.${host}`, registrable ? `.${registrable}` : ""]));
  domains.forEach((domain) => {
    document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}`;
  });
};

const purgeStorage = (storage: Storage): void => {
  const doomed: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;
    const lower = key.toLowerCase();
    if (NON_ESSENTIAL_PREFIXES.some((prefix) => lower.startsWith(prefix))) doomed.push(key);
  }
  doomed.forEach((key) => storage.removeItem(key));
};

/**
 * 清掉非必要功能留下的 Cookie 与本地存储。
 * 「拒绝」必须在浏览器里留下可验证的后果：既不发新请求，也不留着旧数据。
 */
export const purgeNonEssential = (): void => {
  [window.localStorage, window.sessionStorage].forEach((storage) => {
    try {
      purgeStorage(storage);
    } catch {
      /* 隐私模式下存储不可用，忽略 */
    }
  });

  const names = Array.from(
    new Set(
      (document.cookie ? document.cookie.split(";") : [])
        .map((item) => item.split("=")[0]?.trim() || "")
        .filter((name) => name && NON_ESSENTIAL_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix))),
    ),
  );
  names.forEach(dropCookie);
};

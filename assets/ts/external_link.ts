/**
 * 外链中转：把指定容器里的站外链接改写成中转页地址。
 *
 * - 文章正文与友链卡片的外链来自模板 / data 文件，构建期改不到，统一丢到运行时处理
 * - 改写后补 data-no-pjax：pjax 会把站内链接当 SPA 路由接管，中转页必须走整页导航，
 *   否则它的 <head> 会被丢掉、只剩 #body-wrap 被注入当前文档
 * - 只改 href，不动 target 与其余属性，Ctrl / 中键点击、右键复制链接都保持原语义
 * - 额外带上来源页（r=…）：外链多为 target="_blank"，中转页会在新标签里打开，
 *   那种情况下 history.length 只有 1，history.back() 回不到任何地方，
 *   中转页要靠这个参数才能「返回上一页」回到用户点链接时所在的位置
 * - pjax 切换页面后需重新扫描，遵循主题 afterNavigate 约定
 */
import { Solitude } from "./core/api";

interface ExternalLinkConfig {
  enable?: boolean;
  page?: string;
  param?: string;
  encode?: string;
  containers?: string[];
  exclude?: string[];
  ignore_attrs?: string[];
  whitelist?: string[];
}

const encodeTarget = (url: string, mode: string): string => {
  if (mode !== "base64url") return encodeURIComponent(url);
  const bytes = new TextEncoder().encode(url);
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const isWhitelisted = (hostname: string, whitelist: string[]): boolean =>
  whitelist.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^\*?\./, "");
    if (!domain) return false;
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });

const initExternalLink = (): void => {
  const config = (Solitude.config.external_link || {}) as ExternalLinkConfig;
  if (!config.enable) return;

  const current = `${location.pathname}${location.search}`;
  if ((config.exclude || []).some((prefix) => prefix && current.startsWith(prefix))) return;

  const page = config.page || "/go/";
  const param = config.param || "u";
  const mode = config.encode || "base64url";
  const whitelist = config.whitelist || [];
  const ignoreAttrs = config.ignore_attrs || [];
  const containers = config.containers?.length ? config.containers : ["body"];

  const anchors: HTMLAnchorElement[] = [];
  for (const selector of containers) {
    document.querySelectorAll<HTMLAnchorElement>(`${selector} a[href]`).forEach((anchor) => anchors.push(anchor));
  }

  for (const anchor of anchors) {
    if (anchor.dataset.externalLink) continue;
    if (ignoreAttrs.some((attr) => anchor.hasAttribute(attr))) continue;

    const href = anchor.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href) || href.startsWith(page)) continue;

    let target: URL;
    try {
      target = new URL(href);
    } catch {
      continue;
    }
    if (target.hostname === location.hostname) continue;
    if (isWhitelisted(target.hostname.toLowerCase(), whitelist)) continue;

    anchor.dataset.externalLink = "1";
    anchor.setAttribute("data-no-pjax", "");
    anchor.setAttribute("href", `${page}?${param}=${encodeTarget(href, mode)}&r=${encodeTarget(current, mode)}`);
  }
};

initExternalLink();
document.addEventListener("solitude:afterNavigate", initExternalLink);

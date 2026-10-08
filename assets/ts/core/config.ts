import type { SolitudePageConfiguration, SolitudeSiteConfiguration } from "../types";

// Cloudflare 的 Email Obfuscation 会把内联 config JSON 里的 "xxx@yyy.zz"
// （例如 cdn 地址中的 artalk@2.10.0）替换成 <a data-cfemail="..."> 元素，
// 导致 JSON.parse 失败或取到坏值；这里是可逆解码（每字节与首字节异或），
// 在读取 config 时还原原文，保证 config 在 CF 混淆开启时依然完整可用。
const decodeCfEmailElements = (root: DocumentFragment | HTMLElement) => {
  if (!root.querySelectorAll) return;
  root.querySelectorAll("[data-cfemail]").forEach((element) => {
    const hex = element.getAttribute("data-cfemail") || "";
    const key = parseInt(hex.slice(0, 2), 16);
    if (!Number.isFinite(key)) return;
    let decoded = "";
    for (let i = 2; i < hex.length; i += 2) {
      decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    }
    element.replaceWith(document.createTextNode(decoded));
  });
};

const parseConfig = <T>(id: string, fallback: T): T => {
  const element = document.getElementById(id) as HTMLTemplateElement | null;
  if (!element) return fallback;
  try {
    const content = element.content || element;
    decodeCfEmailElements(content);
    return JSON.parse(content.textContent || element.textContent || "{}");
  } catch (error) {
    console.error(`Invalid Solitude configuration in #${id}:`, error);
    return fallback;
  }
};

const promoteSerializedKey = (
  record: object | undefined,
  canonical: string,
  serialized: string,
) => {
  if (!record) return;
  const values = record as Record<string, any>;
  if (!(serialized in values)) return;
  if (!(canonical in values)) values[canonical] = values[serialized];
  delete values[serialized];
};

const normalizeProviderKeys = (record: object | undefined) => {
  promoteSerializedKey(record, "appId", "appid");
  promoteSerializedKey(record, "apiKey", "apikey");
  promoteSerializedKey(record, "appKey", "appkey");
  promoteSerializedKey(record, "indexName", "indexname");
  promoteSerializedKey(record, "serverURL", "serverurl");
  promoteSerializedKey(record, "serverURLs", "serverurls");
  promoteSerializedKey(record, "envId", "envid");
  promoteSerializedKey(record, "accessToken", "accesstoken");
};

const normalizeConfig = (config: SolitudeSiteConfiguration) => {
  promoteSerializedKey(config.comment, "commentBarrage", "commentbarrage");
  promoteSerializedKey(config.console, "recentComment", "recentcomment");
  promoteSerializedKey(config.right_menu, "ctrlOriginalMenu", "ctrloriginalmenu");
  normalizeProviderKeys(config.valine);
  normalizeProviderKeys(config.twikoo);
  normalizeProviderKeys(config.waline);
  normalizeProviderKeys(config.algolia);
  normalizeProviderKeys(config.search?.algolia);
  normalizeProviderKeys(config.search?.docsearch);
  return config;
};

export const getConfig = () =>
  normalizeConfig(
    parseConfig<SolitudeSiteConfiguration>(
      "site-config",
      {} as SolitudeSiteConfiguration,
    ),
  );
export const getPageConfig = () => parseConfig<SolitudePageConfiguration>("config-diff", {} as SolitudePageConfiguration);

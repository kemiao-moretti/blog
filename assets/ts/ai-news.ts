import { Solitude } from "./core/api";

type NewsItem = { title: string; detail: string; source: string; date: string; link: string };
type NewsPayload = { date: string; news: NewsItem[] };
type NewsDay = { date: string; news: NewsItem[]; fetchedAt: number; source: "network" | "cache"; failed?: boolean };
type CacheDay = { fetchedAt: number; data: NewsPayload; lastStatus: "ready" };
type CacheEntry = { version: 2; days: Record<string, CacheDay> };
type FetchResult = { payload: NewsPayload; malformed: boolean };
type PageConfig = { api: string; cacheMinutes: number; timeoutMs: number; rangeDays: number; timezone: string; groupByDate: boolean; labels: Record<string, string> };

const CACHE_KEY = "solitude-ai-news-v2";
const LEGACY_CACHE_KEY = "solitude-ai-news-v1";
const CACHE_VERSION = 2;
const DEFAULT_TIMEZONE = "Asia/Shanghai";

const text = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
const firstText = (value: Record<string, unknown>, keys: string[]) => keys.map((key) => text(value[key])).find(Boolean) || "";
const normalizeNews = (value: unknown): NewsItem[] => !Array.isArray(value) ? [] : value.flatMap((item) => {
  if (!item || typeof item !== "object") return [];
  const source = item as Record<string, unknown>;
  const title = firstText(source, ["title", "name", "headline"]);
  return title ? [{ title, detail: firstText(source, ["detail", "summary", "description", "content"]), source: firstText(source, ["source", "publisher", "from"]), date: firstText(source, ["date", "published_at", "publishedAt", "time"]), link: firstText(source, ["link", "url", "href"]) }] : [];
});
const normalizePayload = (value: unknown, requestedDate: string): FetchResult | null => {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  if (!root.data || typeof root.data !== "object") return null;
  const data = root.data as Record<string, unknown>;
  const date = text(data.date);
  if (date !== requestedDate) return null;
  const newsValue = data.news ?? data.items ?? data.articles;
  if (!Array.isArray(newsValue)) return null;
  const news = normalizeNews(newsValue);
  return { payload: { date, news }, malformed: newsValue.length > 0 && news.length === 0 };
};
const isValidTimezone = (timezone: string) => {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};
const readConfig = (root: HTMLElement): PageConfig => {
  const number = (key: string, fallback: number, minimum: number) => { const value = Number(root.dataset[key]); return Number.isFinite(value) ? Math.max(minimum, value) : fallback; };
  const timezone = root.dataset.timezone || DEFAULT_TIMEZONE;
  return {
    api: root.dataset.api || "", cacheMinutes: number("cacheMinutes", 60, 0), timeoutMs: number("timeoutMs", 8000, 1000), rangeDays: Math.min(31, number("rangeDays", 7, 1)), timezone: isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE, groupByDate: root.dataset.groupByDate !== "false",
    labels: { title: root.dataset.labelTitle || "AI 日报", description: root.dataset.labelDescription || "", loading: root.dataset.labelLoading || "正在获取今日 AI 资讯…", empty: root.dataset.labelEmpty || "", error: root.dataset.labelError || "AI 日报暂时无法更新，将优先展示最近一期内容。", errorEmpty: root.dataset.labelErrorEmpty || "AI 日报请求失败，暂时没有可展示的内容，请重试或刷新页面。", retry: root.dataset.labelRetry || "重试", malformed: root.dataset.labelMalformed || "今日数据格式异常，请稍后重试或刷新页面。", previous: root.dataset.labelPrevious || "缓存", updated: root.dataset.labelUpdated || "数据更新时间", source: root.dataset.labelSource || "来源", detail: root.dataset.labelDetail || "摘要", link: root.dataset.labelLink || "阅读原文", noLink: root.dataset.labelNoLink || "暂无原文链接" },
  };
};
const getDateParts = (date: Date, timeZone: string) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).map(({ type, value }) => [type, value]));
const getDateKey = (date: Date, timeZone: string) => { const parts = getDateParts(date, timeZone); return `${parts.year}-${parts.month}-${parts.day}`; };
const getDateWindow = (rangeDays: number, timeZone: string) => { const now = new Date(); const parts = getDateParts(now, timeZone); const cursor = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))); return Array.from({ length: rangeDays }, (_, index) => { const date = new Date(cursor); date.setUTCDate(cursor.getUTCDate() - index); return getDateKey(date, "UTC"); }); };
const buildDateUrl = (api: string, date: string) => { const url = new URL(api, window.location.href); url.searchParams.set("date", date); return url.toString(); };
const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const readCache = (): CacheEntry => {
  try {
    localStorage.removeItem(LEGACY_CACHE_KEY);
    const entry = JSON.parse(localStorage.getItem(CACHE_KEY) || "null") as CacheEntry | null;
    if (!entry || entry.version !== CACHE_VERSION || !entry.days || typeof entry.days !== "object") throw new Error("invalid cache");
    const days: Record<string, CacheDay> = {};
    Object.entries(entry.days).forEach(([date, day]) => { if (isDateKey(date) && day && typeof day.fetchedAt === "number" && day.lastStatus === "ready" && day.data?.date === date && Array.isArray(day.data.news) && day.data.news.length > 0) days[date] = day; });
    return { version: CACHE_VERSION, days };
  } catch { localStorage.removeItem(CACHE_KEY); return { version: CACHE_VERSION, days: {} }; }
};
const writeCache = (cache: CacheEntry, windowDates: string[]) => { try { cache.days = Object.fromEntries(windowDates.filter((date) => cache.days[date]?.data.news.length).map((date) => [date, cache.days[date]])); localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { return; } };
const setStatus = (root: HTMLElement, message: string, kind: string, action?: { label: string; run: () => void }) => { const status = root.querySelector<HTMLElement>("#ai-news-status"); if (!status) return; status.dataset.state = kind; status.replaceChildren(); const icon = document.createElement("i"); icon.className = `solitude fas ${kind === "loading" ? "fa-spinner fa-spin" : kind === "error" ? "fa-circle-exclamation" : "fa-circle-check"}`; icon.setAttribute("aria-hidden", "true"); const label = document.createElement("span"); label.textContent = message; status.append(icon, label); if (action) { const button = document.createElement("button"); button.type = "button"; button.className = "ai-news-retry"; button.textContent = action.label; button.addEventListener("click", action.run, { once: true }); status.append(button); } };
const renderList = (config: PageConfig, list: HTMLElement, news: NewsItem[]) => { news.forEach((item) => { const article = document.createElement("article"); article.className = "ai-news-item"; const title = document.createElement("h3"); title.className = "ai-news-item-title"; title.textContent = item.title; article.append(title); if (item.detail) { const detail = document.createElement("p"); detail.className = "ai-news-item-detail"; detail.textContent = item.detail; article.append(detail); } const meta = document.createElement("div"); meta.className = "ai-news-item-meta"; if (item.source) { const source = document.createElement("span"); source.className = "ai-news-item-source"; source.textContent = `${config.labels.source}：${item.source}`; meta.append(source); } if (item.date) { const published = document.createElement("span"); published.textContent = item.date; meta.append(published); } if (/^https?:\/\//i.test(item.link)) { const link = document.createElement("a"); link.className = "ai-news-item-link"; link.href = item.link; link.target = "_blank"; link.rel = "noopener noreferrer nofollow"; link.textContent = config.labels.link; meta.append(link); } else { const noLink = document.createElement("span"); noLink.className = "ai-news-item-nolink"; noLink.textContent = config.labels.noLink; meta.append(noLink); } article.append(meta); list.append(article); }); };
const renderDays = (root: HTMLElement, config: PageConfig, days: NewsDay[]) => { const container = root.querySelector<HTMLElement>("#ai-news-days"); if (!container) return; container.replaceChildren(); const groups = config.groupByDate ? days.filter((day) => day.news.length) : [{ date: `最近 ${config.rangeDays} 天`, news: days.flatMap((day) => day.news), fetchedAt: days[0]?.fetchedAt || Date.now(), source: days.some((day) => day.source === "network") ? "network" : "cache" as "network" | "cache" }]; groups.filter((day) => day.news.length).forEach((day, index) => { const section = document.createElement("section"); section.className = "ai-news-day"; const heading = document.createElement("h2"); heading.className = "ai-news-day-heading"; const button = document.createElement("button"); button.type = "button"; button.className = "ai-news-day-toggle"; button.setAttribute("aria-expanded", index === 0 ? "true" : "false"); const date = document.createElement("span"); date.textContent = day.date; const source = document.createElement("span"); source.className = "ai-news-day-source"; source.textContent = day.source === "cache" ? config.labels.previous : "网络"; const count = document.createElement("span"); count.className = "ai-news-day-count"; count.textContent = `${day.news.length}`; button.append(date, source, count); heading.append(button); const panel = document.createElement("div"); panel.className = "ai-news-day-panel"; panel.hidden = index !== 0; renderList(config, panel, day.news); button.addEventListener("click", () => { const expanded = button.getAttribute("aria-expanded") === "true"; button.setAttribute("aria-expanded", String(!expanded)); panel.hidden = expanded; }); section.append(heading, panel); container.append(section); }); };
const fetchNews = async (config: PageConfig, date: string, signal: AbortSignal): Promise<FetchResult> => { const controller = new AbortController(); const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true }); const timer = window.setTimeout(() => controller.abort(), config.timeoutMs); try { const response = await fetch(buildDateUrl(config.api, date), { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } }); if (!response.ok) throw new Error(`AI news HTTP ${response.status}`); const result = normalizePayload(await response.json(), date); if (!result) throw new Error("Invalid AI news payload"); return result; } finally { window.clearTimeout(timer); signal.removeEventListener("abort", abort); } };
export const initAiNews = async () => {
  const root = document.getElementById("ai-news"); if (!root || root.dataset.initialized === "true") return; root.dataset.initialized = "true"; const config = readConfig(root); const dates = getDateWindow(config.rangeDays, config.timezone); const cache = readCache(); const maxAge = config.cacheMinutes * 60 * 1000; const controller = new AbortController(); Solitude.onPageCleanup(() => controller.abort()); setStatus(root, config.labels.loading, "loading");
  if (!config.api) { setStatus(root, config.labels.errorEmpty, "error", { label: config.labels.retry, run: () => window.location.reload() }); return; }
  const results = await Promise.all(dates.map(async (date): Promise<NewsDay> => { const cached = cache.days[date]; if (cached && config.cacheMinutes > 0 && Date.now() - cached.fetchedAt < maxAge) return { date, news: cached.data.news, fetchedAt: cached.fetchedAt, source: "cache" }; try { const result = await fetchNews(config, date, controller.signal); if (result.malformed) throw new Error(config.labels.malformed); if (result.payload.news.length) { const fetchedAt = Date.now(); cache.days[date] = { fetchedAt, data: result.payload, lastStatus: "ready" }; return { date, news: result.payload.news, fetchedAt, source: "network" }; } return cached ? { date, news: cached.data.news, fetchedAt: cached.fetchedAt, source: "cache" } : { date, news: [], fetchedAt: Date.now(), source: "network" }; } catch { return cached ? { date, news: cached.data.news, fetchedAt: cached.fetchedAt, source: "cache", failed: true } : { date, news: [], fetchedAt: Date.now(), source: "network", failed: true }; } }));
  if (!root.isConnected || controller.signal.aborted) return; writeCache(cache, dates); const visible = results.filter((day) => day.news.length); renderDays(root, config, visible); const failed = results.some((day) => day.failed); const total = visible.reduce((sum, day) => sum + day.news.length, 0); const latestRequestDate = dates[0]; const todayHasNews = results[0]?.news.length > 0; const summary = root.querySelector<HTMLElement>("#ai-news-summary"); const emptyMessage = `最近 ${config.rangeDays} 天暂无 AI 日报（最近请求日期：${latestRequestDate}）`; const partialMessage = !todayHasNews && total ? `今日暂无资讯，${config.labels.updated}：${latestRequestDate}` : `最近 ${config.rangeDays} 天 · 已找到 ${visible.length} 期日报 · 最近请求日期：${latestRequestDate}`; if (summary) { summary.replaceChildren(); summary.textContent = total ? `${partialMessage}${failed ? " · 部分日期暂时无法更新" : ""}` : emptyMessage; } if (total) setStatus(root, failed ? config.labels.error : `${config.labels.updated}：${latestRequestDate}`, failed ? "error" : "ready") ; else setStatus(root, failed ? `${config.labels.errorEmpty}（最近请求日期：${latestRequestDate}）` : emptyMessage, failed ? "error" : "ready", failed ? { label: config.labels.retry, run: () => window.location.reload() } : undefined);
};
document.addEventListener("solitude:ready", () => void initAiNews());
document.addEventListener("solitude:afterNavigate", () => void initAiNews());

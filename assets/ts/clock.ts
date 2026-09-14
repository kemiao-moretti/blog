import { Solitude } from "./core/api";

/**
 * 侧边栏时钟（clock）：移植自 hexo-butterfly-clock-veeink。
 * - 时钟走时 + 和风天气实时展示（前端直连 devapi.qweather.com）
 * - 天气经 localStorage 缓存（默认 30 分钟），失败静默降级为纯时钟
 * - 挂载点：aside-clock.html 注入 data-* 配置
 * - 颜色与尺寸全部交给 --efu-* token，明暗与多端由 CSS 负责
 */

interface ClockConfig {
  locationId: string;
  city: string;
  qweatherHost: string;
  qweatherKey: string;
  timezone: string;
  cacheMinutes: number;
}

interface QwNow {
  code: string;
  now?: {
    temp?: string;
    text?: string;
    icon?: string;
    humidity?: string;
    windDir?: string;
    windScale?: string;
  };
}

interface CachedWeather {
  at: number;
  payload: QwNow;
}

const CACHE_KEY = "meowloge-clock-weather-v1";

type WeatherKind =
  | "sun" | "moon" | "partly" | "partlyNight" | "cloud"
  | "rain" | "thunder" | "snow" | "fog" | "wind" | "hot" | "cold" | "unknown";

// 24x24 线性图标，全部走 currentColor，由 CSS 上色（不写死任何颜色）
const ICON_SVG: Record<WeatherKind, string> = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>',
  moon: '<path d="M19.8 14.4A8.2 8.2 0 0 1 9.6 4.2 8.4 8.4 0 1 0 19.8 14.4Z"/>',
  partly: '<circle cx="8.6" cy="8.2" r="3"/><path d="M8.6 3.4v1.6M3.8 8.2h1.6M5.2 4.8l1.1 1.1M12 4.8l-1.1 1.1"/><path d="M9.6 19.6h7.7a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.5 1.5 3 3 0 0 0 1.5 5.7Z"/>',
  partlyNight: '<path d="M14 8.8A5.6 5.6 0 0 1 8 3.2 5.8 5.8 0 1 0 14 8.8Z"/><path d="M9.6 19.6h7.7a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.5 1.5 3 3 0 0 0 1.5 5.7Z"/>',
  cloud: '<path d="M7.5 19h9.1a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.6 1.7A3.4 3.4 0 0 0 7.5 19Z"/>',
  rain: '<path d="M7.5 15.4h9.1a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.6 1.7 3.4 3.4 0 0 0 1.1 6.3Z"/><path d="M8.6 18.2 7.6 21M12 18.2 11 21M15.4 18.2 14.4 21"/>',
  thunder: '<path d="M7.5 15h9.1a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.6 1.7A3.4 3.4 0 0 0 7.5 15Z"/><path d="m13.2 16.4-2.8 4h3.2l-1.4 3.4"/>',
  snow: '<path d="M7.5 15h9.1a4 4 0 0 0 .4-8 5.6 5.6 0 0 0-10.6 1.7A3.4 3.4 0 0 0 7.5 15Z"/><path d="M8.8 18.4v3.2M7.4 19.2l2.8 1.6M10.2 19.2l-2.8 1.6M15.6 18.4v3.2M14.2 19.2l2.8 1.6M17 19.2l-2.8 1.6"/>',
  fog: '<path d="M6.4 9.8h11.2M4.2 13.9h15.6M7 18h10"/>',
  wind: '<path d="M3.6 8.4h8a2.8 2.8 0 1 0-2.8-2.8"/><path d="M3.6 12.8h12a2.8 2.8 0 1 1-2.8 2.8"/><path d="M6.8 17.4h4"/>',
  hot: '<path d="M10.6 13.6V5.4a2.1 2.1 0 1 1 4.2 0v8.2a4.1 4.1 0 1 1-4.2 0Z"/>',
  cold: '<path d="M12 3.6v16.8M4.8 7.8l14.4 8.4M19.2 7.8 4.8 16.2"/>',
  unknown: '<circle cx="12" cy="12" r="8.4"/><path d="M9.7 9.7a2.5 2.5 0 1 1 3.1 2.4v1.3M12.2 16.5h.01"/>',
};

function iconKind(code: string): WeatherKind {
  const n = Number.parseInt(code, 10);
  if (!Number.isFinite(n)) return "unknown";
  if (n === 100) return "sun";
  if (n >= 101 && n <= 103) return "partly";
  if (n === 104) return "cloud";
  if (n === 150) return "moon";
  if (n >= 151 && n <= 153) return "partlyNight";
  if (n === 154) return "cloud";
  if (n >= 302 && n <= 304) return "thunder";
  if (n >= 300 && n <= 399) return "rain";
  if (n >= 400 && n <= 499) return "snow";
  if (n === 507 || n === 508) return "wind";
  if (n >= 500 && n <= 515) return "fog";
  if (n >= 800 && n <= 807) return "wind";
  if (n === 900) return "hot";
  if (n === 901) return "cold";
  return "unknown";
}

function weatherIconSvg(code: string): string {
  return `<svg class="clock-weather-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SVG[iconKind(code)]}</svg>`;
}

const GLYPH_DROP = '<path d="M12 3.6c3.2 3.6 5 6.1 5 8.4a5 5 0 0 1-10 0c0-2.3 1.8-4.8 5-8.4Z"/>';

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function detailItem(path: string, label: string): string {
  return `<span class="clock-detail-item"><svg class="clock-detail-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg><span>${esc(label)}</span></span>`;
}

let tickTimer: number | null = null;

function readConfig(root: HTMLElement): ClockConfig {
  return {
    locationId: root.dataset.locationId || "",
    city: root.dataset.city || "",
    qweatherHost: root.dataset.qweatherHost || "https://devapi.qweather.com",
    qweatherKey: root.dataset.qweatherKey || "",
    timezone: root.dataset.timezone || "Asia/Shanghai",
    cacheMinutes: Number.parseInt(root.dataset.cacheMinutes || "30", 10),
  };
}

function startTicking(root: HTMLElement, cfg: ClockConfig): void {
  const dateEl = root.querySelector<HTMLElement>("#clock-date");
  const timeEl = root.querySelector<HTMLElement>("#clock-time");
  if (!dateEl || !timeEl) return;

  const update = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: cfg.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";

    timeEl.textContent = `${get("hour")}:${get("minute")}:${get("second")}`;

    const weekOrder: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekLabels = Solitude.config.lang?.week as string[] | undefined;
    const idx = weekOrder[get("weekday")];
    const weekLabel = weekLabels && idx !== undefined ? weekLabels[idx] : "";
    dateEl.textContent = `${get("year")}-${get("month")}-${get("day")} ${weekLabel}`.trim();
  };

  update();
  if (tickTimer !== null) window.clearInterval(tickTimer);
  tickTimer = window.setInterval(update, 1000);
}

async function fetchWeather(cfg: ClockConfig): Promise<QwNow | null> {
  if (!cfg.locationId || !cfg.qweatherKey) return null;

  const cachedRaw = localStorage.getItem(CACHE_KEY);
  if (cachedRaw) {
    try {
      const cached: CachedWeather = JSON.parse(cachedRaw);
      if (cached.at && Date.now() - cached.at < cfg.cacheMinutes * 60 * 1000) {
        return cached.payload;
      }
    } catch { /* ignore */ }
  }

  try {
    const url = `${cfg.qweatherHost}/v7/weather/now?location=${encodeURIComponent(cfg.locationId)}&key=${encodeURIComponent(cfg.qweatherKey)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as QwNow;
    if (data.code !== "200" || !data.now) return null;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload: data } satisfies CachedWeather));
    } catch { /* ignore */ }
    return data;
  } catch {
    return null;
  }
}

function renderWeather(root: HTMLElement, data: QwNow, cfg: ClockConfig): void {
  const weatherEl = root.querySelector<HTMLElement>("#clock-weather");
  if (!weatherEl || !data.now) return;

  const text = esc(data.now.text || "--");
  const temp = data.now.temp ? ` ${esc(data.now.temp)}℃` : "";
  weatherEl.innerHTML = `${weatherIconSvg(data.now.icon || "")}<span class="clock-weather-text">${text}${temp}</span>`;

  const cityEl = root.querySelector<HTMLElement>("#clock-city");
  if (cityEl) cityEl.textContent = cfg.city;

  const detailEl = root.querySelector<HTMLElement>("#clock-detail");
  if (detailEl) {
    detailEl.innerHTML = [
      data.now.humidity ? detailItem(GLYPH_DROP, `${data.now.humidity}%`) : "",
      data.now.windDir ? detailItem(ICON_SVG.wind, data.now.windDir) : "",
    ].filter(Boolean).join("");
  }
}

function initClock(): void {
  const root = document.getElementById("hexo-electric-clock");
  if (!root) return;
  const cfg = readConfig(root);
  startTicking(root, cfg);
  void fetchWeather(cfg).then((data) => {
    if (data) renderWeather(root, data, cfg);
  });
}

document.addEventListener("solitude:ready", () => void initClock());
document.addEventListener("solitude:afterNavigate", () => void initClock());
if (document.readyState !== "loading") void initClock();
Solitude.onPageCleanup(() => {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
});

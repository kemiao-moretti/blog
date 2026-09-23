/**
 * 侧边栏访客欢迎卡（ipWelcome）：定位访客大致位置并展示欢迎语。
 *
 * 数据链（全部浏览器直连，无需 Key，任一步失败继续降级）：
 *   1. 主源 https://60s-api.518339.xyz/v2/ip  一次拿到 ip / 国家 / 省市 / 经纬度
 *   2. 备用取 IP：api.ipify.org、icanhazip.com
 *   3. 备用查位置：ipapi.co/{ip}/json/
 *   4. 全部失败 → 显示兜底欢迎语
 *
 * 隐私：位置只用于本地展示与距离计算，页面不输出完整 IP；
 *       结果存 localStorage（默认 24h），避免每次刷新都请求外部接口。
 * 挂载点：aside-ip-welcome.html 注入 data-* 配置。
 * 颜色与尺寸全部交给 token，明暗与多端由 CSS 负责。
 */

interface IpWelcomeConfig {
  lang: string;
  loading: string;
  fallback: string;
  labelFrom: string;
  labelFriend: string;
  labelDistance: string;
  labelPlace: string;
  bloggerLat: number;
  bloggerLng: number;
  cacheHours: number;
  timeoutMs: number;
  primaryApi: string;
  ipApis: string[];
  fallbackApi: string;
  tips: Record<string, string>;
}

interface Located {
  country: string;
  province: string;
  city: string;
  lat: number;
  lng: number;
}

interface Cached extends Located {
  at: number;
}

const CACHE_KEY = "meowloge-ip-welcome-v1";

const ROOT_ID = "ip-welcome-info";

/** 中国省份英文名 → 中文（ip.sb 对国内返回英文，需转换才能命中「省-市」Tip 键） */
const PROVINCE_ZH: Record<string, string> = {
  Beijing: "北京",
  Tianjin: "天津",
  Hebei: "河北",
  Shanxi: "山西",
  "Inner Mongolia": "内蒙古",
  "Inner Mongolia Autonomous Region": "内蒙古",
  Liaoning: "辽宁",
  Jilin: "吉林",
  Heilongjiang: "黑龙江",
  Shanghai: "上海",
  Jiangsu: "江苏",
  Zhejiang: "浙江",
  Anhui: "安徽",
  Fujian: "福建",
  Jiangxi: "江西",
  Shandong: "山东",
  Henan: "河南",
  Hubei: "湖北",
  Hunan: "湖南",
  Guangdong: "广东",
  Guangxi: "广西",
  "Guangxi Zhuang Autonomous Region": "广西",
  Hainan: "海南",
  Chongqing: "重庆",
  Sichuan: "四川",
  Guizhou: "贵州",
  Yunnan: "云南",
  Tibet: "西藏",
  "Tibet Autonomous Region": "西藏",
  Shaanxi: "陕西",
  Gansu: "甘肃",
  Qinghai: "青海",
  Ningxia: "宁夏",
  "Ningxia Hui Autonomous Region": "宁夏",
  Xinjiang: "新疆",
  "Xinjiang Uygur Autonomous Region": "新疆",
  "Hong Kong": "香港",
  Macao: "澳门",
  Macau: "澳门",
  Taiwan: "台湾"
};

/** 中国主要城市英文名 → 中文（命中「省-市」级 Tip 文案） */
const CITY_ZH: Record<string, string> = {
  Beijing: "北京",
  Shanghai: "上海",
  Tianjin: "天津",
  Chongqing: "重庆",
  Nanjing: "南京",
  Suzhou: "苏州",
  Wuxi: "无锡",
  Hangzhou: "杭州",
  Ningbo: "宁波",
  Wenzhou: "温州",
  Guangzhou: "广州",
  Shenzhen: "深圳",
  Zhuhai: "珠海",
  Dongguan: "东莞",
  Foshan: "佛山",
  Yangjiang: "阳江",
  Wuhan: "武汉",
  Huanggang: "黄冈",
  Changsha: "长沙",
  Zhengzhou: "郑州",
  Luoyang: "洛阳",
  Xinyang: "信阳",
  Nanyang: "南阳",
  Zhumadian: "驻马店",
  Kaifeng: "开封",
  Chengdu: "成都",
  Mianyang: "绵阳",
  XiAn: "西安",
  "Xi'an": "西安",
  Xian: "西安",
  Harbin: "哈尔滨",
  Shenyang: "沈阳",
  Dalian: "大连",
  Changchun: "长春",
  Jinan: "济南",
  Qingdao: "青岛",
  Xiamen: "厦门",
  Fuzhou: "福州",
  Quanzhou: "泉州",
  Nanchang: "南昌",
  Hefei: "合肥",
  Wuhu: "芜湖",
  Bengbu: "蚌埠",
  Kunming: "昆明",
  Lijiang: "丽江",
  Guiyang: "贵阳",
  Lanzhou: "兰州",
  Xining: "西宁",
  Yinchuan: "银川",
  Urumqi: "乌鲁木齐",
  Lhasa: "拉萨",
  Hohhot: "呼和浩特",
  Nanning: "南宁",
  Guilin: "桂林",
  Haikou: "海口",
  Sanya: "三亚",
  "Hong Kong": "香港",
  Macao: "澳门",
  Macau: "澳门",
  Taipei: "台北"
};

const translate = (dict: Record<string, string>, raw: string): string => {
  if (!raw) return "";
  const key = raw.trim();
  return dict[key] || key;
};

const COUNTRY_ZH: Record<string, string> = {
  China: "中国",
  中国: "中国",
  "Hong Kong": "香港",
  "Hong Kong SAR China": "香港",
  Macao: "澳门",
  Macau: "澳门",
  Taiwan: "台湾",
  "Taiwan, China": "台湾",
  Japan: "日本",
  "South Korea": "韩国",
  "Korea, Republic of": "韩国",
  "North Korea": "朝鲜",
  "United States": "美国",
  USA: "美国",
  "United States of America": "美国",
  "United Kingdom": "英国",
  UK: "英国",
  France: "法国",
  Germany: "德国",
  Russia: "俄罗斯",
  "Russian Federation": "俄罗斯",
  Canada: "加拿大",
  Australia: "澳大利亚",
  Singapore: "新加坡",
  Malaysia: "马来西亚",
  Thailand: "泰国",
  Vietnam: "越南",
  India: "印度",
  Brazil: "巴西",
  Mexico: "墨西哥",
  Italy: "意大利",
  Spain: "西班牙",
  Netherlands: "荷兰",
  Sweden: "瑞典",
  Switzerland: "瑞士",
  "New Zealand": "新西兰"
};

function readConfig(el: HTMLElement): IpWelcomeConfig {
  const d = el.dataset;
  const num = (v: string | undefined, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : fb;
  };
  let tips: Record<string, string> = {};
  try {
    tips = JSON.parse(d.tips || "{}");
  } catch {
    tips = {};
  }
  return {
    lang: d.lang || "zh-cn",
    loading: d.loading || "…",
    fallback: d.fallback || "Welcome",
    labelFrom: d.labelFrom || "",
    labelFriend: d.labelFriend || "",
    labelDistance: d.labelDistance || "%s",
    labelPlace: d.labelPlace || "",
    bloggerLat: num(d.bloggerLat, 32.0603),
    bloggerLng: num(d.bloggerLng, 118.7969),
    cacheHours: num(d.cacheHours, 24),
    timeoutMs: num(d.timeoutMs, 6000),
    primaryApi: d.primaryApi || "",
    ipApis: (d.ipApis || "").split(",").map((s) => s.trim()).filter(Boolean),
    fallbackApi: d.fallbackApi || "",
    tips
  };
}

function fetchJson(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        clearTimeout(timer);
        resolve(data as Record<string, unknown>);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function fetchText(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        clearTimeout(timer);
        resolve(text.trim());
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

const pick = (o: Record<string, unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v && v !== "-") return v;
    if (typeof v === "number") return String(v);
  }
  return "";
};

const pickNum = (o: Record<string, unknown>, ...keys: string[]): number => {
  for (const k of keys) {
    const n = Number(o[k]);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
};

function responseData(data: Record<string, unknown>): Record<string, unknown> {
  return data.data && typeof data.data === "object" && !Array.isArray(data.data)
    ? data.data as Record<string, unknown>
    : data;
}

function toLocated(data: Record<string, unknown>): Located | null {
  const d = responseData(data);
  const lat = pickNum(d, "latitude", "lat");
  const lng = pickNum(d, "longitude", "lng", "lon");
  const country = pick(d, "country", "country_name");
  const province = pick(d, "region", "province", "region_name", "prov");
  const city = pick(d, "city");
  if (!lat || !lng || !country) return null;
  return { country, province, city, lat, lng };
}

/** 主源：返回 ip / 国家 / 省市 / 经纬度，兼容顶层和 data 包装响应 */
async function fromPrimary(cfg: IpWelcomeConfig): Promise<Located | null> {
  if (!cfg.primaryApi) return null;
  return toLocated(await fetchJson(cfg.primaryApi, cfg.timeoutMs));
}

/** 备用链：先取 IP，再查 ipapi.co */
async function fromFallback(cfg: IpWelcomeConfig): Promise<Located | null> {
  let ip = "";
  for (const api of cfg.ipApis) {
    try {
      const raw = await fetchText(api, cfg.timeoutMs);
      const text = raw.startsWith("{") ? pick(JSON.parse(raw), "ip") : raw;
      if (text && text.length <= 45) {
        ip = text;
        break;
      }
    } catch {
      /* 换下一个 IP 源 */
    }
  }
  if (!ip || !cfg.fallbackApi) return null;
  const d = await fetchJson(cfg.fallbackApi.replace("%s", encodeURIComponent(ip)), cfg.timeoutMs);
  return toLocated(d);
}

/** 球面距离（公里） */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const rad = (v: number) => (v * Math.PI) / 180;
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dp = rad(lat2 - lat1);
  const dl = rad(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** 时段问候语 */
function timeGreeting(lang: string): string {
  const h = new Date().getHours();
  const zh = /^zh/i.test(lang);
  if (h >= 5 && h < 11) return zh ? "早上好，一日之计在于晨" : "Good morning";
  if (h >= 11 && h < 13) return zh ? "中午好，记得午休喔" : "Good noon";
  if (h >= 13 && h < 17) return zh ? "下午好，饮茶先啦" : "Good afternoon";
  if (h >= 17 && h < 19) return zh ? "傍晚好，记得按时吃饭" : "Good evening";
  if (h >= 19 && h < 24) return zh ? "晚上好，夜生活嗨起来" : "Good night";
  return zh ? "夜深了，早点休息" : "It's late, rest early";
}

/** 位置名：中国取「省 市」（英文名先转中文），其它取中文国名 */
function placeName(loc: Located): string {
  const isCN = loc.country === "中国" || loc.country === "China";
  if (isCN) {
    const province = translate(PROVINCE_ZH, loc.province);
    const city = translate(CITY_ZH, loc.city);
    // 直辖市等省市同名时只保留一个
    const uniq = city && city !== province ? [province, city] : [province || city];
    return uniq.filter(Boolean).join(" ") || "中国";
  }
  return zhCountry(loc.country) || loc.country || "";
}

/** 英文国名 → 中文（未收录时返回空串） */
function zhCountry(name: string): string {
  return COUNTRY_ZH[name] || COUNTRY_ZH[name.trim()] || "";
}

/** Tip：优先精确到「省-市」，再退到市 / 省 / 国家（中英文都试），最后默认 */
function pickTip(cfg: IpWelcomeConfig, loc: Located): string {
  const tips = cfg.tips || {};
  const isCN = loc.country === "中国" || loc.country === "China";
  const province = isCN ? translate(PROVINCE_ZH, loc.province) : "";
  const city = isCN ? translate(CITY_ZH, loc.city) : "";
  const zh = zhCountry(loc.country);
  const keys = [
    province && city ? `${province}-${city}` : "",
    city,
    province,
    zh,
    loc.country,
    "default"
  ].filter(Boolean);
  for (const k of keys) {
    if (tips[k]) return tips[k];
  }
  return "";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m] as string
  );
}

function renderFallback(cfg: IpWelcomeConfig): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const greet = root.querySelector<HTMLElement>("#ip-welcome-greet");
  const place = root.querySelector<HTMLElement>("#ip-welcome-place");
  const dist = root.querySelector<HTMLElement>("#ip-welcome-dist");
  const tip = root.querySelector<HTMLElement>("#ip-welcome-tip");
  if (greet) greet.textContent = cfg.fallback;
  if (place) place.innerHTML = "";
  if (dist) dist.innerHTML = "";
  if (tip) tip.innerHTML = "";
  root.setAttribute("aria-busy", "false");
}

function render(cfg: IpWelcomeConfig, loc: Located): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const greet = root.querySelector<HTMLElement>("#ip-welcome-greet");
  const place = root.querySelector<HTMLElement>("#ip-welcome-place");
  const dist = root.querySelector<HTMLElement>("#ip-welcome-dist");
  const tip = root.querySelector<HTMLElement>("#ip-welcome-tip");

  if (greet) greet.textContent = timeGreeting(cfg.lang);

  const name = placeName(loc) || cfg.labelPlace;
  if (place) {
    place.innerHTML =
      `${esc(cfg.labelFrom)} <span class="ip-welcome-strong">${esc(name)}</span> ${esc(cfg.labelFriend)}`.trim();
  }

  if (dist) {
    const km = distanceKm(cfg.bloggerLat, cfg.bloggerLng, loc.lat, loc.lng);
    dist.innerHTML = `<span class="ip-welcome-dist-chip">${esc(cfg.labelDistance.replace("%s", String(km)))}</span>`;
  }

  const t = pickTip(cfg, loc);
  if (tip) {
    tip.innerHTML = t ? `<span class="ip-welcome-tip-text">${esc(t)}</span>` : "";
  }

  root.setAttribute("aria-busy", "false");
}

function readCache(cfg: IpWelcomeConfig): Located | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Cached;
    if (!data.at || Date.now() - data.at > cfg.cacheHours * 3600 * 1000) return null;
    if (!data.lat || !data.lng) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(loc: Located): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...loc, at: Date.now() }));
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
}

async function locate(cfg: IpWelcomeConfig): Promise<Located | null> {
  const cached = readCache(cfg);
  if (cached) return cached;
  const chain = [fromPrimary, fromFallback];
  for (const step of chain) {
    try {
      const loc = await step(cfg);
      if (loc) {
        writeCache(loc);
        return loc;
      }
    } catch {
      /* 继续降级 */
    }
  }
  return null;
}

async function initIpWelcome(): Promise<void> {
  const root = document.getElementById(ROOT_ID);
  if (!root || root.dataset.ipInit === "1") return;
  root.dataset.ipInit = "1";
  const cfg = readConfig(root);
  try {
    const loc = await locate(cfg);
    if (loc) render(cfg, loc);
    else renderFallback(cfg);
  } catch {
    renderFallback(cfg);
  }
}

void initIpWelcome();
document.addEventListener("solitude:afterNavigate", () => void initIpWelcome());

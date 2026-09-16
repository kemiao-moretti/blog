/**
 * stats 数据统计页：写作热力图 + 月度产出趋势 + 标签分布 + 分类分布。
 *
 * 配色全部在运行时从 --efu-* / --candy-* 解析，本文件不出现任何字面色值。
 * ECharts 画在 canvas 上读不到 CSS 变量，而且 --efu-* 里大量使用 color-mix()，
 * getPropertyValue 只能拿到未求值的表达式（canvas 无法直接使用），
 * 所以借一个游离探针元素把颜色表达式交给浏览器求值后取回 rgb()。
 *
 * 生命周期对齐主题既有约定：Solitude.onPageCleanup 负责 pjax 切换时释放实例，
 * Solitude.navigate 走站内前端路由，Solitude.addEventListenerPjax 注册的元素级监听自动回收。
 */
import { Solitude } from "./core/api";

type Term = { name: string; value: number; url: string };
type DayPoint = { date: string; count: number };
type MonthPoint = { month: string; count: number };
type DayLabel = { show: boolean; firstDay: number; names: string[] };

type StatsData = {
  posts: number;
  words: number;
  activeDays: number;
  dayLabel: DayLabel;
  daily: DayPoint[];
  monthly: MonthPoint[];
  tags: Term[];
  categories: Term[];
};

type ChartKind = "heatmap" | "monthly" | "tags" | "categories";

type Tokens = {
  theme: string;
  card: string;
  second: string;
  font: string;
  muted: string;
  border: string;
  palette: string[];
};

type Ctx = {
  data: StatsData;
  tokens: Tokens;
  charts: Map<ChartKind, any>;
  years: string[];
  year: string;
  /* 上次热力图布局所用的容器宽度，用来判断是否需要重算格子边长 */
  heatmapWidth: number;
};

const SHELL_SEL = ".st-shell";
const DATA_ID = "stats-data";
const CHART_SEL = "[data-st-chart]";
const MONTH_LABELS = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
];
const PALETTE_TOKENS = [
  "--efu-theme",
  "--efu-blue",
  "--efu-pink",
  "--efu-green",
  "--efu-purple",
  "--efu-cyan",
  "--efu-red",
];

/* 热力图几何：cellSize 交给 ECharts 的 'auto' 推算会留出大片右侧空白，
   所以按容器实际宽度自己算格子边长，让网格铺满并保持正方形。
   星期标注要占左侧留白、月标注占上方（ECharts 只为后者留了 top），
   两处留白同样自己算；余量对半分给左右，让「标注 + 网格」整体居中。 */
const HEATMAP_WEEKS = 53;
const HEATMAP_TOP = 30;
const HEATMAP_PAD = 12;
/* 格子最小可读边长：再小 1px 描边就把格子吃掉了。
   容器不够宽时热力图横向滚动，而不是把 53 列压成细线。 */
const HEATMAP_MIN_CELL = 12;
/* 星期标注右缘到网格左缘的间距，与 dayLabel.margin 同源 */
const DAY_LABEL_MARGIN = 6;
/* 标注文字左缘到画布左缘的余量，避免贴边 */
const DAY_LABEL_SAFE = 12;
const DAY_LABEL_FONT_MAX = 11;
const DAY_LABEL_FONT_MIN = 9;

type HeatLayout = { cell: number; font: number; left: number; right: number; height: number };

/** 按字符类别估宽：CJK 约 1em，拉丁字母/数字约 0.62em —— 只为算左侧留白，不需要很精确 */
const textWidth = (text: string, fontSize: number): number =>
  [...text].reduce((sum, ch) => sum + (/[\u2e80-\u9fff\uf900-\ufaff]/.test(ch) ? 1 : 0.62), 0) * fontSize;

/** 星期标注需要的左侧留白；不显示时是 0，网格就能贴到画布左缘 */
const dayLabelGutter = (data: StatsData, fontSize: number): number => {
  const { show, names } = data.dayLabel ?? { show: false, names: [] };
  if (!show || !names.length) return 0;
  const widest = Math.max(...names.map((name) => textWidth(name, fontSize)));
  return Math.ceil(widest) + DAY_LABEL_MARGIN + DAY_LABEL_SAFE;
};

const cellSizeFor = (width: number, gutter: number): number =>
  width > 0
    ? Math.max(HEATMAP_MIN_CELL, Math.floor(Math.max(width - gutter - HEATMAP_PAD, 0) / HEATMAP_WEEKS))
    : HEATMAP_MIN_CELL;

const heatmapLayout = (width: number, data: StatsData): HeatLayout => {
  /* 字号、留白、格子边长互为因果：先按字号上限估一次格子，
     格子挤得放不下这个字号时再按格子收回字号，重算一次即收敛。 */
  let font = DAY_LABEL_FONT_MAX;
  let gutter = dayLabelGutter(data, font);
  let cell = cellSizeFor(width, gutter);

  if (gutter > 0 && cell < font + 3) {
    font = Math.max(DAY_LABEL_FONT_MIN, Math.round(cell * 0.85));
    gutter = dayLabelGutter(data, font);
    cell = cellSizeFor(width, gutter);
  }

  const room = Math.max(width - gutter - HEATMAP_PAD, 0);
  const slack = Math.max(0, room - cell * HEATMAP_WEEKS);
  return {
    cell,
    font,
    left: gutter + slack / 2,
    right: HEATMAP_PAD + slack / 2,
    height: HEATMAP_TOP + cell * 7 + 6,
  };
};

const heatmapMinWidth = (data: StatsData) =>
  HEATMAP_WEEKS * HEATMAP_MIN_CELL + dayLabelGutter(data, DAY_LABEL_FONT_MAX) + HEATMAP_PAD;

let ctx: Ctx | null = null;
let probe: HTMLSpanElement | null = null;
let themeObserver: MutationObserver | null = null;
let resizer: ResizeObserver | null = null;
let themeTimer = 0;
let resizeRaf = 0;
let initPromise: Promise<void> | null = null;
const mountTimers: number[] = [];

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/* ============================================================
   颜色解析：把 CSS 颜色表达式求值成 canvas 能吃的 rgb()
   ============================================================ */

const ensureProbe = (): HTMLSpanElement => {
  if (probe?.isConnected) return probe;
  probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:-9999px;width:0;height:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  return probe;
};

/**
 * 用 background-color 而不是 color 作探针属性：它的初始值是 transparent，
 * 表达式非法时声明整条被丢弃、读回来还是 transparent，正好当作失败信号；
 * 而 color 会继承父级颜色，非法时读到的仍是合法色值，无法判错。
 */
const resolveColor = (expr: string): string => {
  const el = ensureProbe();
  el.style.backgroundColor = "";
  el.style.backgroundColor = expr;
  const value = getComputedStyle(el).backgroundColor;
  return value && value !== "rgba(0, 0, 0, 0)" && value !== "transparent" ? value : "";
};

const token = (name: string) => resolveColor(`var(${name})`);
const themeMix = (pct: number) =>
  resolveColor(`color-mix(in srgb, var(--efu-theme) ${pct}%, var(--efu-card-bg))`);

/** 取同一个颜色的 0 透明度版本，用于面积渐变收尾（纯黑透明会在暗色下泛灰） */
const withAlpha = (color: string, alpha: number): string => {
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return "transparent";
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length < 3 ? "transparent" : `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
};

const readTokens = (): Tokens | null => {
  const theme = token("--efu-theme");
  const card = token("--efu-card-bg");
  const second = token("--efu-secondbg");
  const font = token("--efu-fontcolor");
  const muted = token("--efu-secondtext");
  const border = token("--efu-card-border");
  if (!theme || !card || !second || !font || !muted || !border) return null;

  const palette: string[] = [];
  for (const name of PALETTE_TOKENS) {
    const color = token(name);
    if (color && !palette.includes(color)) palette.push(color);
  }
  if (palette.length < 2) palette.push(theme);

  return { theme, card, second, font, muted, border, palette };
};

/* ============================================================
   ECharts option：共享的糖果风零件
   ============================================================ */

const tooltipOf = (t: Tokens) => ({
  backgroundColor: t.card,
  borderColor: t.border,
  borderWidth: 2,
  padding: [8, 12],
  textStyle: { color: t.font, fontSize: 13, fontFamily: "inherit" },
  extraCssText: `border-radius:0;box-shadow:4px 4px 0 ${t.border};`,
});

const axisOf = (t: Tokens) => ({
  axisLine: { lineStyle: { color: t.border, width: 2 } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, fontSize: 12 },
  splitLine: { lineStyle: { color: t.border, opacity: 0.2, type: "dashed" } },
});

/* 隐藏轴线时也要把 lineStyle 写成 token 色：ECharts 会把没声明的属性补成内置默认灰，
   那些默认值会留在 getOption() 的结果里，等于在主题体系外面挂了一条颜色 */
const hiddenAxisLine = (t: Tokens) => ({
  show: false,
  lineStyle: { color: t.border, width: 2 },
});

const baseOf = (t: Tokens) => ({
  textStyle: { fontFamily: "inherit" },
  animation: !prefersReducedMotion(),
  animationDuration: 700,
  animationEasing: "cubicOut",
  aria: { enabled: true },
  tooltip: tooltipOf(t),
});

const heatmapOption = (t: Tokens, data: StatsData, year: string, layout: HeatLayout): any => {
  const rows = data.daily.filter((d) => d.date.startsWith(year));
  const max = Math.max(1, ...rows.map((d) => d.count));
  const scale = [themeMix(28), themeMix(52), themeMix(76), t.theme].filter(Boolean);
  const { show, firstDay, names } = data.dayLabel ?? { show: false, firstDay: 0, names: [] };
  const withDayLabel = show && names.length > 0;

  return {
    ...baseOf(t),
    tooltip: {
      ...tooltipOf(t),
      formatter: (p: any) => `${p.value[0]}<br/>${p.value[1]} 篇`,
    },
    visualMap: { show: false, min: 0, max, inRange: { color: scale } },
    calendar: {
      top: HEATMAP_TOP,
      left: layout.left,
      right: layout.right,
      range: year,
      cellSize: layout.cell,
      splitLine: { show: false },
      itemStyle: { color: t.second, borderColor: t.border, borderWidth: 1, borderRadius: 2 },
      dayLabel: {
        show: withDayLabel,
        /* firstDay 决定哪一天落在第一行；nameMap 是按星期序号（0 = 周日）索引的，
           不随 firstDay 旋转，所以传进来的名字始终从周日排到周六。
           position: start 时标注落在网格左侧，垂直居中于各自那一行。 */
        firstDay,
        nameMap: withDayLabel ? names : "ZH",
        position: "start",
        margin: DAY_LABEL_MARGIN,
        color: t.muted,
        fontSize: layout.font,
      },
      monthLabel: { color: t.muted, fontSize: 11, nameMap: MONTH_LABELS },
      yearLabel: { show: false },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: rows.map((d) => [d.date, d.count]),
        itemStyle: { borderColor: t.border, borderWidth: 1, borderRadius: 2 },
        emphasis: {
          itemStyle: {
            borderColor: t.theme,
            borderWidth: 2,
            shadowBlur: 0,
            shadowOffsetX: 2,
            shadowOffsetY: 2,
            shadowColor: t.border,
          },
        },
      },
    ],
  };
};

const monthlyOption = (t: Tokens, monthly: MonthPoint[]): any => {
  const areaTop = token("--efu-theme-op") || t.second;

  return {
    ...baseOf(t),
    tooltip: {
      ...tooltipOf(t),
      trigger: "item",
      formatter: (param: any) => `${param.axisValueLabel ?? param.name ?? ""}<br/>${param.value} 篇`,
    },
    grid: { top: 34, left: 8, right: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: monthly.map((d) => d.month),
      boundaryGap: false,
      ...axisOf(t),
      splitLine: { show: false },
      axisLabel: { color: t.muted, fontSize: 12, formatter: (v: string) => v.replace("-", "/") },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      ...axisOf(t),
      axisLine: hiddenAxisLine(t),
    },
    series: [
      {
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 12,
        data: monthly.map((d) => d.count),
        lineStyle: { color: t.theme, width: 3 },
        itemStyle: { color: t.theme, borderColor: t.border, borderWidth: 2 },
        areaStyle: {
          color: new (window as any).echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: areaTop },
            { offset: 1, color: withAlpha(areaTop, 0) },
          ]),
        },
        label: { show: true, position: "top", color: t.font, fontWeight: 700, fontSize: 13 },
      },
    ],
  };
};

const tagsOption = (t: Tokens, tags: Term[]): any => ({
  ...baseOf(t),
  tooltip: { ...tooltipOf(t), trigger: "item", formatter: "{b}<br/>{c} 篇（{d}%）" },
  series: [
    {
      type: "pie",
      radius: ["42%", "68%"],
      center: ["50%", "48%"],
      data: tags.map((d) => ({ name: d.name, value: d.value })),
      color: t.palette,
      itemStyle: { borderColor: t.border, borderWidth: 2, borderRadius: 0 },
      label: { color: t.font, fontSize: 12, lineHeight: 16, formatter: "{b}\n{c}" },
      labelLine: { lineStyle: { color: t.border, width: 1 } },
      emphasis: {
        scale: true,
        scaleSize: 6,
        itemStyle: { borderColor: t.theme, borderWidth: 2 },
      },
    },
  ],
});

const categoriesOption = (t: Tokens, categories: Term[]): any => ({
  ...baseOf(t),
  tooltip: {
    ...tooltipOf(t),
    trigger: "item",
    formatter: (p: any) => `${p.name}<br/>${p.value} 篇`,
  },
  grid: { top: 16, left: 8, right: 48, bottom: 8, containLabel: true },
  xAxis: { type: "value", minInterval: 1, ...axisOf(t), axisLine: hiddenAxisLine(t) },
  yAxis: {
    type: "category",
    inverse: true,
    data: categories.map((d) => d.name),
    ...axisOf(t),
    splitLine: { show: false },
    axisLabel: { color: t.font, fontSize: 13 },
  },
  series: [
    {
      type: "bar",
      barWidth: 18,
      data: categories.map((d) => d.value),
      itemStyle: {
        color: themeMix(72) || t.theme,
        borderColor: t.border,
        borderWidth: 2,
        borderRadius: 0,
      },
      label: { show: true, position: "right", color: t.font, fontWeight: 700, fontSize: 13 },
      emphasis: { itemStyle: { color: t.theme } },
    },
  ],
});

const buildOption = (
  kind: ChartKind,
  t: Tokens,
  data: StatsData,
  year: string,
  layout: HeatLayout
): any => {
  if (kind === "heatmap") return heatmapOption(t, data, year, layout);
  if (kind === "monthly") return monthlyOption(t, data.monthly);
  if (kind === "tags") return tagsOption(t, data.tags);
  return categoriesOption(t, data.categories);
};

/* ============================================================
   渲染
   ============================================================ */

const applyOption = (kind: ChartKind) => {
  if (!ctx) return;
  const chart = ctx.charts.get(kind);
  if (!chart) return;

  const el = document.querySelector<HTMLElement>(`[data-st-chart="${kind}"]`);
  const { data } = ctx;

  // 热力图：先钉最小宽度再量宽，窄屏量到的是最小宽度而不是被压扁的容器宽，
  // 于是格子边长、左侧留白、画布高度都从同一个 layout 派生，不会互相错位
  if (kind === "heatmap" && el) {
    el.style.minWidth = `${heatmapMinWidth(data)}px`;
    const width = el.clientWidth;
    if (width > 0) {
      el.style.height = `${heatmapLayout(width, data).height}px`;
      ctx.heatmapWidth = width;
    }
  }

  const layout = heatmapLayout(el?.clientWidth ?? 0, data);
  chart.setOption(buildOption(kind, ctx.tokens, data, ctx.year, layout), true);
};

const renderLegend = () => {
  if (!ctx) return;
  const scale = document.querySelector<HTMLElement>("[data-st-legend-scale]");
  if (!scale) return;
  const { tokens } = ctx;
  const steps = [tokens.second, themeMix(28), themeMix(52), themeMix(76), tokens.theme];

  scale.replaceChildren(
    ...steps.map((color) => {
      const cell = document.createElement("span");
      cell.className = "st-legend-cell";
      if (color) cell.style.background = color;
      return cell;
    })
  );
};

const renderYears = () => {
  if (!ctx) return;
  const box = document.querySelector<HTMLElement>("[data-st-years]");
  if (!box) return;

  box.replaceChildren();
  // 只有一个年份时不渲染切换器：一个按钮切不了什么，纯噪音
  if (ctx.years.length < 2) {
    box.hidden = true;
    return;
  }

  box.hidden = false;
  for (const year of ctx.years) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "st-year";
    button.textContent = year;
    button.dataset.stYear = year;
    button.setAttribute("aria-pressed", String(year === ctx.year));

    Solitude.addEventListenerPjax(button, "click", () => {
      if (!ctx || ctx.year === year) return;
      ctx.year = year;
      box.querySelectorAll<HTMLButtonElement>(".st-year").forEach((el) => {
        el.setAttribute("aria-pressed", String(el.dataset.stYear === year));
      });
      applyOption("heatmap");
      renderLegend();
    });

    box.appendChild(button);
  }
};

const bindJump = (chart: any, kind: ChartKind) => {
  chart.on("click", (params: any) => {
    if (!ctx) return;
    const list = kind === "tags" ? ctx.data.tags : ctx.data.categories;
    const url = list[params.dataIndex]?.url;
    if (!url) return;
    if (typeof Solitude.navigate === "function") Solitude.navigate(url);
    else window.location.assign(url);
  });
  chart.on("mouseover", () => chart.getZr().setCursorStyle("pointer"));
  chart.on("mouseout", () => chart.getZr().setCursorStyle("default"));
};

const ensureResizer = (): ResizeObserver => {
  if (!resizer) {
    resizer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(() => {
        if (!ctx) return;
        // 容器宽度变了必须重建 calendar 布局：格子边长是写进 option 的具体数值，
        // 只调 chart.resize() 不会重算，网格会既不铺满也不居中。
        const el = document.querySelector<HTMLElement>('[data-st-chart="heatmap"]');
        if (el && el.clientWidth > 0 && el.clientWidth !== ctx.heatmapWidth) {
          applyOption("heatmap");
        }
        ctx.charts.forEach((chart) => chart.resize());
      });
    });
  }
  return resizer;
};

const mountChart = (kind: ChartKind, el: HTMLElement) => {
  if (!ctx || ctx.charts.has(kind)) return;
  const library = (window as any).echarts;
  if (!library) return;

  const chart = library.init(el, undefined, { renderer: "canvas" });
  ctx.charts.set(kind, chart);
  applyOption(kind);
  if (kind === "tags" || kind === "categories") bindJump(chart, kind);
  ensureResizer().observe(el);
};

/* ============================================================
   生命周期
   ============================================================ */

const observeTheme = () => {
  themeObserver?.disconnect();
  themeObserver = new MutationObserver(() => {
    window.clearTimeout(themeTimer);
    // 主题切换只改 data-theme 属性，自定义属性本身不做过渡；
    // 留一拍让样式重算落定，避免取到中间值。
    themeTimer = window.setTimeout(() => {
      if (!ctx) return;
      const tokens = readTokens();
      if (!tokens) return;
      ctx.tokens = tokens;
      ctx.charts.forEach((_chart, kind) => applyOption(kind));
      renderLegend();
    }, 120);
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
};

const teardown = () => {
  mountTimers.splice(0).forEach((timer) => window.clearTimeout(timer));
  ctx?.charts.forEach((chart) => {
    try {
      chart.dispose();
    } catch (error) {
      console.error("Failed to dispose a stats chart:", error);
    }
  });
  ctx = null;
  themeObserver?.disconnect();
  themeObserver = null;
  resizer?.disconnect();
  resizer = null;
  window.clearTimeout(themeTimer);
  window.cancelAnimationFrame(resizeRaf);
  probe?.remove();
  probe = null;
};

const waitForECharts = async (timeout = 6000): Promise<any> => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const library = (window as any).echarts;
    if (library) return library;
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }
  return null;
};

const ensureECharts = async () => {
  if ((window as any).echarts) return;
  const url = Solitude.config?.cdn?.echarts;
  if (!url) return;
  try {
    await Solitude.loadScript(url);
  } catch (error) {
    console.error("Failed to load ECharts:", error);
  }
};

const initStats = async () => {
  if (initPromise) return initPromise;
  initPromise = initStatsOnce();
  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
};

const initStatsOnce = async () => {
  const shell = document.querySelector<HTMLElement>(SHELL_SEL);
  const holder = document.getElementById(DATA_ID);
  if (!shell || !holder || shell.dataset.stReady === "1") return;

  let data: StatsData;
  try {
    // <template> 的子节点落在 content（DocumentFragment）里，
    // 直接读 template.textContent 恒为空串 —— 这是主题 archive-page 踩过的同一个坑。
    const template = holder as HTMLTemplateElement;
    const raw = (template.content?.textContent || holder.textContent || "").trim();
    if (!raw) return;
    data = JSON.parse(raw);
  } catch (error) {
    console.error("Failed to parse stats data:", error);
    return;
  }
  if (!Array.isArray(data?.daily) || data.daily.length === 0) return;

  await ensureECharts();
  const library = await waitForECharts();
  if (!library) return;

  // 页面可能在等待期间被 pjax 换走
  if (!shell.isConnected) return;

  const tokens = readTokens();
  if (!tokens) return;

  shell.dataset.stReady = "1";
  Solitude.onPageCleanup(teardown);

  const years = [...new Set(data.daily.map((d) => d.date.slice(0, 4)))].sort().reverse();
  ctx = { data, tokens, charts: new Map(), years, year: years[0], heatmapWidth: 0 };

  renderLegend();
  renderYears();

  const targets = new Map<ChartKind, HTMLElement>();
  shell.querySelectorAll<HTMLElement>(CHART_SEL).forEach((el) => {
    const kind = el.dataset.stChart as ChartKind | undefined;
    if (kind) targets.set(kind, el);
  });

  // 一次编排好的入场：图表按顺序错峰初始化，而不是同时弹出来
  const order: ChartKind[] = ["heatmap", "monthly", "tags", "categories"];
  const step = prefersReducedMotion() ? 0 : 90;
  order.forEach((kind, index) => {
    const el = targets.get(kind);
    if (!el) return;
    const timer = window.setTimeout(() => {
      const timerIndex = mountTimers.indexOf(timer);
      if (timerIndex >= 0) mountTimers.splice(timerIndex, 1);
      mountChart(kind, el);
    }, index * step);
    mountTimers.push(timer);
  });

  observeTheme();
};

initStats();
document.addEventListener("solitude:afterNavigate", () => void initStats());

import { Solitude } from "./core/api";

/**
 * 友链朋友圈（/fcircle/）：从自托管 hexo-circle-of-friends 后端拉取友链文章。
 * - 数据源与开关来自容器 data-* 属性（Hugo 模板注入）
 * - 整表只请求一次 /all，前端做增量加载（"再来亿点"）
 * - sessionStorage 缓存，避免短时间重复请求
 * - 统计栏 / 随机钓鱼 / 作者文章弹窗 / 排序切换，全部为本地计算，零额外请求
 * - 颜色与尺寸全部交给 --efu-* token，明暗与多端由 CSS 负责
 */

interface FcArticle {
  floor?: number;
  title?: string;
  created?: string;
  updated?: string;
  link?: string;
  author?: string;
  avatar?: string;
  summary?: string | null;
  ai_model?: string | null;
  summary_updated_at?: string | null;
}

interface FcStats {
  friends_num?: number;
  active_num?: number;
  error_num?: number;
  article_num?: number;
  last_updated_time?: string;
}

interface FcPayload {
  statistical_data?: FcStats;
  article_data?: FcArticle[];
}

type SortKey = "created" | "updated";

interface PageConfig {
  api: string;
  pageSize: number;
  cacheMinutes: number;
  errorImg: string;
  randomPost: boolean;
  authorModal: boolean;
  sortToggle: boolean;
  limit: number;
  labels: {
    random: string;
    refresh: string;
    visit: string;
    caught: string;
    caughtSuffix: string;
    sortCreated: string;
    sortUpdated: string;
    empty: string;
    error: string;
    more: string;
    noMore: string;
  };
}

const CACHE_KEY = "solitude-fcircle-cache";
const CACHE_TIME_KEY = "solitude-fcircle-cache-time";
const SORT_KEY = "solitude-fcircle-sort";

const readConfig = (root: HTMLElement): PageConfig => ({
  api: (root.dataset.api || "").replace(/\/$/, ""),
  pageSize: Math.max(1, Number(root.dataset.pageSize) || 24),
  cacheMinutes: Math.max(0, Number(root.dataset.cacheMinutes) || 0),
  errorImg: root.dataset.errorImg || "",
  randomPost: root.dataset.randomPost !== "false",
  authorModal: root.dataset.authorModal !== "false",
  sortToggle: root.dataset.sortToggle !== "false",
  limit: Number(root.dataset.limit) || 0,
  labels: {
    random: root.dataset.labelRandom || "随机钓鱼",
    refresh: root.dataset.labelRefresh || "换一条",
    visit: root.dataset.labelVisit || "看看",
    caught: root.dataset.labelCaught || "钓到了",
    caughtSuffix: root.dataset.labelCaughtSuffix || "的文章：",
    sortCreated: root.dataset.labelSortCreated || "按发布时间排序",
    sortUpdated: root.dataset.labelSortUpdated || "按更新时间排序",
    empty: root.dataset.labelEmpty || "暂时还没有友链文章",
    error: root.dataset.labelError || "加载失败，请稍后重试。",
    more: root.dataset.labelMore || "再来亿点",
    noMore: root.dataset.labelNoMore || "没有更多了",
  },
});

/* ---------------- 工具 ---------------- */

const escapeHtml = (source: string) =>
  source.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c] as string));

const dateOf = (value?: string) => {
  const raw = (value || "").trim();
  if (!raw) return "";
  return raw.slice(0, 10);
};

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

const readCache = (config: PageConfig): FcPayload | null => {
  if (config.cacheMinutes <= 0) return null;
  try {
    const stamp = Number(sessionStorage.getItem(CACHE_TIME_KEY)) || 0;
    if (!stamp || Date.now() - stamp > config.cacheMinutes * 60_000) return null;
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as FcPayload) : null;
  } catch {
    return null;
  }
};

const writeCache = (config: PageConfig, payload: FcPayload) => {
  if (config.cacheMinutes <= 0) return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    sessionStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
  } catch {
    /* 隐私模式或超配额时静默降级 */
  }
};

const fetchAll = async (config: PageConfig): Promise<FcPayload> => {
  const cached = readCache(config);
  if (cached) return cached;
  const url = config.api.endsWith("/all") || config.api.includes("/all") ? config.api : `${config.api}/all`;
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as FcPayload;
  writeCache(config, payload);
  return payload;
};

/* ---------------- 初始化 ---------------- */

const initFcircle = async () => {
  const root = document.getElementById("fcircle");
  if (!root || root.dataset.initialized === "1") return;
  root.dataset.initialized = "1";
  const config = readConfig(root);
  if (!config.api) return;

  const statsBox = root.querySelector<HTMLElement>("#fcircle-stats");
  const randomBox = root.querySelector<HTMLElement>("#fcircle-random");
  const randomAuthor = root.querySelector<HTMLElement>("#fcircle-random-author");
  const randomTitle = root.querySelector<HTMLElement>("#fcircle-random-title");
  const randomRefresh = root.querySelector<HTMLElement>("#fcircle-random-refresh");
  const randomVisit = root.querySelector<HTMLElement>("#fcircle-random-visit");
  const toolbar = root.querySelector<HTMLElement>("#fcircle-toolbar");
  const sortButton = root.querySelector<HTMLElement>("#fcircle-sort-toggle");
  const list = root.querySelector<HTMLElement>("#fcircle-list");
  const loading = root.querySelector<HTMLElement>("#fcircle-loading");
  const footer = root.querySelector<HTMLElement>("#fcircle-footer");
  const moreButton = root.querySelector<HTMLElement>("#fcircle-more");
  const credit = root.querySelector<HTMLElement>("#fcircle-credit");
  const modal = document.getElementById("fcircle-modal");

  if (!list || !moreButton) return;

  let articles: FcArticle[] = [];
  let stats: FcStats = {};
  let sortKey: SortKey = (sessionStorage.getItem(SORT_KEY) as SortKey) === "updated" ? "updated" : "created";
  let cursor = 0;
  let randomArticle: FcArticle | null = null;

  const setState = (html: string, tone = "") => {
    if (!loading) return;
    loading.hidden = false;
    loading.className = `fcircle-state${tone ? ` is-${tone}` : ""}`;
    loading.innerHTML = html;
  };

  const sorted = (): FcArticle[] => {
    const list_ = [...articles];
    list_.sort((a, b) => String(b[sortKey] || "").localeCompare(String(a[sortKey] || "")));
    return list_;
  };

  const avatarSrc = (item: FcArticle) => item.avatar || config.errorImg;

  const bindAvatarFallback = (scope: HTMLElement) => {
    scope.querySelectorAll<HTMLImageElement>("img[data-fc-avatar]").forEach((img) => {
      img.addEventListener("error", () => {
        if (config.errorImg && img.src !== config.errorImg) img.src = config.errorImg;
      }, { once: true });
    });
  };

  const buildCard = (item: FcArticle): HTMLElement => {
    const card = document.createElement("article");
    card.className = "fcircle-card";

    const title = document.createElement("a");
    title.className = "fcircle-card-title";
    title.href = item.link || "#";
    title.target = "_blank";
    title.rel = "noopener noreferrer nofollow";
    title.textContent = item.title || "无标题";
    card.append(title);

    if (item.summary) {
      const summary = document.createElement("p");
      summary.className = "fcircle-card-summary";
      summary.textContent = item.summary;
      card.append(summary);
    }

    const meta = document.createElement("div");
    meta.className = "fcircle-card-meta";

    const author = document.createElement(config.authorModal ? "button" : "div");
    author.className = "fcircle-card-author";
    if (config.authorModal) (author as HTMLButtonElement).type = "button";
    if (config.authorModal) author.setAttribute("aria-label", item.author || "");
    const img = document.createElement("img");
    img.className = "fcircle-card-avatar no-lightbox";
    img.loading = "lazy";
    img.decoding = "async";
    img.setAttribute("data-fc-avatar", "");
    img.src = avatarSrc(item);
    img.alt = "";
    const name = document.createElement("span");
    name.className = "fcircle-card-name";
    name.textContent = item.author || "匿名";
    author.append(img, name);
    author.dataset.author = item.author || "";
    author.dataset.avatar = avatarSrc(item);
    author.dataset.link = item.link || "";
    meta.append(author);

    const date = document.createElement("time");
    date.className = "fcircle-card-date";
    date.textContent = dateOf(sortKey === "updated" ? item.updated : item.created);
    meta.append(date);

    card.append(meta);
    return card;
  };

  const renderBatch = () => {
    const data = sorted();
    const end = config.limit > 0 ? Math.min(cursor + config.pageSize, config.limit, data.length) : Math.min(cursor + config.pageSize, data.length);
    const slice = data.slice(cursor, end);
    const fragment = document.createDocumentFragment();
    slice.forEach((item) => fragment.append(buildCard(item)));
    list.append(fragment);
    bindAvatarFallback(list);
    cursor = end;
    if (loading) loading.hidden = true;
    if (cursor >= data.length || (config.limit > 0 && cursor >= config.limit)) {
      moreButton.textContent = config.labels.noMore;
      moreButton.disabled = true;
      moreButton.classList.add("is-done");
    } else {
      moreButton.textContent = config.labels.more;
      moreButton.disabled = false;
      moreButton.classList.remove("is-done");
    }
    window.lazyLoadInstance?.update?.();
  };

  const renderStats = () => {
    if (!statsBox) return;
    const cells = [
      [stats.friends_num ?? 0, root.dataset.labelStatFriends || "订阅"],
      [stats.active_num ?? 0, root.dataset.labelStatActive || "活跃"],
      [stats.article_num ?? 0, root.dataset.labelStatArticles || "文章"],
    ];
    const cellHtml = cells
      .map(([value, label]) => `<div class="fcircle-stat"><span class="fcircle-stat-value">${escapeHtml(String(value))}</span><span class="fcircle-stat-label">${escapeHtml(String(label))}</span></div>`)
      .join("");
    const updated = stats.last_updated_time
      ? `<span class="fcircle-stats-time">${escapeHtml(root.dataset.labelStatUpdated || "更新于")} ${escapeHtml(stats.last_updated_time)}</span>`
      : "";
    statsBox.innerHTML = `<div class="fcircle-stats-grid">${cellHtml}</div>${updated}`;
    statsBox.hidden = false;
  };

  const pickRandom = () => {
    if (!articles.length || !randomAuthor || !randomTitle) return;
    randomArticle = articles[Math.floor(Math.random() * articles.length)];
    randomAuthor.textContent = randomArticle.author || "匿名";
    randomTitle.textContent = randomArticle.title || "无标题";
  };

  const renderSortLabel = () => {
    if (!sortButton) return;
    const next = sortKey === "created" ? config.labels.sortUpdated : config.labels.sortCreated;
    sortButton.textContent = next;
    sortButton.setAttribute("aria-label", next);
  };

  const applySort = () => {
    sortKey = sortKey === "created" ? "updated" : "created";
    try {
      sessionStorage.setItem(SORT_KEY, sortKey);
    } catch { /* 忽略 */ }
    cursor = 0;
    list.replaceChildren();
    renderBatch();
    renderSortLabel();
  };

  const openAuthorModal = (author: string, avatar: string, link: string) => {
    if (!modal) return;
    const avatarEl = modal.querySelector<HTMLImageElement>("#fcircle-modal-avatar");
    const nameEl = modal.querySelector<HTMLAnchorElement>("#fcircle-modal-name");
    const listEl = modal.querySelector<HTMLElement>("#fcircle-modal-list");
    if (!avatarEl || !nameEl || !listEl) return;

    avatarEl.src = avatar || config.errorImg;
    avatarEl.alt = "";
    nameEl.textContent = author || "匿名";
    nameEl.href = link ? originOf(link) : "#";

    const owned = sorted().filter((item) => (item.author || "") === author).slice(0, 8);
    listEl.replaceChildren();
    owned.forEach((item) => {
      const row = document.createElement("a");
      row.className = "fcircle-modal-item";
      row.href = item.link || "#";
      row.target = "_blank";
      row.rel = "noopener noreferrer nofollow";
      const t = document.createElement("span");
      t.className = "fcircle-modal-item-title";
      t.textContent = item.title || "无标题";
      const d = document.createElement("span");
      d.className = "fcircle-modal-item-date";
      d.textContent = dateOf(item.created);
      row.append(t, d);
      listEl.append(row);
    });
    if (!owned.length) {
      const empty = document.createElement("p");
      empty.className = "fcircle-modal-empty";
      empty.textContent = config.labels.empty;
      listEl.append(empty);
    }

    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("is-open"));
    modal.querySelector<HTMLElement>(".fcircle-modal-close")?.focus();
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove("is-open");
    const done = () => {
      modal.hidden = true;
      modal.removeEventListener("transitionend", done);
    };
    modal.addEventListener("transitionend", done, { once: true });
    setTimeout(() => { if (!modal.classList.contains("is-open")) modal.hidden = true; }, 320);
  };

  /* ---------------- 事件绑定（pjax 前会 dispose） ---------------- */

  moreButton.addEventListener("click", () => renderBatch());

  randomRefresh?.addEventListener("click", () => pickRandom());
  randomVisit?.addEventListener("click", () => {
    if (randomArticle?.link) window.open(randomArticle.link, "_blank", "noopener,noreferrer");
  });

  sortButton?.addEventListener("click", () => applySort());

  list.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const author = target.closest<HTMLElement>(".fcircle-card-author");
    if (!author || !config.authorModal) return;
    event.preventDefault();
    openAuthorModal(author.dataset.author || "", author.dataset.avatar || "", author.dataset.link || "");
  });

  if (modal) {
    modal.querySelectorAll("[data-fcircle-close]").forEach((el) => {
      el.addEventListener("click", () => closeModal());
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  /* ---------------- 启动 ---------------- */

  renderSortLabel();
  if (toolbar && config.sortToggle) toolbar.hidden = false;
  else if (toolbar) toolbar.hidden = true;

  setState(`<i class="solitude fas fa-spinner fa-spin" aria-hidden="true"></i><span>${escapeHtml(root.dataset.labelLoading || "加载中")}</span>`);

  try {
    const payload = await fetchAll(config);
    articles = Array.isArray(payload.article_data) ? payload.article_data : [];
    stats = payload.statistical_data || {};

    if (!articles.length) {
      setState(`<span>${escapeHtml(config.labels.empty)}</span>`, "empty");
      if (footer) footer.hidden = true;
      return;
    }

    renderStats();
    if (loading) loading.hidden = true;
    cursor = 0;
    list.replaceChildren();
    renderBatch();
    if (footer) footer.hidden = false;
    if (statsBox) window.lazyLoadInstance?.update?.();

    if (randomBox && config.randomPost && articles.length) {
      randomBox.hidden = false;
      pickRandom();
    }

    if (credit) {
      credit.hidden = false;
      credit.innerHTML = `<a href="https://github.com/kemiao-moretti/hexo-circle-of-friends" target="_blank" rel="noopener noreferrer">Hexo Circle of Friends</a>${credit.dataset.creditText ? ` · ${escapeHtml(credit.dataset.creditText)}` : ""}`;
    }
  } catch (error) {
    console.error("[fcircle]", error);
    setState(`<span>${escapeHtml(config.labels.error)}</span>`, "error");
    if (footer) footer.hidden = true;
  }
};

document.addEventListener("solitude:ready", () => void initFcircle());
document.addEventListener("solitude:afterNavigate", () => void initFcircle());
if (document.readyState !== "loading") void initFcircle();

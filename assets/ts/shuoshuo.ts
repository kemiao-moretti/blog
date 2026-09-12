import { Solitude } from "./core/api";

/**
 * 说说页（/shuoshuo/）：从自托管 Ech0 实时拉取数据并渲染瀑布流卡片。
 * - 数据源与开关全部来自页面容器的 data-* 属性（Hugo 模板注入）
 * - Markdown 用 marked 渲染、DOMPurify 净化（懒加载，仅本页需要）
 * - 图片统一交给主题 fancybox 灯箱
 * - 点赞走 Ech0 PUT /echo/like/{id}，本地记录防重复
 */

interface EchoFile {
  id?: string;
  url?: string;
  path?: string;
  file_url?: string;
  category?: string;
  mime_type?: string;
}

interface EchoExtension {
  type?: string;
  payload?: Record<string, unknown>;
}

interface EchoTag {
  id?: string;
  name?: string;
}

interface EchoItem {
  id: string;
  content?: string;
  username?: string;
  layout?: string;
  echo_files?: EchoFile[];
  extension?: EchoExtension;
  tags?: EchoTag[];
  fav_count?: number;
  created_at?: number;
}

interface PageConfig {
  api: string;
  pageSize: number;
  cacheMinutes: number;
  authorName: string;
  authorAvatar: string;
  like: boolean;
  tags: boolean;
  extensions: Record<string, boolean>;
  markedUrl: string;
  dompurifyUrl: string;
}

const LIKED_KEY = "solitude-shuoshuo-liked";
const cachedScripts: Record<string, Promise<unknown> | undefined> = {};

const loadRemote = (url: string, globalName: string) => {
  if ((window as any)[globalName]) return Promise.resolve((window as any)[globalName]);
  if (!cachedScripts[globalName]) {
    cachedScripts[globalName] = Solitude.loadScript(url)
      .then(() => (window as any)[globalName])
      .catch((error) => {
        cachedScripts[globalName] = undefined;
        throw error;
      });
  }
  return cachedScripts[globalName];
};

const readConfig = (root: HTMLElement): PageConfig => ({
  api: (root.dataset.api || "").replace(/\/$/, ""),
  pageSize: Number(root.dataset.pageSize) || 30,
  cacheMinutes: Number(root.dataset.cacheMinutes) || 30,
  authorName: root.dataset.authorName || "",
  authorAvatar: root.dataset.authorAvatar || "",
  like: root.dataset.like === "true",
  tags: root.dataset.tags === "true",
  extensions: {
    GITHUBPROJ: root.dataset.extGithub === "true",
    WEBSITE: root.dataset.extWebsite === "true",
    MUSIC: root.dataset.extMusic === "true",
    VIDEO: root.dataset.extVideo === "true",
    TWEET: root.dataset.extTweet === "true",
    LOCATION: root.dataset.extLocation === "true",
  },
  markedUrl: root.dataset.marked || "",
  dompurifyUrl: root.dataset.dompurify || "",
});

/* ---------------- 工具 ---------------- */

const escapeHtml = (source: string) =>
  source.replace(/[&<>'"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c] as string));

const formatTime = (stamp?: number) => {
  if (!stamp) return "";
  const ms = stamp < 1e10 ? stamp * 1000 : stamp;
  const date = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const fileUrl = (config: PageConfig, file: EchoFile) => {
  const raw = file.url || file.path || file.file_url || "";
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${config.api}${raw.startsWith("/") ? "" : "/"}${raw}`;
};

const isImageFile = (file: EchoFile) => {
  const type = (file.mime_type || "").toLowerCase();
  const name = (file.url || file.path || file.file_url || "").toLowerCase();
  if (type.startsWith("image/")) return true;
  if (file.category && /image/i.test(file.category)) return true;
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(name);
};

const likedIds = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(LIKED_KEY) || "[]");
  } catch {
    return [];
  }
};

const rememberLike = (id: string) => {
  try {
    const list = likedIds();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem(LIKED_KEY, JSON.stringify(list));
    }
  } catch {
    /* 隐私模式下 localStorage 不可用，忽略 */
  }
};

/* ---------------- Markdown ---------------- */

const renderMarkdown = async (config: PageConfig, content: string) => {
  const source = content || "";
  if (!source) return "";
  try {
    const [marked, purify] = await Promise.all([
      loadRemote(config.markedUrl, "marked"),
      config.dompurifyUrl ? loadRemote(config.dompurifyUrl, "DOMPurify") : Promise.resolve(undefined),
    ]);
    const raw = (marked as any)?.parse
      ? (marked as any).parse(source, { breaks: true, gfm: true })
      : escapeHtml(source).replace(/\n/g, "<br>");
    const clean = (purify as any)?.sanitize ? (purify as any).sanitize(raw) : raw;
    return clean;
  } catch {
    // 库加载失败时降级为纯文本，保证内容可见
    return escapeHtml(source).replace(/\n/g, "<br>");
  }
};

/* ---------------- 扩展卡片 ---------------- */

const str = (payload: Record<string, unknown> | undefined, key: string) => {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value);
};

const buildExtensionCard = (config: PageConfig, extension?: EchoExtension) => {
  const type = extension?.type || "";
  if (!type || !config.extensions[type]) return "";
  const payload = extension?.payload || {};

  if (type === "GITHUBPROJ") {
    const repoUrl = str(payload, "repoUrl");
    if (!repoUrl) return "";
    const repoName = repoUrl.replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, "");
    return `<a class="shuoshuo-ext ext-github" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer">
      <i class="solitude fab fa-github" aria-hidden="true"></i>
      <span class="ext-github-name">${escapeHtml(repoName)}</span>
      <span class="ext-github-hint">GitHub</span>
    </a>`;
  }

  if (type === "WEBSITE") {
    const site = str(payload, "site");
    const title = str(payload, "title") || domainOf(site);
    if (!site) return "";
    return `<a class="shuoshuo-ext ext-website" href="${escapeHtml(site)}" target="_blank" rel="noopener noreferrer">
      <i class="solitude fas fa-link" aria-hidden="true"></i>
      <span class="ext-website-title">${escapeHtml(title)}</span>
      <span class="ext-website-domain">${escapeHtml(domainOf(site))}</span>
    </a>`;
  }

  if (type === "MUSIC") {
    const url = str(payload, "url") || str(payload, "musicUrl");
    if (!url) return "";
    return `<a class="shuoshuo-ext ext-music" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      <i class="solitude fas fa-music" aria-hidden="true"></i>
      <span>音乐分享</span>
    </a>`;
  }

  if (type === "VIDEO") {
    const id = str(payload, "videoId");
    const platform = str(payload, "platform").toLowerCase();
    if (!id) return "";
    const isBili = platform.includes("bili") || /^BV/i.test(id);
    const src = isBili
      ? `https://www.bilibili.com/blackboard/html5mobileplayer.html?bvid=${encodeURIComponent(id)}&as_wide=1&high_quality=1&danmaku=0`
      : `https://www.youtube.com/embed/${encodeURIComponent(id)}`;
    return `<div class="shuoshuo-ext ext-video">
      <iframe src="${escapeHtml(src)}" loading="lazy" frameborder="0" allowfullscreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
    </div>`;
  }

  if (type === "TWEET") {
    const url = str(payload, "url");
    const username = str(payload, "username");
    if (!url) return "";
    return `<a class="shuoshuo-ext ext-tweet" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      <i class="solitude fab fa-x-twitter" aria-hidden="true"></i>
      <span>${escapeHtml(username ? `@${username.replace(/^@/, "")}` : "X 推文")}</span>
    </a>`;
  }

  if (type === "LOCATION") {
    const place = str(payload, "placeholder");
    const lat = str(payload, "latitude");
    const lng = str(payload, "longitude");
    if (!place && !lat) return "";
    const mapUrl = lat && lng ? `https://uri.amap.com/marker?position=${lng},${lat}` : "";
    const inner = `<i class="solitude fas fa-location-dot" aria-hidden="true"></i><span>${escapeHtml(place || "位置")}</span>`;
    return mapUrl
      ? `<a class="shuoshuo-ext ext-location" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<div class="shuoshuo-ext ext-location">${inner}</div>`;
  }

  return "";
};

/* ---------------- 卡片渲染 ---------------- */

const buildCard = async (config: PageConfig, item: EchoItem) => {
  const card = document.createElement("article");
  card.className = "shuoshuo-card";
  card.dataset.id = item.id;

  const header = document.createElement("div");
  header.className = "shuoshuo-card-header";
  header.innerHTML = `<img class="shuoshuo-avatar no-lightbox" src="${escapeHtml(config.authorAvatar)}" alt="" loading="lazy">
    <div class="shuoshuo-author">
      <span class="shuoshuo-name">${escapeHtml(item.username || config.authorName)}</span>
      <time class="shuoshuo-time" datetime="${escapeHtml(formatTime(item.created_at))}">${escapeHtml(formatTime(item.created_at))}</time>
    </div>`;
  card.append(header);

  const body = document.createElement("div");
  body.className = "shuoshuo-card-body";
  const html = await renderMarkdown(config, item.content || "");
  body.innerHTML = html || "";
  card.append(body);

  const extension = buildExtensionCard(config, item.extension);
  if (extension) {
    const wrap = document.createElement("div");
    wrap.className = "shuoshuo-ext-wrap";
    wrap.innerHTML = extension;
    card.append(wrap);
  }

  // 图片（含正文内嵌图 + echo_files）
  const images = (item.echo_files || []).filter(isImageFile).map((file) => fileUrl(config, file));
  const inlineImages = [...body.querySelectorAll("img")].map((img) => img.getAttribute("src") || "");
  const allImages = [...new Set([...inlineImages, ...images])].filter(Boolean);
  if (images.length) {
    const gallery = document.createElement("div");
    gallery.className = "shuoshuo-gallery";
    images.forEach((url) => {
      const link = document.createElement("a");
      link.className = "shuoshuo-image";
      link.href = url;
      link.setAttribute("data-fancybox", "shuoshuo-gallery");
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => link.classList.add("is-broken"), { once: true });
      link.append(img);
      gallery.append(link);
    });
    card.append(gallery);
  }

  const footer = document.createElement("div");
  footer.className = "shuoshuo-card-footer";

  if (config.tags && item.tags?.length) {
    const tags = document.createElement("div");
    tags.className = "shuoshuo-card-tags";
    item.tags.forEach((tag) => {
      if (!tag.name) return;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "shuoshuo-tag";
      chip.dataset.tag = tag.name;
      chip.dataset.tagId = tag.id || "";
      chip.textContent = `#${tag.name}`;
      tags.append(chip);
    });
    footer.append(tags);
  }

  const actions = document.createElement("div");
  actions.className = "shuoshuo-actions";

  if (config.like) {
    const like = document.createElement("button");
    like.type = "button";
    like.className = "shuoshuo-like";
    like.dataset.echoId = item.id;
    if (likedIds().includes(item.id)) like.classList.add("liked");
    like.innerHTML = `<i class="solitude fas fa-heart" aria-hidden="true"></i><span class="like-count">${Number(item.fav_count) || 0}</span>`;
    actions.append(like);
  }

  const quote = document.createElement("button");
  quote.type = "button";
  quote.className = "shuoshuo-quote";
  quote.dataset.solitudeAction = "toTalk";
  quote.dataset.solitudeValue = (item.content || "").slice(0, 200);
  quote.title = "引用并评论";
  quote.innerHTML = `<i class="solitude fas fa-comment-dots" aria-hidden="true"></i><span>引用</span>`;
  actions.append(quote);

  footer.append(actions);
  card.append(footer);

  // 记录图片供灯箱使用（卡片插入后再统一初始化）
  card.dataset.imageCount = String(allImages.length);
  return card;
};

/* ---------------- 数据 ---------------- */

const cacheKey = (config: PageConfig, page: number, tagId: string) =>
  `solitude-shuoshuo:v2:${config.api}:${page}:${config.pageSize}:${tagId}`;

const fetchPage = async (config: PageConfig, page: number, tagId: string) => {
  const key = cacheKey(config, page, tagId);
  const ttl = config.cacheMinutes * 60 * 1000;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw) as { time: number; data: unknown };
      if (Date.now() - cached.time < ttl) return cached.data as { items: EchoItem[]; total: number };
    }
  } catch {
    /* ignore */
  }

  // 标签筛选走 Ech0 专用接口（tag id 而非名称）：search 只匹配正文文本
  const response = tagId
    ? await fetch(`${config.api}/api/echo/tag/${encodeURIComponent(tagId)}`)
    : await fetch(`${config.api}/api/echo/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, pageSize: config.pageSize, search: "" }),
      });
  if (!response.ok) throw new Error(`Ech0 请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.code !== 1 || !Array.isArray(payload?.data?.items)) {
    throw new Error("Ech0 返回格式异常");
  }
  // 标签接口不分页，本地切片维持分页行为一致
  const all = payload.data.items as EchoItem[];
  const start = (page - 1) * config.pageSize;
  const data = tagId
    ? { items: all.slice(start, start + config.pageSize), total: all.length }
    : { items: all, total: Number(payload.data.total) || 0 };
  try {
    localStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
  } catch {
    /* ignore */
  }
  return data;
};

/* ---------------- 页面初始化 ---------------- */

const initShuoshuo = async () => {
  const root = document.getElementById("shuoshuo") as HTMLElement | null;
  if (!root || root.dataset.ready === "true") return;
  root.dataset.ready = "true";

  const config = readConfig(root);
  const list = root.querySelector<HTMLElement>("#shuoshuo-list");
  const pagination = root.querySelector<HTMLElement>("#shuoshuo-pagination");
  const loading = root.querySelector<HTMLElement>("#shuoshuo-loading");
  if (!list || !config.api) return;

  let page = 1;
  let activeTag = "";
  let activeTagId = "";

  const setStatus = (message: string, state: string) => {
    if (!loading) return;
    loading.hidden = false;
    loading.className = `shuoshuo-loading is-${state}`;
    loading.innerHTML = message;
  };

  const tagBar = root.querySelector<HTMLElement>("#shuoshuo-tags");

  const loadTags = async () => {
    if (!tagBar || !config.tags) return;
    try {
      const response = await fetch(`${config.api}/api/tags`);
      if (!response.ok) return;
      const payload = await response.json();
      const tags = (payload?.data || []) as EchoTag[];
      if (!tags.length) return;
      const fragment = document.createDocumentFragment();
      tags.forEach((tag) => {
        if (!tag.name) return;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "shuoshuo-tag";
        chip.dataset.tag = tag.name;
        chip.dataset.tagId = tag.id || "";
        chip.textContent = `#${tag.name}`;
        chip.addEventListener("click", () => {
          const isActive = activeTag === tag.name;
          activeTag = isActive ? "" : tag.name || "";
          activeTagId = isActive ? "" : tag.id || "";
          page = 1;
          tagBar.querySelectorAll(".shuoshuo-tag").forEach((node) => node.classList.toggle("active", node === chip && !isActive));
          void render();
        });
        fragment.append(chip);
      });
      tagBar.replaceChildren(fragment);
      tagBar.hidden = false;
    } catch {
      /* 标签加载失败不影响主流程 */
    }
  };

  const bindActions = () => {
    list.querySelectorAll<HTMLElement>(".shuoshuo-tag").forEach((chip) => {
      if (chip.dataset.bound === "true") return;
      chip.dataset.bound = "true";
      chip.addEventListener("click", () => {
        if (activeTag === chip.dataset.tag) {
          activeTag = "";
          activeTagId = "";
        } else {
          activeTag = chip.dataset.tag || "";
          activeTagId = chip.dataset.tagId || "";
        }
        page = 1;
        void render();
      });
    });

    list.querySelectorAll<HTMLElement>(".shuoshuo-like").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", async () => {
        const id = button.dataset.echoId;
        if (!id || button.classList.contains("liked")) return;
        button.classList.add("liked");
        const counter = button.querySelector(".like-count");
        if (counter) counter.textContent = String((Number(counter.textContent) || 0) + 1);
        try {
          const response = await fetch(`${config.api}/api/echo/like/${encodeURIComponent(id)}`, { method: "PUT" });
          if (!response.ok) throw new Error(String(response.status));
          rememberLike(id);
        } catch {
          button.classList.remove("liked");
          if (counter) counter.textContent = String(Math.max(0, (Number(counter.textContent) || 1) - 1));
          Solitude.snackbarShow?.("点赞失败，请稍后再试", false, 2000);
        }
      });
    });
  };

  const applyGallery = () => {
    // 把正文内联图片包进 fancybox 链接，与画廊图统一灯箱体验
    list.querySelectorAll<HTMLImageElement>(".shuoshuo-card-body img:not(.no-lightbox)").forEach((img) => {
      if (img.closest("a")) return;
      const link = document.createElement("a");
      link.className = "shuoshuo-inline-image";
      link.href = img.currentSrc || img.src;
      link.setAttribute("data-fancybox", "shuoshuo-gallery");
      // 外链图床可能失效（实测 CDN 返回 404），失败时给个可读占位
      img.addEventListener("error", () => {
        link.classList.add("is-broken");
        img.replaceWith(Object.assign(document.createElement("span"), {
          className: "shuoshuo-image-broken",
          textContent: "图片已失效",
        }));
      }, { once: true });
      img.replaceWith(link);
      link.append(img);
    });
    list.querySelectorAll<HTMLElement>(".shuoshuo-gallery").forEach((gallery) => {
      Solitude.lightbox?.(gallery.querySelectorAll("img"));
    });
    const inline = list.querySelectorAll<HTMLElement>(".shuoshuo-inline-image");
    if (inline.length) Solitude.lightbox?.(inline);
  };

  const buildPagination = (total: number) => {
    if (!pagination) return;
    const totalPages = Math.max(1, Math.ceil(total / config.pageSize));
    if (totalPages <= 1) {
      pagination.hidden = true;
      pagination.replaceChildren();
      return;
    }
    pagination.hidden = false;
    const fragment = document.createDocumentFragment();
    for (let index = 1; index <= totalPages; index += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shuoshuo-page-btn";
      button.textContent = String(index);
      if (index === page) button.classList.add("active");
      button.addEventListener("click", () => {
        if (index === page) return;
        page = index;
        void render();
      });
      fragment.append(button);
    }
    pagination.replaceChildren(fragment);
  };

  const render = async () => {
    setStatus(`<i class="solitude fas fa-spinner fa-spin" aria-hidden="true"></i><span>加载中</span>`, "loading");
    try {
      const data = await fetchPage(config, page, activeTagId);
      if (!data.items.length) {
        setStatus('<span>还没有说说</span>', "empty");
        if (pagination) pagination.hidden = true;
        return;
      }
      if (loading) loading.hidden = true;
      const fragment = document.createDocumentFragment();
      for (const item of data.items) {
        fragment.append(await buildCard(config, item));
      }
      list.replaceChildren(fragment);
      bindActions();
      applyGallery();
      buildPagination(data.total);
      window.lazyLoadInstance?.update?.();
    } catch (error) {
      console.error("[shuoshuo]", error);
      setStatus('<span>说说加载失败，请稍后重试</span>', "error");
      if (pagination) pagination.hidden = true;
    }
  };

  void loadTags();
  void render();
};

document.addEventListener("solitude:ready", () => void initShuoshuo());
document.addEventListener("solitude:afterNavigate", () => void initShuoshuo());
if (document.readyState !== "loading") void initShuoshuo();

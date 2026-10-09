import { Solitude } from "./api";

/** 重跑 script[data-pjax]：切页后让以 data-pjax 标记的脚本重新执行（如 giscus 评论）。 */
const rerunPjaxScripts = () => {
  document.querySelectorAll<HTMLScriptElement>("script[data-pjax]").forEach((item) => {
    const replacement = document.createElement("script");
    Array.from(item.attributes).forEach((attribute) => replacement.setAttribute(attribute.name, attribute.value));
    replacement.textContent = item.textContent || "";
    item.replaceWith(replacement);
  });
};

/** 关闭持久化叠加层（菜单/目录/搜索/控制台等），在切页开始时复位 UI 状态。 */
const closePersistentOverlays = () => {
  document.body.style.overflow = "";
  document.documentElement.classList.remove("toc-open");
  document.getElementById("sidebar-menus")?.classList.remove("open");
  document.getElementById("nav-group-panel")?.classList.remove("open");
  document.getElementById("card-toc")?.classList.remove("open");
  document.getElementById("toggle-menu")?.setAttribute("aria-expanded", "false");
  document.getElementById("mobile-nav-group-toggle")?.setAttribute("aria-expanded", "false");
  document.getElementById("nav-toc a")?.setAttribute("aria-expanded", "false");
  const menuMask = document.getElementById("menu-mask");
  if (menuMask) menuMask.style.display = "none";
  const navGroupMask = document.getElementById("nav-group-mask");
  if (navGroupMask) navGroupMask.classList.remove("show");
  document.getElementById("console")?.classList.remove("show");
  const searchMask = document.getElementById("search-mask");
  const searchDialog = document.querySelector<HTMLElement>("#local-search .search-dialog, #algolia-search .search-dialog");
  if (searchMask) searchMask.style.display = "none";
  if (searchDialog) searchDialog.style.display = "none";
  document.documentElement.classList.remove("search-open");
};

/** 切页后新 header 落地时立即同步导航状态（nav-at-top/nav-fixed），
 * 避免移动端「回到顶部」按钮在 scrollFn 重新注册前的空窗期闪现占位。
 * 与 main.ts scrollFn 的 updateHeaderAndRightside 等价，此处只负责 class。 */
const syncNavHeaderState = () => {
  const $header = document.getElementById("page-header");
  if (!$header) return;
  const $rightside = document.getElementById("rightside");
  const currentTop = window.scrollY || document.documentElement.scrollTop;
  const isAtTop = currentTop <= 0;
  $header.classList.toggle("nav-at-top", isAtTop);
  if (isAtTop) {
    $header.classList.remove("nav-fixed", "nav-visible");
    if ($rightside) {
      $rightside.style.opacity = "";
      $rightside.style.transform = "";
    }
  } else {
    $header.classList.add("nav-fixed", "nav-visible");
    if ($rightside) {
      $rightside.style.opacity = "1";
      $rightside.style.transform = "translateX(-58px)";
    }
  }
};

const initSwup = () => {
  const SwupCtor = (window as any).Swup;
  if (!SwupCtor || Solitude.swup) return;
  const HeadPluginCtor = (window as any).SwupHeadPlugin;

  const swup = new SwupCtor({
    // 主内容容器：#body-wrap 包含 header/main/footer；sidebar/rightside/console 等持久组件在 body-wrap 外天然保留
    containers: ["#body-wrap"],
    // 兼容既有 data-no-pjax：外链中转页 / 灯箱包裹链接 / 隐私协议链接仍走整页跳转
    ignoreVisit: (_url: string, { el }: { el?: Element }) => !!el?.closest?.("[data-no-pjax]"),
    // 链接指向当前页时按普通访问处理（与旧 pjax 一致）
    linkToSelf: "navigate",
    // head-plugin：替换 title / og:* meta / description / #site-config / #config-diff（这几个 <template> 在 <head>，
    // swup 只替换 body 内元素，必须由 head-plugin 覆盖，否则 Solitude.page/config 不会更新）
    plugins: [
      ...(HeadPluginCtor ? [new HeadPluginCtor({ persistAssets: true })] : []),
    ],
  });

  // 桥接 Solitude.pjax：让 main/api/comments/algolia 等既有调用点零改动
  Solitude.pjax = {
    loadUrl: (url: string) => swup.navigate(url),
    refresh: (el?: HTMLElement) => {
      if (el) return; // algolia 局部刷新：站点未启用 algolia，no-op
      void Solitude.refresh?.(); // 无参全刷新（comments 用）：DOM 已在，仅重跑初始化逻辑
    },
  };
  Solitude.swup = swup;

  // 导航开始：清理旧页（对应旧 pjax:send）
  swup.hooks.on("visit:start", () => {
    closePersistentOverlays();
    document.dispatchEvent(new CustomEvent("solitude:beforeNavigate"));
    Solitude.disposePage?.();
    Object.values((window.globalFn as any)?.pjax || {}).forEach((dispose: any) => dispose?.());
    if (window.globalFn) (window.globalFn as any).pjax = {};
  });

  // 新内容 DOM 落地即同步导航态：header 刚被替换时 scrollFn 尚未重注册，
  // 若不在此处立即把 nav-at-top 加回，移动端「回到顶部」会闪现占位（issue 1）。
  swup.hooks.on("content:replace", () => {
    syncNavHeaderState();
  });

  // 内容已替换并可见：初始化新页（对应旧 pjax:complete）
  swup.hooks.on("page:view", async () => {
    try {
      await Solitude.refresh?.();
    } catch (error) {
      console.debug("Solitude page refresh kept the new page despite an optional module failure.", error);
    }
    syncNavHeaderState();
    rerunPjaxScripts();
    if (Solitude.config.lazyload.enable) window.lazyLoadInstance?.update?.();
    document.dispatchEvent(new Event("resize", { bubbles: true }));
    document.dispatchEvent(new Event("scroll", { bubbles: true }));
    document.dispatchEvent(new CustomEvent("solitude:afterNavigate", { detail: { page: Solitude.page } }));
  });

  // 404 兜底（对应旧 pjax:error）
  swup.hooks.on("fetch:error", (visit: any) => {
    if (visit?.to?.error?.status === 404) Solitude.navigate("/404.html");
  });

  rerunPjaxScripts();
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSwup, { once: true });
else initSwup();

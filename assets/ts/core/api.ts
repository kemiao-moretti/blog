import { getConfig, getPageConfig } from "./config";
import { lifecycle } from "./lifecycle";
import { loadScript, loadStyle } from "./resources";
import type { LoadElementOptions } from "./resources";
import { saveToLocal } from "./storage";

document.documentElement.dataset.solitudeRuntime = "booting";

interface SolitudeApiShape {
  saveToLocal: typeof saveToLocal;
  loadScript: typeof loadScript;
  loadStyle: typeof loadStyle;
  [key: string]: any;
}

const api = (window.Solitude || {}) as Record<string, any> & SolitudeApiShape;

Object.defineProperties(api, {
  config: { configurable: true, get: getConfig },
  page: { configurable: true, get: getPageConfig },
});

Object.assign(api, {
  saveToLocal,
  loadScript(url: string, options?: LoadElementOptions) {
    if (/barrage(?:\.min)?\.js(?:\?|$)/.test(url)) api.installLegacyAdapter?.();
    return loadScript(url, options);
  },
  loadStyle,
  on: lifecycle.on.bind(lifecycle),
  listen: lifecycle.listen.bind(lifecycle),
  onPageCleanup: lifecycle.add.bind(lifecycle),
  addGlobalFn(key: string, fn: (...args: any[]) => void, name: string | number | false = false, parent: Record<string, any> = window) {
    const globalFn: Record<string, any> = parent.globalFn || {};
    const keyObject: Record<string | number, any> = globalFn[key] || {};
    if (name && keyObject[name]) return;
    const id = name || Object.keys(keyObject).length;
    keyObject[id] = fn;
    globalFn[key] = keyObject;
    parent.globalFn = globalFn;
  },
  addEventListenerPjax(element: HTMLElement | null | undefined, event: string, handler: EventListener, options: AddEventListenerOptions | boolean = false) {
    if (!element?.addEventListener) return;
    element.addEventListener(event, handler, options);
    api.addGlobalFn("pjax", () => element.removeEventListener(event, handler, options));
  },
  diffDateFormat(elements?: NodeListOf<HTMLElement> | HTMLElement[] | null) {
    elements?.forEach((item) => {
      const date = new Date(item.getAttribute("datetime") || item.textContent || "");
      if (!Number.isNaN(date.valueOf())) item.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    });
  },
  installLegacyAdapter() {
    const aliases = { utils: api, sco: api, GLOBAL_CONFIG: api.config };
    Object.entries(aliases).forEach(([name, value]) => {
      if (!(name in window)) Object.defineProperty(window, name, { configurable: true, value });
    });
  },
  disposePage: lifecycle.disposePage.bind(lifecycle),
  navigate(url: string) {
    if (!url) return;
    const instance = api.pjax;
    if (instance?.loadUrl) instance.loadUrl(url);
    else window.location.assign(url);
  },
});

api.getCSS = (url: string, id: string | false = false) => api.loadStyle(url, id ? { id } : {});
api.getScript = (url: string, attributes: Record<string, string> = {}) => api.loadScript(url, { attributes });

window.Solitude = api;
document.documentElement.dataset.solitudeRuntime = "ready";

export { api as Solitude };

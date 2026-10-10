/**
 * Cookie 同意弹窗。
 *
 * 行为（对应站点隐私说明页的承诺）：
 *   - 未选择过 → 展示弹窗；选择结果写入 Cookie（契约见 core/consent.ts）。
 *   - 接受全部 → 当场复活被拦的非必要脚本（统计），并放行访客定位等 optional 功能。
 *   - 拒绝非必要 → 惰性脚本永远不会被创建、请求不会发出，并清掉统计/定位已经留下的残留。
 *   - 已选择过的访客不会看到弹窗，但可以点页面上的 [data-consent-reopen] 重开并改选。
 *
 * 事件一律挂在 document 上：弹窗在 #body-wrap 之外（swup 只替换 #body-wrap）因而常驻，
 * 但隐私页里的重开按钮会随切页重建，委托才能保证两处都生效。
 */

import {
  activateConsentScripts,
  purgeNonEssential,
  readConsent,
  writeConsent,
  type ConsentState,
} from "./core/consent";

const DIALOG_ID = "cookie-consent";
const ACCEPT_ID = "cookie-consent-accept";
const REJECT_ID = "cookie-consent-reject";
const REOPEN_SELECTOR = "[data-consent-reopen]";
const CURRENT_SELECTOR = "[data-consent-current]";
const STATE_SELECTOR = "[data-consent-state]";
const PANEL_SELECTOR = "[data-consent-panel]";
/** 与 components/cookie-consent.css 的过渡时长保持一致。 */
const TRANSITION_MS = 260;

const dialogElement = (): HTMLElement | null => {
  const dialog = document.getElementById(DIALOG_ID);
  return dialog instanceof HTMLElement ? dialog : null;
};

const labelFor = (holder: HTMLElement, state: ConsentState | null): string => {
  if (state === "accepted") return holder.dataset.labelAccepted || "";
  if (state === "rejected") return holder.dataset.labelRejected || "";
  return holder.dataset.labelNone || "";
};

/** 弹窗内回显当前选择，避免重开时看不出自己上次选了什么。 */
const syncDialogChoice = (dialog: HTMLElement): void => {
  const slot = dialog.querySelector<HTMLElement>(CURRENT_SELECTOR);
  if (!slot) return;
  const state = readConsent();
  const label = labelFor(dialog, state);
  slot.hidden = !state || !label;
  slot.textContent = state && label ? `${dialog.dataset.labelCurrent || ""}${label}` : "";
};

/** 隐私页的「Cookie 选择」面板同步当前状态。 */
const syncPanels = (): void => {
  const state = readConsent();
  document.querySelectorAll<HTMLElement>(PANEL_SELECTOR).forEach((panel) => {
    const slot = panel.querySelector<HTMLElement>(STATE_SELECTOR);
    if (slot) slot.textContent = labelFor(panel, state);
  });
};

const openDialog = (): void => {
  const dialog = dialogElement();
  if (!dialog) return;
  syncDialogChoice(dialog);
  dialog.hidden = false;
  requestAnimationFrame(() => dialog.classList.add("is-visible"));
};

const closeDialog = (): void => {
  const dialog = dialogElement();
  if (!dialog) return;
  dialog.classList.remove("is-visible");
  window.setTimeout(() => {
    dialog.hidden = true;
  }, TRANSITION_MS);
};

const choose = (state: ConsentState): void => {
  writeConsent(state);
  if (state === "rejected") purgeNonEssential();
  else activateConsentScripts();
  closeDialog();
  syncPanels();
};

const onClick = (event: MouseEvent): void => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest(REOPEN_SELECTOR)) {
    event.preventDefault();
    openDialog();
    return;
  }
  if (target.closest(`#${ACCEPT_ID}`)) {
    choose("accepted");
    return;
  }
  if (target.closest(`#${REJECT_ID}`)) choose("rejected");
};

const initCookieConsent = (): void => {
  const state = readConsent();
  /* 之前拒绝过的访客：即使这次不再打开弹窗，也不该留着统计/定位的旧残留。 */
  if (state === "rejected") purgeNonEssential();
  document.addEventListener("click", onClick);
  document.addEventListener("solitude:afterNavigate", syncPanels);
  syncPanels();
  if (!state) openDialog();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCookieConsent, { once: true });
} else {
  initCookieConsent();
}

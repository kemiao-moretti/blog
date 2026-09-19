/**
 * about 赞赏弹窗：充电按钮点击展示微信 / 支付宝收款码。
 * - 弹窗标记由 Hugo 模板渲染进 DOM，这里只做开关控制
 * - 关闭方式：关闭按钮、点击遮罩、Esc
 * - pjax 切换页面后需重新绑定，遵循主题 afterNavigate 约定
 */
const OVERLAY_SEL = ".reward-dialog-overlay";
const OPEN_SEL = "[data-reward-open]";
const CLOSE_SEL = "[data-reward-close]";
const LOCK_CLASS = "reward-dialog-lock";

function openDialog(overlay: HTMLElement): void {
  overlay.classList.add("is-open");
  document.body.classList.add(LOCK_CLASS);
}

function closeDialog(overlay: HTMLElement): void {
  overlay.classList.remove("is-open");
  document.body.classList.remove(LOCK_CLASS);
}

function bindRewardDialog(): void {
  const overlay = document.querySelector<HTMLElement>(OVERLAY_SEL);
  if (!overlay || overlay.dataset.rewardInit === "1") return;
  overlay.dataset.rewardInit = "1";

  document.querySelectorAll<HTMLElement>(OPEN_SEL).forEach((el) => {
    el.addEventListener("click", () => openDialog(overlay));
  });

  overlay.querySelectorAll<HTMLElement>(CLOSE_SEL).forEach((el) => {
    el.addEventListener("click", () => closeDialog(overlay));
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeDialog(overlay);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const overlay = document.querySelector<HTMLElement>(OVERLAY_SEL);
  if (overlay?.classList.contains("is-open")) closeDialog(overlay);
});

document.addEventListener("solitude:beforeNavigate", () => {
  document.body.classList.remove(LOCK_CLASS);
});

bindRewardDialog();
document.addEventListener("solitude:afterNavigate", () => void bindRewardDialog());
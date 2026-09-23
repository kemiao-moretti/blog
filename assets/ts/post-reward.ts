/**
 * 文末打赏弹层：桌面端悬停展开，触屏与键盘用点击/聚焦切换。
 * 事件挂在 document 上并做委托，pjax 换页后无需重新绑定。
 */
const ROOT_SEL = ".post-reward";
const TOGGLE_SEL = "[data-reward-toggle]";

function closeAll(except?: Element | null): void {
  document.querySelectorAll<HTMLElement>(`${ROOT_SEL}.is-open`).forEach((root) => {
    if (root === except) return;
    root.classList.remove("is-open");
    root.querySelector<HTMLElement>(TOGGLE_SEL)?.setAttribute("aria-expanded", "false");
  });
}

document.addEventListener("click", (e) => {
  const target = e.target as Element | null;
  const toggle = target?.closest?.(TOGGLE_SEL) as HTMLElement | null;
  if (toggle) {
    const root = toggle.closest<HTMLElement>(ROOT_SEL);
    if (root) {
      const open = !root.classList.contains("is-open");
      closeAll(root);
      root.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      e.preventDefault();
      return;
    }
  }
  if (!target?.closest?.(ROOT_SEL)) closeAll();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest?.(ROOT_SEL)) active.blur();
  closeAll();
});

document.addEventListener("solitude:beforeNavigate", () => closeAll());

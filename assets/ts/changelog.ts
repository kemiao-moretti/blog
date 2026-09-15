/**
 * changelog 更新日志页：搜索 + 类型筛选。
 * - 数据全部由 Hugo 模板渲染进 DOM，这里只做客户端过滤
 * - 最新一条默认展开由模板的 open 属性控制，折叠是原生 <details>
 * - pjax 切换页面后需重新绑定，遵循主题 afterNavigate 约定
 */
const ROOT_SEL = ".cl-timeline";
const INPUT_SEL = "[data-cl-search]";
const PILL_SEL = ".cl-pill";
const ENTRY_SEL = ".cl-entry";
const CARD_SEL = "details.cl-entry-card";
const EMPTY_SEL = ".cl-empty";

function initChangelog(): void {
  const root = document.querySelector<HTMLElement>(ROOT_SEL);
  if (!root || root.dataset.clInit === "1") return;
  root.dataset.clInit = "1";

  const input = document.querySelector<HTMLInputElement>(INPUT_SEL);
  const pills = Array.from(document.querySelectorAll<HTMLButtonElement>(PILL_SEL));
  const entries = Array.from(root.querySelectorAll<HTMLElement>(ENTRY_SEL));
  const empty = root.querySelector<HTMLElement>(EMPTY_SEL);

  const apply = () => {
    const q = (input?.value ?? "").trim().toLowerCase();
    const active =
      pills.find((p) => p.dataset.active !== undefined)?.dataset.filter ?? "all";
    let visible = 0;
    for (const el of entries) {
      const type = el.dataset.type ?? "";
      const typeOk = active === "all" || type === active;
      const textOk = !q || (el.textContent ?? "").toLowerCase().includes(q);
      const show = typeOk && textOk;
      el.hidden = !show;
      if (show) visible++;
      if (q && show) {
        const card = el.querySelector<HTMLDetailsElement>(CARD_SEL);
        if (card) card.open = true;
      }
    }
    if (empty) empty.hidden = visible !== 0;
  };

  input?.addEventListener("input", apply);
  for (const p of pills) {
    p.addEventListener("click", () => {
      pills.forEach((x) => x.removeAttribute("data-active"));
      p.setAttribute("data-active", "");
      apply();
    });
  }
}

initChangelog();
document.addEventListener("solitude:afterNavigate", () => void initChangelog());

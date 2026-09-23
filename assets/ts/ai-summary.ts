import { Solitude } from "./core/api";

const summarySelector = "[data-ai-summary]";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const typingTimers = new Set<number>();

const clearTypingTimers = () => {
  typingTimers.forEach((timer) => window.clearTimeout(timer));
  typingTimers.clear();
};

const typeSummary = (root: HTMLElement) => {
  const text = root.dataset.summary || "";
  const output = root.querySelector<HTMLElement>("[data-ai-summary-text]");
  if (!output || !text || output.dataset.typed === "true") return;

  output.dataset.typed = "true";
  if (reducedMotion()) return;

  output.textContent = "";
  output.classList.add("is-typing");
  let index = 0;
  const step = () => {
    if (!root.isConnected || !output.isConnected) return;
    output.textContent = text.slice(0, index);
    if (index >= text.length) {
      output.classList.remove("is-typing");
      return;
    }
    index += 1;
    const timer = window.setTimeout(() => {
      typingTimers.delete(timer);
      step();
    }, 18);
    typingTimers.add(timer);
  };
  step();
};

const initAiSummary = () => {
  clearTypingTimers();
  document.querySelectorAll<HTMLElement>(summarySelector).forEach(typeSummary);
};

initAiSummary();
Solitude.on("beforeNavigate", clearTypingTimers);
Solitude.on("afterNavigate", initAiSummary);

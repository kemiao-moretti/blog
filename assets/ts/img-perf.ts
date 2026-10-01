import { Solitude } from "./core/api";

/**
 * 正文图片运行时优化：给正文容器内未显式设置 decoding 的 <img> 补 decoding="async"，
 * 让图片解码不阻塞主线程（切页后新内容也补一遍）。
 */
const applyDecoding = () => {
  document.querySelectorAll<HTMLImageElement>(".article-container img").forEach((img) => {
    if (!img.hasAttribute("decoding")) img.decoding = "async";
  });
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyDecoding, { once: true });
else applyDecoding();

// 无刷新切页后，新内容里的图片也要补
document.addEventListener("swup:page:view", applyDecoding);

export {};

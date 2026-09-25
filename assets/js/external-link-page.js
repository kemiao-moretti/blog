/**
 * 外链中转页（layouts/go/）。
 *
 * - 目标地址由 interceptor（assets/ts/external_link.ts）写进查询参数，这里解码后回填
 * - 来源页同样由 interceptor 带过来（r=…）：外链多为 target="_blank"，中转页会在
 *   新标签里打开，那种情况下 history.length 只有 1，history.back() 无处可去，
 *   就得靠 r 把用户送回点链接时所在的那个页面，而不是首页
 * - 倒计时用 requestAnimationFrame 推进：标签页切到后台时 rAF 自动停摆，
 *   用户没看到提示就不会被偷偷送走，回到前台再从停下的位置继续
 * - 悬停或键盘聚焦即暂停，键盘用户不会被抢走焦点
 */
(() => {
  const root = document.getElementById("xlink");
  const configNode = document.getElementById("xlink-config");
  if (!root || !configNode) return;

  let config;
  try {
    config = JSON.parse(configNode.content?.textContent || configNode.textContent || "{}");
  } catch (error) {
    return;
  }

  const ticket = root.querySelector(".xlink-ticket");
  const lead = document.getElementById("xlink-lead");
  const host = document.getElementById("xlink-host");
  const url = document.getElementById("xlink-url");
  const copy = document.getElementById("xlink-copy");
  const copyStatus = document.getElementById("xlink-copy-status");
  const meter = document.getElementById("xlink-meter");
  const fill = document.getElementById("xlink-fill");
  const countdown = document.getElementById("xlink-countdown");
  const countdownBefore = document.getElementById("xlink-countdown-before");
  const countdownNumber = document.getElementById("xlink-countdown-number");
  const countdownAfter = document.getElementById("xlink-countdown-after");
  const status = document.getElementById("xlink-status");
  const cancel = document.getElementById("xlink-cancel");
  const go = document.getElementById("xlink-go");
  const home = document.getElementById("xlink-home");

  const decodeTarget = (raw) => {
    if (!raw) return null;
    if (config.encode !== "base64url") return raw;
    try {
      const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      const binary = atob(padded);
      return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    } catch (error) {
      return null;
    }
  };

  let finished = false;

  const raw = new URLSearchParams(location.search).get(config.param || "u");
  const target = decodeTarget(raw);

  // 来源页：只接受站内相对路径，避免被构造成开放重定向
  const returnTo = (() => {
    const value = decodeTarget(new URLSearchParams(location.search).get("r"));
    return value && /^\/(?!\/)/.test(value) ? value : null;
  })();

  const goBack = () => {
    finished = true;
    if (history.length > 1) history.back();
    else if (returnTo) location.assign(returnTo);
    else location.assign(config.home || "/");
  };

  if (!target || !/^https?:\/\//i.test(target)) {
    if (lead) lead.textContent = config.invalidText || "";
    if (status) status.textContent = config.invalidText || "";
    if (url) url.textContent = raw || "";
    if (copy) copy.hidden = true;
    if (meter) meter.hidden = true;
    if (countdown) countdown.hidden = true;
    if (go) go.hidden = true;
    if (cancel) cancel.hidden = true;
    if (home) home.hidden = false;
    return;
  }

  const parsed = new URL(target);
  const foreignReferrer = (() => {
    if (!config.guard) return false;
    try {
      return !document.referrer || new URL(document.referrer).origin !== location.origin;
    } catch (error) {
      return true;
    }
  })();

  if (host) host.textContent = parsed.hostname;
  if (url) url.textContent = target;
  if (go) go.href = target;
  if (cancel) cancel.hidden = false;

  const total = Number(config.countdown) || 0;
  const auto = total > 0 && !foreignReferrer;

  if (auto) {
    const parts = String(config.countdownText || "{seconds}").split("{seconds}");
    if (countdownBefore) countdownBefore.textContent = parts[0] || "";
    if (countdownAfter) countdownAfter.textContent = parts.length > 1 ? parts[1] : "";
  } else {
    if (lead) lead.textContent = foreignReferrer ? config.guardText || "" : lead.textContent;
    if (meter) meter.hidden = true;
    if (countdownNumber) countdownNumber.hidden = true;
    if (countdownBefore) countdownBefore.textContent = config.manualText || "";
    if (countdownAfter) countdownAfter.textContent = "";
  }

  const leave = () => {
    if (finished) return;
    finished = true;
    location.href = target;
  };

  if (auto) {
    let elapsed = 0;
    let paused = false;
    let last = 0;

    const setPaused = (next) => {
      if (finished || next === paused) return;
      paused = next;
      if (ticket) ticket.dataset.paused = next ? "1" : "0";
      if (status) status.textContent = next ? config.pauseText || "" : config.resumeText || "";
    };

    if (config.pauseOnHover !== false && ticket) {
      ticket.addEventListener("pointerenter", () => setPaused(true));
      ticket.addEventListener("pointerleave", () => setPaused(false));
      ticket.addEventListener("focusin", () => setPaused(true));
      ticket.addEventListener("focusout", (event) => {
        const next = event.relatedTarget;
        if (!next || !ticket.contains(next)) setPaused(false);
      });
    }

    const frame = (now) => {
      if (finished) return;
      if (!last) last = now;
      if (!paused) elapsed += now - last;
      last = now;
      const remaining = Math.max(0, total - elapsed / 1000);
      if (fill) fill.style.transform = `scaleX(${remaining / total})`;
      const seconds = String(Math.ceil(remaining));
      if (countdownNumber && countdownNumber.textContent !== seconds) countdownNumber.textContent = seconds;
      if (remaining <= 0) {
        leave();
        return;
      }
      requestAnimationFrame(frame);
    };

    if (countdownNumber) countdownNumber.textContent = String(Math.ceil(total));
    requestAnimationFrame(frame);
  }

  cancel?.addEventListener("click", goBack);

  copy?.addEventListener("click", () => {
    const done = () => {
      if (copyStatus) copyStatus.textContent = config.copiedText || "";
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(target).then(done).catch(() => {
        const node = document.createElement("textarea");
        node.value = target;
        node.setAttribute("readonly", "");
        node.style.position = "fixed";
        node.style.opacity = "0";
        document.body.appendChild(node);
        node.select();
        try {
          if (document.execCommand("copy")) done();
        } catch (error) {
          return;
        } finally {
          node.remove();
        }
      });
      return;
    }
    done();
  });
})();

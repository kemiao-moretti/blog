const COOKIE_NAME = "solitude_cookie_consent";
const COOKIE_VERSION = "v1";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type ConsentValue = "accepted" | "rejected";

const readConsent = (): ConsentValue | null => {
  const cookie = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${COOKIE_NAME}=`));
  if (!cookie) return null;

  const value = decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1));
  return value === `${COOKIE_VERSION}:accepted` || value === `${COOKIE_VERSION}:rejected`
    ? value.slice(`${COOKIE_VERSION}:`.length) as ConsentValue
    : null;
};

const writeConsent = (value: ConsentValue) => {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(`${COOKIE_VERSION}:${value}`)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
};

const initCookieConsent = () => {
  const dialog = document.getElementById("cookie-consent");
  const accept = document.getElementById("cookie-consent-accept");
  const reject = document.getElementById("cookie-consent-reject");
  if (!(dialog instanceof HTMLElement) || !(accept instanceof HTMLButtonElement) || !(reject instanceof HTMLButtonElement)) return;
  if (readConsent()) return;

  dialog.hidden = false;
  requestAnimationFrame(() => dialog.classList.add("is-visible"));

  const close = (value: ConsentValue) => {
    writeConsent(value);
    dialog.classList.remove("is-visible");
    window.setTimeout(() => {
      dialog.hidden = true;
    }, 260);
  };

  accept.addEventListener("click", () => close("accepted"), { once: true });
  reject.addEventListener("click", () => close("rejected"), { once: true });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCookieConsent, { once: true });
} else {
  initCookieConsent();
}

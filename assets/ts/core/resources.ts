type ElementCache = Map<string, Promise<HTMLElement>>;
export type LoadElementOptions = {
  async?: boolean;
  id?: string;
  attributes?: Record<string, string>;
};

const scriptRequests: ElementCache = new Map();
const styleRequests: ElementCache = new Map();

const loadElement = (
  cache: ElementCache,
  selector: string,
  create: (url: string) => HTMLElement,
  url: string
): Promise<HTMLElement> => {
  const absoluteUrl = new URL(url, document.baseURI).href;
  if (cache.has(absoluteUrl)) return cache.get(absoluteUrl)!;

  const existing = (
    [...document.querySelectorAll<HTMLElement>(selector)].find(
      (element) =>
        (element as HTMLLinkElement).href === absoluteUrl ||
        (element as HTMLScriptElement).src === absoluteUrl
    )
  );
  if (existing) {
    const resolved = Promise.resolve(existing);
    cache.set(absoluteUrl, resolved);
    return resolved;
  }

  const request = new Promise<HTMLElement>((resolve, reject) => {
    const element = existing || create(absoluteUrl);
    const complete = () => {
      element.dataset.loaded = "true";
      resolve(element);
    };
    const fail = () => {
      cache.delete(absoluteUrl);
      reject(new Error(`Unable to load ${absoluteUrl}`));
    };

    element.addEventListener("load", complete, { once: true });
    element.addEventListener("error", fail, { once: true });
    if (!existing) document.head.appendChild(element);
  });

  cache.set(absoluteUrl, request);
  return request;
};

export const loadScript = (url: string, options: LoadElementOptions = {}) =>
  loadElement(
    scriptRequests,
    "script",
    (src: string) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = options.async ?? true;
      Object.entries(options.attributes || {}).forEach(([key, value]) =>
        script.setAttribute(key, value)
      );
      return script;
    },
    url
  );

export const loadStyle = (url: string, options: LoadElementOptions = {}) =>
  loadElement(
    styleRequests,
    "link",
    (href: string) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      if (options.id) link.id = options.id;
      return link;
    },
    url
  );

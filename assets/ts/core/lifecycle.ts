const EVENT_PREFIX = "solitude:";

type Disposer = () => void;

class Lifecycle {
  #pageController = new AbortController();
  #disposers = new Set<Disposer>();

  get signal() {
    return this.#pageController.signal;
  }

  add(disposer: Disposer): Disposer {
    if (typeof disposer !== "function") return () => {};
    this.#disposers.add(disposer);
    return () => this.#disposers.delete(disposer);
  }

  listen(target: EventTarget, type: string, handler: EventListener, options: AddEventListenerOptions | boolean = {}): Disposer {
    if (!("addEventListener" in target)) return () => {};
    const normalized: AddEventListenerOptions & { signal?: AbortSignal } =
      typeof options === "boolean" ? { capture: options } : { ...options };
    normalized.signal ??= this.signal;
    target.addEventListener(type, handler, normalized);
    return () => target.removeEventListener(type, handler, normalized);
  }

  disposePage() {
    this.#pageController.abort();
    this.#disposers.forEach((dispose) => {
      try {
        dispose();
      } catch (error) {
        console.error("Failed to dispose a Solitude page resource:", error);
      }
    });
    this.#disposers.clear();
    this.#pageController = new AbortController();
  }

  emit(type: string, detail?: unknown) {
    document.dispatchEvent(
      new CustomEvent(`${EVENT_PREFIX}${type}`, { detail })
    );
  }

  on(type: string, handler: EventListener): Disposer {
    const eventName = `${EVENT_PREFIX}${type}`;
    document.addEventListener(eventName, handler);
    return () => document.removeEventListener(eventName, handler);
  }
}

export const lifecycle = new Lifecycle();

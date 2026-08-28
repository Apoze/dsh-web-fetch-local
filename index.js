import { SafeWebFetchProvider } from "dsh-safe-web-fetch";
import { WebError } from "@deepseek-ai/dsh-web";
import { escapeHtml, extractReadableHtml, sanitizeHtml, truncateHtml } from "./readability.js";

export const name = "web-fetch-local";
export const inject = ["web"];

const safeConfig = Object.freeze({
  maxUrlLength: 2_048,
  maxResponseBytes: 5_000_000,
  // Acquisition needs enough headroom to reach anchors in large documentation.
  maxBodyChars: 1_000_000,
  timeoutMs: 25_000,
  maxRedirects: 5,
  maxConcurrentRequests: 8,
  userAgent: "dsh-web-fetch-local/0.1",
  allowHosts: [],
  denyHosts: [],
});
const MAX_BODY_CHARS = 100_000;

export class LocalSafeReadabilityProvider {
  id = "local-safe-readability";

  constructor(safeProvider, maxConcurrentRequests) {
    if (safeProvider === undefined) {
      safeProvider = new SafeWebFetchProvider(safeConfig);
      maxConcurrentRequests = safeConfig.maxConcurrentRequests;
    } else if (maxConcurrentRequests === undefined) {
      throw new TypeError("maxConcurrentRequests is required when injecting safeProvider");
    }
    if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) {
      throw new RangeError("maxConcurrentRequests must be a positive integer");
    }
    this.safeProvider = safeProvider;
    this.maxConcurrentRequests = maxConcurrentRequests;
    this.activeRequests = 0;
    this.queue = [];
    this.idleWaiters = [];
    this.disposed = false;
    this.disposal = new AbortController();
  }

  available() {
    return this.safeProvider.available();
  }

  async fetch(request, signal) {
    await this.acquire(signal);
    let result;
    try {
      const activeSignal = signal
        ? AbortSignal.any([signal, this.disposal.signal])
        : this.disposal.signal;
      result = await this.safeProvider.fetch(request, activeSignal);
    } finally {
      this.release();
    }
    if (result.body.kind !== "html" || result.body.content.length === 0) return capResult(result);

    try {
      return capResult({
        ...result,
        body: {
          kind: "html",
          content: extractReadableHtml(result.body.content, result.url),
        },
      });
    } catch {
      return capResult({
        ...result,
        body: {
          kind: "html",
          content: safeFallback(result.body.content, result.url),
        },
      });
    }
  }

  acquire(signal) {
    if (signal?.aborted) throw webAbortError(signal.reason);
    if (this.disposed) throw this.disposal.signal.reason;
    if (this.activeRequests < this.maxConcurrentRequests) {
      this.activeRequests += 1;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: undefined };
      entry.onAbort = () => {
        const index = this.queue.indexOf(entry);
        this.queue.splice(index, 1);
        reject(webAbortError(signal.reason));
      };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      this.queue.push(entry);
    });
  }

  release() {
    this.activeRequests -= 1;
    while (!this.disposed && this.queue.length > 0) {
      const entry = this.queue.shift();
      entry.signal?.removeEventListener("abort", entry.onAbort);
      this.activeRequests += 1;
      entry.resolve();
      break;
    }
    if (this.activeRequests === 0) this.resolveIdle();
  }

  async dispose() {
    if (!this.disposed) {
      this.disposed = true;
      const reason = webAbortError(new DOMException("web fetch provider disposed", "AbortError"));
      this.disposal.abort(reason);
      for (const entry of this.queue.splice(0)) {
        entry.signal?.removeEventListener("abort", entry.onAbort);
        entry.reject(reason);
      }
    }
    if (this.activeRequests === 0) return;
    await new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  resolveIdle() {
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

function webAbortError(cause) {
  return new WebError("web fetch aborted", "WEB_ABORTED", { cause });
}

export function apply(ctx) {
  const provider = new LocalSafeReadabilityProvider();
  ctx.web.registerFetchProvider(provider);
  ctx.effect(() => () => provider.dispose());
}

function capResult(result) {
  if (result.body.content.length <= MAX_BODY_CHARS) return result;
  const content = result.body.kind === "html"
    ? truncateHtml(result.body.content, MAX_BODY_CHARS)
    : result.body.content.slice(0, MAX_BODY_CHARS);
  return {
    ...result,
    body: { ...result.body, content },
    truncated: true,
  };
}

function safeFallback(html, pageUrl) {
  try {
    return sanitizeHtml(html, pageUrl);
  } catch {
    return `<pre>${escapeHtml(html)}</pre>`;
  }
}

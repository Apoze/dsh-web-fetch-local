import { SafeWebFetchProvider } from "dsh-safe-web-fetch";
import { extractReadableHtml } from "./readability.js";

export const name = "web-fetch-local";
export const inject = ["web"];

const safeConfig = Object.freeze({
  maxUrlLength: 2_048,
  maxResponseBytes: 5_000_000,
  // Acquisition needs enough headroom for Readability before final capping.
  maxBodyChars: 250_000,
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

  constructor(safeProvider = new SafeWebFetchProvider(safeConfig)) {
    this.safeProvider = safeProvider;
  }

  available() {
    return this.safeProvider.available();
  }

  async fetch(request, signal) {
    const result = await this.safeProvider.fetch(request, signal);
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
      return capResult(result);
    }
  }
}

export function apply(ctx) {
  ctx.web.registerFetchProvider(new LocalSafeReadabilityProvider());
}

function capResult(result) {
  if (result.body.content.length <= MAX_BODY_CHARS) return result;
  return {
    ...result,
    body: { ...result.body, content: result.body.content.slice(0, MAX_BODY_CHARS) },
    truncated: true,
  };
}

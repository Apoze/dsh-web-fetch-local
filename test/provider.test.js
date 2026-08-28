import assert from "node:assert/strict";
import test from "node:test";
import { SafeWebFetchProvider } from "dsh-safe-web-fetch";
import { LocalSafeReadabilityProvider, apply } from "../index.js";
import { extractReadableHtml } from "../readability.js";

function fetchResult(url) {
  return { url, statusCode: 200, body: { kind: "text", content: url }, truncated: false };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(predicate(), true);
}

test("keeps a useful main while removing page chrome and unsafe markup", () => {
  const html = extractReadableHtml(`<!doctype html><title>Documentation</title>
    <header>Top navigation</header><nav>Menu</nav>
    <main><h1>API guide</h1><p onclick="steal()">Required documentation marker with enough useful text to select this main region.</p>
      <a href="/reference">Reference</a><img alt="inline" src="data:image/png;base64,AAAA">
      <table><tr><th>Name</th><th>Value</th></tr><tr><td>mode</td><td>safe</td></tr></table>
      <pre><code>fetch(url)</code></pre><script>steal()</script></main>
    <footer>Legal noise</footer>`, "https://example.com/docs/start");

  assert.match(html, /API guide/u);
  assert.match(html, /Required documentation marker/u);
  assert.match(html, /https:\/\/example\.com\/reference/u);
  assert.match(html, /fetch\(url\)/u);
  assert.doesNotMatch(html, /Top navigation|Menu|Legal noise|steal|data:image|onclick/u);
});

test("uses Readability without main and tolerates malformed HTML", () => {
  const html = extractReadableHtml(`<title>Article title</title><nav>Noise</nav><article>
    <h2>Article section</h2><p>This is the first substantial paragraph of the article with its required marker and useful content.</p>
    <p>This second paragraph gives Readability enough material to identify the article body.</p></article><div><b>broken`, "https://example.org/article");
  assert.match(html, /Article title|Article section/u);
  assert.match(html, /required marker/u);
  assert.doesNotMatch(html, /<nav|Noise/u);
});

test("uses Readability before a broad main container", () => {
  const html = extractReadableHtml(`<title>Repository</title><main>
    <div class="sidebar">Repository tabs, branches, releases, sponsors, and account controls.</div>
    <article><h1>Project README</h1>
      <p>${"Required project documentation marker with useful details. ".repeat(8)}</p>
      <pre><code>npm install project</code></pre>
    </article>
  </main>`, "https://github.example/project");

  assert.match(html, /Project README|Required project documentation marker|npm install project/u);
  assert.doesNotMatch(html, /Repository tabs|branches, releases|account controls/u);
});

test("preserves article metadata, warnings, footnotes, and safe code language", () => {
  const html = extractReadableHtml(`<title>Guide</title><main><article>
    <header><p>Written by Ada</p></header>
    <h1>Deployment guide</h1><p>${"Useful documentation. ".repeat(8)}</p>
    <aside><strong>Warning:</strong> keep a backup.</aside>
    <pre><code class="highlight language-typescript extra" onclick="bad()">const safe = true;</code></pre>
    <svg><text>unsafe vector noise</text></svg>
    <footer><ol><li id="note-1">Required footnote</li></ol></footer>
  </article></main>`, "https://example.com/guide");

  assert.match(html, /Written by Ada/u);
  assert.match(html, /Warning:.*keep a backup/su);
  assert.match(html, /Required footnote/u);
  assert.match(html, /class="language-typescript"/u);
  assert.doesNotMatch(html, /highlight|extra|onclick|bad\(\)|<svg|unsafe vector noise/u);
});

test("preserves useful semantic content inside a lone article", () => {
  const html = extractReadableHtml(`<nav>Site navigation</nav><article>
    <header><p>Written by Ada</p></header>
    <p>${"Useful article content. ".repeat(10)}</p>
    <aside>Compatibility warning</aside>
    <footer>License note</footer>
  </article>`, "https://example.com/article");

  assert.match(html, /Written by Ada/u);
  assert.match(html, /Compatibility warning/u);
  assert.match(html, /License note/u);
  assert.doesNotMatch(html, /Site navigation/u);
});

test("prioritizes a URL fragment section", () => {
  const html = extractReadableHtml(`<title>API</title><main>
    <h2 id="before">Before</h2><p>${"Irrelevant section. ".repeat(8)}</p>
    <h2 id="target">Target API</h2><p>Required target details.</p><pre><code>target()</code></pre>
    <h3>Target child</h3><p>Child details.</p>
    <h2 id="after">After</h2><p>Unwanted following section.</p>
  </main>`, "https://example.com/docs#target");

  assert.match(html, /Target API|Required target details|Child details|target\(\)/u);
  assert.doesNotMatch(html, /Irrelevant section|Unwanted following section/u);
});

test("preserves transport results and passes text through unchanged", async () => {
  const textResult = {
    url: "https://example.com/data.json",
    statusCode: 404,
    body: { kind: "text", content: "{\"error\":true}" },
    truncated: true,
  };
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: async () => textResult,
  }, 1);
  assert.equal(await provider.fetch({ url: textResult.url }), textResult);
});

test("caps final text after the larger extraction acquisition budget", async () => {
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: async () => ({
      url: "https://example.com/large.txt",
      statusCode: 200,
      body: { kind: "text", content: "x".repeat(100_001) },
      truncated: false,
    }),
  }, 1);
  const result = await provider.fetch({ url: "https://example.com/large.txt" });
  assert.equal(result.body.content.length, 100_000);
  assert.equal(result.truncated, true);
});

test("caps HTML without cutting its structure", async () => {
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: async () => ({
      url: "https://example.com/large.html",
      statusCode: 200,
      body: { kind: "html", content: `<main><h1>Large</h1><p>${"x".repeat(120_000)}</p><p>tail</p></main>` },
      truncated: false,
    }),
  }, 1);
  const result = await provider.fetch({ url: "https://example.com/large.html" });
  assert.ok(result.body.content.length <= 100_000);
  assert.match(result.body.content, /<h[12]>Large<\/h[12]>.*<p>x+/su);
  assert.match(result.body.content, /<\/p>(?:<\/div>)*$/u);
  assert.equal(result.truncated, true);
});

test("preserves status, final URL, truncation and safely falls back on extraction failure", async () => {
  const htmlResult = {
    url: "not a valid final URL",
    statusCode: 203,
    body: { kind: "html", content: "<script>bad()</script><p>original</p>" },
    truncated: true,
  };
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: async () => htmlResult,
  }, 1);
  const result = await provider.fetch({ url: "https://example.com" });
  assert.equal(result.url, htmlResult.url);
  assert.equal(result.statusCode, htmlResult.statusCode);
  assert.equal(result.truncated, true);
  assert.match(result.body.content, /original/u);
  assert.doesNotMatch(result.body.content, /<script>|<p>original<\/p>/u);
});

test("preserves transport failures and blocks private destinations", async () => {
  const failure = new Error("transport failure");
  const failing = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: async () => { throw failure; },
  }, 1);
  await assert.rejects(failing.fetch({ url: "https://example.com" }), (error) => error === failure);

  const provider = new LocalSafeReadabilityProvider();
  for (const url of [
    "http://127.0.0.1:8080/",
    "http://[::1]/",
    "http://192.168.1.10/",
    "http://169.254.169.254/",
  ]) {
    await assert.rejects(provider.fetch({ url }), (error) => error.code === "WEB_PRIVATE_ADDRESS_BLOCKED");
  }
});

test("admits fetches in FIFO order at capacity one", async () => {
  const started = [];
  const pending = new Map();
  let active = 0;
  let peak = 0;
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: (request) => {
      started.push(request.url);
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve) => pending.set(request.url, () => {
        active -= 1;
        resolve(fetchResult(request.url));
      }));
    },
  }, 1);

  const queuedSignal = new AbortController().signal;
  const requests = [
    provider.fetch({ url: "a" }),
    provider.fetch({ url: "b" }, queuedSignal),
    provider.fetch({ url: "c" }),
  ];
  await waitFor(() => started.length === 1);
  assert.deepEqual(started, ["a"]);
  pending.get("a")();
  await waitFor(() => started.length === 2);
  pending.get("b")();
  await waitFor(() => started.length === 3);
  pending.get("c")();

  assert.deepEqual((await Promise.all(requests)).map((result) => result.url), ["a", "b", "c"]);
  assert.equal(peak, 1);
});

test("uses the configured capacity and keeps provider instances independent", async () => {
  let active = 0;
  let peak = 0;
  const makeProvider = (capacity) => new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return fetchResult(request.url);
    },
  }, capacity);
  const first = makeProvider(2);
  const second = makeProvider(1);

  await Promise.all([
    first.fetch({ url: "a" }),
    first.fetch({ url: "b" }),
    first.fetch({ url: "c" }),
    second.fetch({ url: "d" }),
  ]);
  assert.equal(peak, 3);
});

test("removes an aborted queued fetch without consuming a slot", async () => {
  let releaseActive;
  const started = [];
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: (request) => {
      started.push(request.url);
      return new Promise((resolve) => { releaseActive = () => resolve(fetchResult(request.url)); });
    },
  }, 1);
  const active = provider.fetch({ url: "active" });
  await waitFor(() => started.length === 1);
  const controller = new AbortController();
  const queued = provider.fetch({ url: "queued" }, controller.signal);
  const reason = new DOMException("cancelled", "AbortError");
  controller.abort(reason);

  await assert.rejects(queued, (error) => error.code === "WEB_ABORTED" && error.cause === reason);
  releaseActive();
  await active;
  assert.deepEqual(started, ["active"]);
});

test("forwards active cancellation and releases the slot after failures", async () => {
  const controller = new AbortController();
  let calls = 0;
  let activeSignal;
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: (request, signal) => {
      calls += 1;
      if (request.url === "active") {
        activeSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      if (request.url === "sync-error") throw new Error("sync failure");
      if (request.url === "async-error") return Promise.reject(new Error("async failure"));
      return Promise.resolve(fetchResult(request.url));
    },
  }, 1);

  const active = provider.fetch({ url: "active" }, controller.signal);
  await waitFor(() => activeSignal !== undefined);
  const reason = new DOMException("cancelled", "AbortError");
  controller.abort(reason);
  await assert.rejects(active, (error) => error === reason);
  await assert.rejects(provider.fetch({ url: "sync-error" }), /sync failure/u);
  await assert.rejects(provider.fetch({ url: "async-error" }), /async failure/u);
  assert.equal((await provider.fetch({ url: "success" })).url, "success");
  assert.equal(calls, 4);
});

test("dispose aborts active work, rejects the queue, and waits for quiescence", async () => {
  let activeSignal;
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: (request, signal) => {
      activeSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  }, 1);
  const active = provider.fetch({ url: "active" });
  await waitFor(() => activeSignal !== undefined);
  const queued = provider.fetch({ url: "queued" }, new AbortController().signal);
  const disposal = provider.dispose();

  await assert.rejects(active, (error) => error.code === "WEB_ABORTED");
  await assert.rejects(queued, (error) => error.code === "WEB_ABORTED");
  await disposal;
  await provider.dispose();
  await assert.rejects(provider.fetch({ url: "late" }), (error) => error.code === "WEB_ABORTED");
});

test("validates admission capacity", async () => {
  const safeProvider = { available: () => true, fetch: async (request) => fetchResult(request.url) };
  const provider = new LocalSafeReadabilityProvider(safeProvider, 1);
  assert.equal(provider.available(), true);
  assert.throws(() => new LocalSafeReadabilityProvider(safeProvider, 0), /positive integer/u);
  assert.throws(() => new LocalSafeReadabilityProvider(safeProvider, 1.5), /positive integer/u);
  assert.throws(() => new LocalSafeReadabilityProvider(safeProvider), /required when injecting/u);

  const controller = new AbortController();
  const reason = new DOMException("cancelled", "AbortError");
  controller.abort(reason);
  await assert.rejects(provider.fetch({ url: "cancelled" }, controller.signal), (error) => (
    error.code === "WEB_ABORTED" && error.cause === reason
  ));
});

test("registers the provider and disposes it with the plugin fiber", async () => {
  let registered;
  let dispose;
  apply({
    web: { registerFetchProvider: (provider) => { registered = provider; } },
    effect: (setup) => { dispose = setup(); },
  });
  assert.equal(registered.id, "local-safe-readability");
  await dispose();
});

test("queues before the real safe provider's fail-fast boundary", async () => {
  const pending = [];
  const safeProvider = new SafeWebFetchProvider({
    maxUrlLength: 2_048,
    maxResponseBytes: 1_000,
    maxBodyChars: 1_000,
    timeoutMs: 1_000,
    maxRedirects: 0,
    maxConcurrentRequests: 1,
    userAgent: "test",
    allowHosts: [],
    denyHosts: [],
  }, {
    resolver: async () => [{ address: "93.184.216.34", family: 4 }],
    transportFactory: () => ({
      request: async () => new Promise((resolve) => pending.push(resolve)),
      close: async () => {},
    }),
  });
  const provider = new LocalSafeReadabilityProvider(safeProvider, 1);
  const first = provider.fetch({ url: "https://example.com/first" });
  const second = provider.fetch({ url: "https://example.com/second" });
  await waitFor(() => pending.length === 1);
  pending.shift()(new Response("first", { headers: { "content-type": "text/plain" } }));
  await waitFor(() => pending.length === 1);
  pending.shift()(new Response("second", { headers: { "content-type": "text/plain" } }));

  assert.deepEqual((await Promise.all([first, second])).map((result) => result.body.content), ["first", "second"]);
});

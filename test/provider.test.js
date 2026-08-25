import assert from "node:assert/strict";
import test from "node:test";
import { LocalSafeReadabilityProvider } from "../index.js";
import { extractReadableHtml } from "../readability.js";

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
  });
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
  });
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
  });
  const result = await provider.fetch({ url: "https://example.com/large.html" });
  assert.ok(result.body.content.length <= 100_000);
  assert.match(result.body.content, /^<h1>Large<\/h1><p>x+/u);
  assert.match(result.body.content, /<\/p>$/u);
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
  });
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
  });
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

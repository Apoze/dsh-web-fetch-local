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

test("preserves status, final URL, truncation and falls back on extraction failure", async () => {
  const htmlResult = {
    url: "not a valid final URL",
    statusCode: 203,
    body: { kind: "html", content: "<p>original</p>" },
    truncated: true,
  };
  const provider = new LocalSafeReadabilityProvider({
    available: () => true,
    fetch: async () => htmlResult,
  });
  assert.deepEqual(await provider.fetch({ url: "https://example.com" }), htmlResult);
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

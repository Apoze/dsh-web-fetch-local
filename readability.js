import { Readability } from "@mozilla/readability";
import createDOMPurify from "dompurify";
import { JSDOM, VirtualConsole } from "jsdom";

const MIN_MAIN_TEXT = 100;
const MAX_READABILITY_ELEMENTS = 20_000;
const FORBID_TAGS = [
  "nav", "aside", "header", "footer", "form", "svg", "iframe", "noscript",
  "button", "select", "option", "input", "textarea", "dialog", "canvas",
  "video", "audio", "template", "script", "style",
];
const FORBID_ATTR = ["style", "class", "id", "hidden", "aria-hidden", "role"];

export function extractReadableHtml(html, pageUrl) {
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole: new VirtualConsole() });
  try {
    const { document } = dom.window;
    normalizeReferences(document, pageUrl);

    const mains = Array.from(document.querySelectorAll("main"))
      .filter((main) => textLength(main) >= MIN_MAIN_TEXT);

    let source;
    let title = document.title.trim();
    if (mains.length === 1) {
      source = mains[0].innerHTML;
    } else {
      try {
        const article = new Readability(document.cloneNode(true), {
          maxElemsToParse: MAX_READABILITY_ELEMENTS,
        }).parse();
        if (article?.content?.trim()) {
          source = article.content;
          title = article.title?.trim() || title;
        }
      } catch {
        // The sanitized document fallback below is the reliable path.
      }
    }

    source ??= document.body?.innerHTML ?? "";
    const purify = createDOMPurify(dom.window);
    const clean = String(purify.sanitize(source, {
      FORBID_TAGS,
      FORBID_ATTR,
      KEEP_CONTENT: false,
    })).trim();
    if (!clean) throw new Error("readable HTML is empty");

    const container = document.createElement("div");
    container.innerHTML = clean;
    if (title && container.querySelector("h1") === null) {
      const heading = document.createElement("h1");
      heading.textContent = title;
      container.prepend(heading);
    }
    return container.innerHTML;
  } finally {
    dom.window.close();
  }
}

function normalizeReferences(document, pageUrl) {
  for (const element of document.querySelectorAll("a[href], img[src]")) {
    const attribute = element.localName === "a" ? "href" : "src";
    const value = element.getAttribute(attribute);
    if (!value) continue;
    try {
      const url = new URL(value, pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        element.setAttribute(attribute, url.toString());
      } else {
        element.removeAttribute(attribute);
      }
    } catch {
      element.removeAttribute(attribute);
    }
  }
  for (const image of document.querySelectorAll("img")) image.removeAttribute("srcset");
}

function textLength(element) {
  return element.textContent?.replace(/\s+/gu, " ").trim().length ?? 0;
}

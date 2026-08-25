import { Readability } from "@mozilla/readability";
import createDOMPurify from "dompurify";
import { JSDOM, VirtualConsole } from "jsdom";

const MIN_MAIN_TEXT = 100;
const MAX_READABILITY_ELEMENTS = 20_000;
const FORBID_TAGS = [
  "form", "svg", "iframe", "object", "embed", "noscript", "button", "select",
  "option", "input", "textarea", "dialog", "canvas", "video", "audio",
  "template", "script", "style",
];
const FORBID_ATTR = ["style", "hidden", "aria-hidden", "role", "contenteditable", "tabindex"];
const LANGUAGE_CLASS = /^language-[a-z0-9_+.-]+$/iu;
const BLOCKS = "p,li,tr,pre,blockquote,h1,h2,h3,h4,h5,h6,section,article,aside,header,footer,div";

export function extractReadableHtml(html, pageUrl) {
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole: new VirtualConsole() });
  try {
    const { document } = dom.window;
    normalizeReferences(document, pageUrl);
    removePageChrome(document);

    let source;
    let title = document.title.trim();
    const targeted = fragmentContent(document, pageUrl);
    const mains = Array.from(document.querySelectorAll("main"))
      .filter((main) => textLength(main) >= MIN_MAIN_TEXT);
    const articles = mains.length === 0
      ? Array.from(document.querySelectorAll("article"))
        .filter((article) => textLength(article) >= MIN_MAIN_TEXT)
      : [];

    if (targeted) {
      source = targeted;
    } else if (mains.length === 1) {
      source = mains[0].innerHTML;
    } else if (articles.length === 1) {
      source = articles[0].innerHTML;
    } else {
      try {
        const article = new Readability(document.cloneNode(true), {
          maxElemsToParse: MAX_READABILITY_ELEMENTS,
        }).parse();
        if (article?.content?.trim()) {
          source = article.content;
          title = article.title?.trim() || title;
          if (article.byline?.trim()) source = `<p>${escapeHtml(article.byline.trim())}</p>${source}`;
        }
      } catch {
        // The sanitized document fallback below is the reliable path.
      }
    }

    source ??= document.body?.innerHTML ?? "";
    const clean = sanitizeSource(dom, source);
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

export function sanitizeHtml(html, pageUrl) {
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole: new VirtualConsole() });
  try {
    const { document } = dom.window;
    normalizeReferences(document, pageUrl);
    removePageChrome(document);
    return sanitizeSource(dom, document.body?.innerHTML ?? "");
  } finally {
    dom.window.close();
  }
}

export function truncateHtml(html, maxChars) {
  if (html.length <= maxChars) return html;
  const dom = new JSDOM("<!doctype html><body><div id=content></div>");
  try {
    const container = dom.window.document.getElementById("content");
    container.innerHTML = html;
    let serialized = container.innerHTML;
    while (serialized.length > maxChars && container.hasChildNodes()) {
      const excess = serialized.length - maxChars;
      const text = lastTextNode(container);
      if (text && text.data.length > excess) {
        text.data = text.data.slice(0, text.data.length - excess);
      } else {
        const blocks = container.querySelectorAll(BLOCKS);
        const removable = blocks.item(blocks.length - 1) ?? container.lastChild;
        removable?.remove();
      }
      serialized = container.innerHTML;
    }
    return serialized;
  } finally {
    dom.window.close();
  }
}

function sanitizeSource(dom, source) {
  const { document } = dom.window;
  const container = document.createElement("div");
  container.innerHTML = source;
  keepOnlyCodeLanguages(container);
  const purify = createDOMPurify(dom.window);
  return String(purify.sanitize(container.innerHTML, {
    FORBID_TAGS,
    FORBID_ATTR,
    KEEP_CONTENT: false,
  })).trim();
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

function removePageChrome(document) {
  for (const element of document.querySelectorAll("[hidden], [aria-hidden='true']")) element.remove();
  for (const element of document.querySelectorAll("nav, header, aside, footer")) {
    if (!element.closest("main, article")) element.remove();
  }
}

function fragmentContent(document, pageUrl) {
  let hash;
  try {
    hash = new URL(pageUrl).hash.slice(1);
    if (!hash) return undefined;
    hash = decodeURIComponent(hash);
  } catch {
    return undefined;
  }

  const target = document.getElementById(hash)
    ?? Array.from(document.querySelectorAll("a[name]"), (anchor) => anchor)
      .find((anchor) => anchor.getAttribute("name") === hash);
  if (!target) return undefined;

  const heading = target.closest("h1, h2, h3, h4, h5, h6");
  if (!heading) return (target.closest("section, article, main") ?? target).outerHTML;

  const level = Number(heading.localName.slice(1));
  const wrapper = document.createElement("section");
  for (let node = heading; node; node = node.nextElementSibling) {
    const nextLevel = /^h[1-6]$/u.test(node.localName) ? Number(node.localName.slice(1)) : undefined;
    if (node !== heading && nextLevel !== undefined && nextLevel <= level) break;
    wrapper.append(node.cloneNode(true));
  }
  return wrapper.innerHTML;
}

function keepOnlyCodeLanguages(container) {
  for (const element of container.querySelectorAll("[class]")) {
    const language = element.localName === "code"
      ? Array.from(element.classList).find((name) => LANGUAGE_CLASS.test(name))
      : undefined;
    if (language) element.setAttribute("class", language);
    else element.removeAttribute("class");
  }
}

function lastTextNode(container) {
  const walker = container.ownerDocument.createTreeWalker(container, 4);
  let last;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
  return last;
}

export function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function textLength(element) {
  return element.textContent?.replace(/\s+/gu, " ").trim().length ?? 0;
}

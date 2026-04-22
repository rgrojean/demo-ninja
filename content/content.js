// Content script — runs in the context of the web page

let activeReplacements = [];
let replacementMap = new Map(); // find.trim() → replace (O(1) lookup on hot path)
let observer = null;
let applying = false; // guard to prevent observer re-triggering during our own writes
// Map of text node → original content, so we can restore on clear/toggle
const originalTexts = new WeakMap();

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'meta', 'link', 'svg', 'iframe']);

// Extract cleaned HTML from the visible page content
function extractPageHTML() {
  // Clone the body so we can strip non-visible stuff without affecting the page
  const clone = document.body.cloneNode(true);

  // Remove invisible and non-content elements
  clone.querySelectorAll('script, style, noscript, meta, link, svg, iframe, [aria-hidden="true"]').forEach(el => el.remove());

  // Get the main content area if identifiable, otherwise use full body
  const main = clone.querySelector('main, [role="main"], #root, #app, .app-content') || clone;

  // Clean up the HTML: remove data attributes, event handlers, and excessive whitespace
  function cleanNode(el) {
    if (el.nodeType !== Node.ELEMENT_NODE) return;

    // Remove clutter attributes but keep structural ones
    const keepAttrs = new Set(['class', 'id', 'role', 'aria-label', 'title', 'href', 'alt']);
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (!keepAttrs.has(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }

    for (const child of el.children) {
      cleanNode(child);
    }
  }

  cleanNode(main);
  let html = main.innerHTML;

  // Collapse whitespace runs
  html = html.replace(/\s{2,}/g, ' ').replace(/>\s+</g, '>\n<');

  // Truncate if too large (Claude has limits, and we're also sending a screenshot)
  const MAX_HTML_LENGTH = 60000;
  if (html.length > MAX_HTML_LENGTH) {
    html = html.substring(0, MAX_HTML_LENGTH) + '\n<!-- truncated -->';
  }

  return html;
}

// Also extract flat text list for the replacement engine to validate against
function extractVisibleTexts() {
  const texts = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
      const text = node.textContent.trim();
      if (text.length < 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while (walker.nextNode()) {
    texts.add(walker.currentNode.textContent.trim());
  }
  return Array.from(texts);
}

function buildPageSummary() {
  const html = extractPageHTML();
  const visibleTexts = extractVisibleTexts();
  return { html, visibleTexts };
}

// Restore all text nodes to their original content
function restoreOriginals() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const orig = originalTexts.get(walker.currentNode);
    if (orig !== undefined) {
      walker.currentNode.textContent = orig;
    }
  }
}

// Apply replacements to text nodes
function applyReplacements(replacements) {
  applying = true;
  try {
    // First restore everything to original state, then re-apply with new set
    restoreOriginals();

    activeReplacements = replacements;
    replacementMap = new Map();
    for (const { find, replace } of replacements) {
      if (typeof find === 'string' && find.trim()) {
        replacementMap.set(find.trim(), replace);
      }
    }

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );

    while (walker.nextNode()) {
      replaceTextNode(walker.currentNode);
    }
  } finally {
    applying = false;
  }

  // Watch for dynamic content changes
  startObserver();
}

function replaceTextNode(textNode) {
  if (!replacementMap.size) return;

  const parent = textNode.parentElement;
  if (!parent) return;

  const tag = parent.tagName?.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;

  // Use the original text for matching (not the currently displayed text)
  const orig = originalTexts.has(textNode) ? originalTexts.get(textNode) : textNode.textContent;
  const trimmed = orig.trim();
  const replace = replacementMap.get(trimmed);
  if (replace === undefined) return;

  const leading = orig.match(/^\s*/)[0];
  const trailing = orig.match(/\s*$/)[0];
  const next = leading + replace + trailing;

  // No-op guard: if the node is already showing the desired value, don't write.
  // Writing fires a characterData mutation that re-enters the observer, which
  // would read `orig` from the WeakMap, match `find` again, and write again —
  // a tight feedback loop that jams the main thread and causes
  // "page unresponsive" dialogs on long-running tabs.
  if (textNode.textContent === next) return;

  // Save original before first modification
  if (!originalTexts.has(textNode)) {
    originalTexts.set(textNode, orig);
  }
  textNode.textContent = next;
}

function startObserver() {
  if (observer) observer.disconnect();

  observer = new MutationObserver((mutations) => {
    if (applying) return;
    applying = true;
    try {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              replaceTextNode(node);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
              while (walker.nextNode()) {
                replaceTextNode(walker.currentNode);
              }
            }
          }
        } else if (mutation.type === 'characterData') {
          replaceTextNode(mutation.target);
        }
      }
    } finally {
      // Drain any mutation records our own writes just queued so they don't
      // fire the observer again on the next microtask. Combined with the
      // no-op guard in replaceTextNode, this fully prevents re-entry loops.
      if (observer) observer.takeRecords();
      applying = false;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function clearReplacements() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  restoreOriginals();
  activeReplacements = [];
  replacementMap = new Map();
}

// Listen for messages from the background/side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_TEXT') {
    const { html, visibleTexts } = buildPageSummary();
    sendResponse({ html, visibleTexts });
    return;
  }

  if (message.type === 'APPLY_REPLACEMENTS') {
    applyReplacements(message.replacements);
    sendResponse({ success: true, count: message.replacements.length });
    return;
  }

  if (message.type === 'CLEAR_REPLACEMENTS') {
    clearReplacements();
    sendResponse({ success: true });
    return;
  }
});

// Announce to the side panel that this tab is ready for replacements
chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY', url: window.location.href }).catch(() => {});

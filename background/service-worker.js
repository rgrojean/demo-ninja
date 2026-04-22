// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// When the user navigates to a new URL, notify the side panel to re-apply URL-scoped replacements
// Only fire on actual URL changes, not on every tab update
let lastNotifiedUrl = {};
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url !== lastNotifiedUrl[tabId]) {
    lastNotifiedUrl[tabId] = changeInfo.url;
    chrome.runtime.sendMessage({ type: 'TAB_URL_CHANGED', url: changeInfo.url, tabId }).catch(() => {});
  }
});

// Handle messages between side panel and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // Keep message channel open for async response
});

async function handleMessage(message) {
  console.log('[SW] Received message:', message.type);

  if (message.type === 'CAPTURE_PAGE') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    console.log('[SW] Active tab:', tab?.id, tab?.url);
    if (!tab) throw new Error('No active tab');

    // Capture screenshot
    console.log('[SW] Capturing screenshot...');
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 80
    });
    console.log('[SW] Screenshot captured, length:', screenshotDataUrl.length);

    // Extract text from the page via content script
    console.log('[SW] Sending EXTRACT_TEXT to tab', tab.id);
    let textResults;
    try {
      textResults = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_TEXT'
      });
    } catch (err) {
      // Content script not injected yet — inject it and retry
      console.log('[SW] Content script not found, injecting...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });
      textResults = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXTRACT_TEXT'
      });
    }
    console.log('[SW] Text extracted, html length:', textResults?.html?.length, 'visible texts:', textResults?.visibleTexts?.length);

    return {
      screenshot: screenshotDataUrl,
      pageHTML: textResults.html,
      visibleTexts: textResults.visibleTexts,
      pageUrl: tab.url,
      pageTitle: tab.title
    };
  }

  if (message.type === 'APPLY_REPLACEMENTS') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) throw new Error('No active tab');

    return await chrome.tabs.sendMessage(tab.id, {
      type: 'APPLY_REPLACEMENTS',
      replacements: message.replacements
    });
  }

  if (message.type === 'CLEAR_REPLACEMENTS') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) throw new Error('No active tab');

    return await chrome.tabs.sendMessage(tab.id, {
      type: 'CLEAR_REPLACEMENTS'
    });
  }

  throw new Error(`Unknown message type: ${message.type}`);
}

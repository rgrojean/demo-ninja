// ============================================================
// Demo Ninja — Side Panel Controller
// ============================================================

// --- State ---
// projects = { "project-id": { name: "Acme Corp", files: { "page.json": { replacements: [...], pathname: "/page" } }, fileEnabled: { "page.json": true } } }
let projects = {};
let activeProjectId = null;
let projectEnabled = true;
let editingFileName = null;  // which file is loaded in the editor
let capturedData = null;
let replacements = [];       // current editor state
let apiKey = '';
let provider = 'anthropic';
let modelOverride = '';

// --- DOM refs ---
const $ = (sel) => document.querySelector(sel);
const providerSelect = $('#provider-select');
const modelInput = $('#model-input');
const apiKeyInput = $('#api-key-input');
const toggleKeyVis = $('#toggle-key-vis');
const saveSettingsBtn = $('#save-settings-btn');
const settingsStatus = $('#settings-status');
const modelHint = $('#model-hint');
const captureBtn = $('#capture-btn');
const capturePreview = $('#capture-preview');
const screenshotPreview = $('#screenshot-preview');
const captureInfo = $('#capture-info');
const customizeSection = $('#customize-section');
const companyInput = $('#company-input');
const instructionsInput = $('#instructions-input');
const generateBtn = $('#generate-btn');
const generateStatus = $('#generate-status');
const reviewSection = $('#review-section');
const replacementsEditor = $('#replacements-editor');
const editingFileNameEl = $('#editing-file-name');
const addRowBtn = $('#add-row-btn');
const saveFileBtn = $('#save-file-btn');
const statusBadge = $('#status-badge');
const projectSelect = $('#project-select');
const addProjectBtn = $('#add-project-btn');
const deleteProjectBtn = $('#delete-project-btn');
const projectToggle = $('#project-toggle');
const fileList = $('#file-list');
const exportBtn = $('#export-btn');
const importBtn = $('#import-btn');
const importFile = $('#import-file');

// --- Helpers ---
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getActiveProject() {
  return activeProjectId ? projects[activeProjectId] : null;
}

function sendMessage(message) {
  console.log('[Panel] Sending message:', message.type);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Panel] Message error:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log('[Panel] Got response:', response);
        resolve(response);
      }
    });
  });
}

function showStatus(el, html, type) {
  el.innerHTML = html;
  el.className = `status ${type}`;
  el.classList.remove('hidden');
  if (type === 'success') {
    setTimeout(() => el.classList.add('hidden'), 3000);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function saveState() {
  chrome.storage.local.set({ projects, activeProjectId, projectEnabled });
}

// --- Default models per provider ---
const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.5-flash'
};

const MODEL_HINTS = {
  anthropic: 'Default: claude-sonnet-4-20250514',
  openai: 'Default: gpt-4o',
  gemini: 'Default: gemini-2.5-flash'
};

// --- Settings ---
function updateModelHint() {
  modelHint.textContent = MODEL_HINTS[providerSelect.value] || 'Leave blank for default';
}

providerSelect.addEventListener('change', updateModelHint);

toggleKeyVis.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleKeyVis.textContent = isPassword ? 'Hide' : 'Show';
});

saveSettingsBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    showStatus(settingsStatus, 'Please enter an API key', 'error');
    return;
  }
  provider = providerSelect.value;
  apiKey = key;
  modelOverride = modelInput.value.trim();
  chrome.storage.local.set({ provider, apiKey: key, modelOverride });
  showStatus(settingsStatus, 'Settings saved', 'success');
});

// --- Init ---
async function initApp() {
  const stored = await chrome.storage.local.get(['projects', 'activeProjectId', 'projectEnabled', 'provider', 'apiKey', 'modelOverride']);
  if (stored.projects) {
    projects = stored.projects;
  }
  if (stored.activeProjectId && projects[stored.activeProjectId]) {
    activeProjectId = stored.activeProjectId;
  }
  if (stored.projectEnabled === false) {
    projectEnabled = false;
    projectToggle.checked = false;
  }
  if (stored.provider) {
    provider = stored.provider;
    providerSelect.value = provider;
  }
  if (stored.apiKey) {
    apiKey = stored.apiKey;
    apiKeyInput.value = apiKey;
  }
  if (stored.modelOverride) {
    modelOverride = stored.modelOverride;
    modelInput.value = modelOverride;
  }
  updateModelHint();

  renderProjectSelect();
  renderFileList();
}

initApp();

// --- Listen for tab navigation and new tabs to apply URL-scoped replacements ---
let navDebounce = null;
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'TAB_URL_CHANGED') {
    clearTimeout(navDebounce);
    navDebounce = setTimeout(() => applyAllActive(), 500);
  }

  if (message.type === 'CONTENT_SCRIPT_READY' && sender.tab) {
    // A new or reloaded tab is ready — push its replacements
    const tabId = sender.tab.id;
    try {
      const pathname = new URL(message.url).pathname;
      const reps = getReplacementsForPathname(pathname);
      if (reps.length > 0) {
        chrome.tabs.sendMessage(tabId, { type: 'APPLY_REPLACEMENTS', replacements: reps }).catch(() => {});
      }
    } catch {}
  }
});

// --- Projects ---
function renderProjectSelect() {
  projectSelect.innerHTML = '';

  const ids = Object.keys(projects);
  if (!ids.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No projects — click + New';
    projectSelect.appendChild(opt);
    activeProjectId = null;
    return;
  }

  ids.forEach(id => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = projects[id].name;
    if (id === activeProjectId) opt.selected = true;
    projectSelect.appendChild(opt);
  });

  // If no active project, select the first one
  if (!activeProjectId || !projects[activeProjectId]) {
    activeProjectId = ids[0];
    projectSelect.value = activeProjectId;
  }
}

projectSelect.addEventListener('change', async () => {
  activeProjectId = projectSelect.value;
  editingFileName = null;
  reviewSection.classList.add('hidden');
  saveState();
  renderFileList();
  await applyAllActive();
});

addProjectBtn.addEventListener('click', () => {
  const name = prompt('Project name (e.g. company name):');
  if (!name) return;

  const id = generateId();
  projects[id] = {
    name: name.trim(),
    files: {},
    fileEnabled: {}
  };
  activeProjectId = id;
  saveState();
  renderProjectSelect();
  renderFileList();
});

deleteProjectBtn.addEventListener('click', async () => {
  const proj = getActiveProject();
  if (!proj) return;
  if (!confirm(`Delete project "${proj.name}" and all its files?`)) return;

  delete projects[activeProjectId];
  activeProjectId = Object.keys(projects)[0] || null;
  editingFileName = null;
  reviewSection.classList.add('hidden');
  saveState();
  renderProjectSelect();
  renderFileList();
  await applyAllActive();
});

// --- Project toggle ---
projectToggle.addEventListener('change', async () => {
  projectEnabled = projectToggle.checked;
  saveState();
  await applyAllActive();
});

// --- Capture ---
captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  captureBtn.textContent = '⏳ Capturing...';

  try {
    const response = await sendMessage({ type: 'CAPTURE_PAGE' });
    if (response.error) throw new Error(response.error);

    capturedData = response;
    screenshotPreview.src = response.screenshot;
    captureInfo.textContent = `Captured: ${response.pageTitle || response.pageUrl}`;
    capturePreview.classList.remove('hidden');
    customizeSection.classList.remove('hidden');
    captureBtn.textContent = '📸 Capture Page';
  } catch (err) {
    showStatus(generateStatus, `Capture failed: ${err.message}`, 'error');
  } finally {
    captureBtn.disabled = false;
  }
});

// --- Generate ---
generateBtn.addEventListener('click', async () => {
  const company = companyInput.value.trim();
  if (!company) {
    showStatus(generateStatus, 'Please enter a company name', 'error');
    return;
  }
  if (!capturedData) {
    showStatus(generateStatus, 'Please capture a page first', 'error');
    return;
  }

  // Auto-create a project if none exists
  if (!activeProjectId) {
    const id = generateId();
    projects[id] = { name: company, files: {}, fileEnabled: {} };
    activeProjectId = id;
    saveState();
    renderProjectSelect();
  }

  generateBtn.disabled = true;
  showStatus(generateStatus, '<span class="spinner"></span>Generating replacements...', 'loading');

  try {
    const instructions = instructionsInput.value.trim();
    const result = await callAI(company, instructions, capturedData);
    replacements = result;

    // Auto-save to the active project
    const filename = buildFilename(capturedData.pageUrl);
    editingFileName = filename;
    saveFileToProject(filename, replacements, capturedData.pageUrl);

    renderReplacements();
    reviewSection.classList.remove('hidden');
    renderFileList();
    await applyAllActive();
    showStatus(generateStatus, `Generated ${replacements.length} replacements → saved to ${filename}`, 'success');
  } catch (err) {
    showStatus(generateStatus, `Generation failed: ${err.message}`, 'error');
  } finally {
    generateBtn.disabled = false;
  }
});

function buildFilename(pageUrl) {
  const url = new URL(pageUrl);
  const pathSlug = url.pathname.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'home';
  return `${pathSlug}.json`;
}

function saveFileToProject(filename, reps, pageUrl) {
  const proj = getActiveProject();
  if (!proj) return;

  const pathname = pageUrl ? new URL(pageUrl).pathname : (proj.files[filename]?.pathname || '/');
  const fullUrl = pageUrl || proj.files[filename]?.url || '';
  proj.files[filename] = {
    replacements: reps.map(r => ({ ...r })),
    pathname,
    url: fullUrl
  };
  if (!(filename in proj.fileEnabled)) {
    proj.fileEnabled[filename] = true;
  }
  saveState();
}

// --- Call AI API (multi-provider) ---

const SYSTEM_PROMPT = `You are a demo customization assistant. You analyze web page HTML and a screenshot to generate find-and-replace text mappings that customize the page for a specific company/prospect.

You will receive:
1. A screenshot of the page (for visual context)
2. The page's HTML (so you can see exact text node content and structure)
3. A list of all visible text strings on the page — these are the EXACT text node values from the DOM

HOW THE REPLACEMENT ENGINE WORKS:
- It matches FULL TEXT NODES. Each "find" must be the COMPLETE content of a text node.
- It does NOT do substring matching. If a text node contains "Michael highlighted financing programs", you must use that ENTIRE string as the "find", not just "Michael".
- The "replace" should be the complete rewritten version of that text node with ALL customizations baked in.

STRATEGY:
- For each text node in the visible texts list that contains content worth customizing, output one replacement with the FULL text node as "find" and the fully rewritten text as "replace".
- Bake ALL changes into each replacement. If a text node mentions "Michael" and "equipment financing", your single replacement for that node should change BOTH.
- Short text nodes that are just a name (e.g. "Michael Thompson") get their own replacement.
- Long text nodes (paragraphs, summaries) get a single replacement with the full rewritten paragraph.
- If a text node doesn't need any changes, DO NOT include it.

RULES:
- Return ONLY a JSON array of objects with "find" and "replace" keys
- Every "find" value MUST be a COMPLETE, EXACT match of a string from the visible texts list
- Do NOT use substrings — always use the full text node value
- Keep replacement text the same approximate length
- Do NOT replace generic UI labels (like "Settings", "Dashboard", "Search", "Briefs", "Outline")
- Do NOT replace numbers, dates, percentages, or metrics unless specifically asked
- Make the demo feel authentic and tailored`;

function buildUserPrompt(company, instructions, pageData) {
  let prompt = `I need to customize this web page for a demo with **${company}**.`;
  if (instructions) prompt += `\n\nAdditional instructions: ${instructions}`;
  prompt += `\n\nPage URL: ${pageData.pageUrl}`;
  prompt += `\n\nPage title: ${pageData.pageTitle}`;
  prompt += `\n\n--- PAGE HTML ---\n${pageData.pageHTML}`;
  prompt += `\n\n--- VISIBLE TEXT STRINGS (use these EXACT strings for "find" values) ---\n${JSON.stringify(pageData.visibleTexts, null, 2)}`;
  return prompt;
}

async function callAI(company, instructions, pageData) {
  if (!apiKey) throw new Error('No API key configured — open Settings above');

  const model = modelOverride || DEFAULT_MODELS[provider];
  const userPrompt = buildUserPrompt(company, instructions, pageData);
  const imageBase64 = pageData.screenshot.split(',')[1];

  let responseText;

  if (provider === 'anthropic') {
    responseText = await callAnthropic(model, userPrompt, imageBase64);
  } else if (provider === 'openai') {
    responseText = await callOpenAI(model, userPrompt, imageBase64);
  } else if (provider === 'gemini') {
    responseText = await callGemini(model, userPrompt, imageBase64);
  } else {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Could not parse replacements from AI response');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Expected an array of replacements');
  return parsed.filter(r => r.find && r.replace && typeof r.find === 'string' && typeof r.replace === 'string');
}

async function callAnthropic(model, userPrompt, imageBase64) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          { type: 'text', text: userPrompt }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAI(model, userPrompt, imageBase64) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            { type: 'text', text: userPrompt }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGemini(model, userPrompt, imageBase64) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/png', data: imageBase64 } },
          { text: userPrompt }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// --- Replacements Editor ---
function renderReplacements() {
  replacementsEditor.innerHTML = '';

  if (editingFileName) {
    const proj = getActiveProject();
    const fileData = proj?.files[editingFileName];
    const fileUrl = fileData?.url;
    if (fileUrl) {
      editingFileNameEl.innerHTML = `Editing: ${editingFileName} — <a href="${escapeHtml(fileUrl)}" target="_blank">Open page</a>`;
    } else {
      editingFileNameEl.textContent = `Editing: ${editingFileName}`;
    }
  } else {
    editingFileNameEl.textContent = '';
  }

  replacements.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'replacement-row';
    row.innerHTML = `
      <input type="text" class="find-input" value="${escapeHtml(r.find)}" data-index="${i}" />
      <span class="arrow">→</span>
      <input type="text" class="replace-input" value="${escapeHtml(r.replace)}" data-index="${i}" />
      <button class="delete-row" data-index="${i}">✕</button>
    `;
    replacementsEditor.appendChild(row);
  });

  replacementsEditor.querySelectorAll('.find-input').forEach(input => {
    input.addEventListener('change', (e) => {
      replacements[e.target.dataset.index].find = e.target.value;
    });
  });

  replacementsEditor.querySelectorAll('.replace-input').forEach(input => {
    input.addEventListener('change', (e) => {
      replacements[e.target.dataset.index].replace = e.target.value;
    });
  });

  replacementsEditor.querySelectorAll('.delete-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      replacements.splice(e.target.dataset.index, 1);
      renderReplacements();
    });
  });
}

addRowBtn.addEventListener('click', () => {
  replacements.push({ find: '', replace: '' });
  renderReplacements();
  const inputs = replacementsEditor.querySelectorAll('.find-input');
  inputs[inputs.length - 1]?.focus();
});

// --- Save file (from editor) ---
saveFileBtn.addEventListener('click', async () => {
  if (!editingFileName) {
    showStatus(generateStatus, 'No file to save — generate or load a file first', 'error');
    return;
  }
  const validReplacements = replacements.filter(r => r.find && r.replace);
  saveFileToProject(editingFileName, validReplacements);
  renderFileList();
  await applyAllActive();
  showStatus(generateStatus, `Saved ${editingFileName}`, 'success');
});

// --- Get replacements for a given pathname from the active project ---
function getReplacementsForPathname(pathname) {
  const proj = getActiveProject();
  if (!projectEnabled || !proj) return [];

  const reps = [];
  for (const [filename, fileData] of Object.entries(proj.files)) {
    if (proj.fileEnabled[filename] === false) continue;

    // URL scoping: file only applies to the page it was captured from
    const filePathname = fileData.pathname;
    if (pathname && filePathname) {
      if (filePathname !== pathname) continue;
    } else if (pathname && !filePathname) {
      // Legacy file without pathname — skip it (safer than applying everywhere)
      console.log(`[Panel] Skipping ${filename} — no pathname stored (legacy file)`);
      continue;
    }

    const fileReps = fileData.replacements || fileData;
    reps.push(...fileReps);
  }
  return reps;
}

// --- Apply replacements to ALL open tabs (each tab gets only its URL-matched replacements) ---
async function applyAllActive() {
  const proj = getActiveProject();

  let anyActive = false;

  try {
    const tabs = await chrome.tabs.query({});

    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;

      let tabPathname;
      try { tabPathname = new URL(tab.url).pathname; } catch { continue; }

      const reps = getReplacementsForPathname(tabPathname);

      try {
        if (reps.length > 0) {
          await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_REPLACEMENTS', replacements: reps });
          anyActive = true;
        } else {
          await chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_REPLACEMENTS' });
        }
      } catch {
        // Content script not loaded in this tab — that's fine, skip it
      }
    }
  } catch (e) {
    console.error('[Panel] Error applying to tabs:', e);
  }

  if (anyActive) {
    statusBadge.textContent = 'Active';
    statusBadge.className = 'badge active';
  } else {
    statusBadge.textContent = projectEnabled ? 'Ready' : 'Paused';
    statusBadge.className = 'badge';
  }
}

// --- File list ---
function renderFileList() {
  fileList.innerHTML = '';
  const proj = getActiveProject();

  if (!proj || !Object.keys(proj.files).length) {
    fileList.innerHTML = '<p class="hint" style="padding:8px 0">No files yet — capture a page and generate</p>';
    return;
  }

  Object.keys(proj.files).forEach(filename => {
    const fileData = proj.files[filename];
    const reps = fileData.replacements || fileData; // backwards compat
    const enabled = proj.fileEnabled[filename] !== false;
    const isEditing = filename === editingFileName;
    const item = document.createElement('div');
    item.className = `file-item${enabled ? '' : ' disabled'}${isEditing ? ' selected' : ''}`;

    const count = Array.isArray(reps) ? reps.length : 0;
    const linkUrl = fileData.url || '';
    const linkEl = linkUrl
      ? `<a href="${escapeHtml(linkUrl)}" target="_blank" class="file-link" title="${escapeHtml(linkUrl)}">🔗</a>`
      : '';
    item.innerHTML = `
      <label class="toggle" title="Toggle this file">
        <input type="checkbox" class="file-toggle" data-file="${filename}" ${enabled ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
      <span class="file-name clickable" data-file="${filename}">📄 ${filename} <span class="hint">(${count})</span></span>
      <div class="file-actions">
        ${linkEl}
        <button class="delete-file" data-file="${filename}" title="Delete">🗑</button>
      </div>
    `;
    fileList.appendChild(item);
  });

  // Click file name → load into editor
  fileList.querySelectorAll('.file-name.clickable').forEach(el => {
    el.addEventListener('click', (e) => {
      const filename = e.currentTarget.dataset.file;
      const fileData = proj.files[filename];
      const reps = fileData.replacements || fileData; // backwards compat
      editingFileName = filename;
      replacements = reps.map(r => ({ ...r }));
      renderReplacements();
      reviewSection.classList.remove('hidden');
      renderFileList();
    });
  });

  // Per-file toggles
  fileList.querySelectorAll('.file-toggle').forEach(toggle => {
    toggle.addEventListener('change', async (e) => {
      const filename = e.target.dataset.file;
      proj.fileEnabled[filename] = e.target.checked;
      saveState();
      renderFileList();
      await applyAllActive();
    });
  });

  fileList.querySelectorAll('.delete-file').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const filename = e.target.dataset.file;
      delete proj.files[filename];
      delete proj.fileEnabled[filename];
      if (editingFileName === filename) {
        editingFileName = null;
        reviewSection.classList.add('hidden');
      }
      saveState();
      renderFileList();
      await applyAllActive();
    });
  });
}

// --- Export / Import ---
exportBtn.addEventListener('click', () => {
  const proj = getActiveProject();
  if (!proj) return;

  const exportData = {
    name: proj.name,
    version: '1.0',
    exportedAt: new Date().toISOString(),
    files: proj.files,
    fileEnabled: proj.fileEnabled
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${proj.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-demo.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.files && typeof data.files === 'object') {
      const id = generateId();
      projects[id] = {
        name: data.name || file.name.replace('.json', ''),
        files: data.files,
        fileEnabled: data.fileEnabled || {}
      };
      activeProjectId = id;
      saveState();
      renderProjectSelect();
      renderFileList();
      await applyAllActive();
      showStatus(generateStatus, `Imported project "${projects[id].name}"`, 'success');
    } else {
      throw new Error('Invalid project file format');
    }
  } catch (err) {
    showStatus(generateStatus, `Import failed: ${err.message}`, 'error');
  }

  importFile.value = '';
});

const debugLogs = [];

function debug(msg, data) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}` + (data ? ` ${JSON.stringify(data)}` : '');
  debugLogs.push(line);
  const el = document.getElementById('debugContent');
  const count = document.getElementById('debugCount');
  if (el) {
    el.textContent = debugLogs.slice(-50).join('\n');
    el.scrollTop = el.scrollHeight;
  }
  if (count) count.textContent = debugLogs.length;
}

document.querySelectorAll('.section-header[data-toggle="collapse"]').forEach(header => {
  header.addEventListener('click', () => {
    const section = header.closest('.collapsible');
    if (section) section.classList.toggle('collapsed');
  });
});

const elements = {
  apiKeyInput: document.getElementById('apiKeyInput'),
  saveApiKey: document.getElementById('saveApiKey'),
  clearApiKey: document.getElementById('clearApiKey'),
  apiKeyStatus: document.getElementById('apiKeyStatus'),
  fillForm: document.getElementById('fillForm'),
  fillStatus: document.getElementById('fillStatus'),
  formsSection: document.getElementById('formsSection'),
  formsList: document.getElementById('formsList'),
  formCount: document.getElementById('formCount'),
  modelSelect: document.getElementById('modelSelect'),
  fillSpeed: document.getElementById('fillSpeed'),
  autoFillConfirm: document.getElementById('autoFillConfirm'),
  toneSelect: document.getElementById('toneSelect'),
  saveSettings: document.getElementById('saveSettings'),
  settingsStatus: document.getElementById('settingsStatus'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingText: document.getElementById('loadingText'),
  toast: document.getElementById('toast'),
  confirmationModal: document.getElementById('confirmationModal'),
  previewContent: document.getElementById('previewContent'),
  confirmFill: document.getElementById('confirmFill'),
  cancelFill: document.getElementById('cancelFill'),
  closeModal: document.getElementById('closeModal'),
  customPrompt: document.getElementById('customPrompt'),
  modalPrompt: document.getElementById('modalPrompt'),
  stopFillBtn: document.getElementById('stopFillBtn'),
  savePromptBtn: document.getElementById('savePromptBtn'),
  promptTemplatesList: document.getElementById('promptTemplatesList'),
  aiPreview: document.getElementById('aiPreview'),
  aiPreviewModal: document.getElementById('aiPreviewModal'),
  aiPreviewContent: document.getElementById('aiPreviewContent'),
  confirmAiFill: document.getElementById('confirmAiFill'),
  cancelAiPreview: document.getElementById('cancelAiPreview'),
  closeAiPreview: document.getElementById('closeAiPreview'),
  smartMemoryGrid: document.getElementById('smartMemoryGrid'),
  saveSmartMemory: document.getElementById('saveSmartMemory'),
  smartMemoryStatus: document.getElementById('smartMemoryStatus'),
  fileInput: document.getElementById('fileInput'),
  uploadArea: document.getElementById('uploadArea'),
  uploadPlaceholder: document.getElementById('uploadPlaceholder'),
  uploadPreview: document.getElementById('uploadPreview'),
  uploadFileInfo: document.getElementById('uploadFileInfo'),
  fillFromUploadBtn: document.getElementById('fillFromUploadBtn'),
  clearUploadBtn: document.getElementById('clearUploadBtn'),
  ocrStatus: document.getElementById('ocrStatus'),
  ocrContext: document.getElementById('ocrContext'),
  apiKeyHelpBtn: document.getElementById('apiKeyHelpBtn'),
  apiKeyHelpPopover: document.getElementById('apiKeyHelpPopover')
};

let detectedForms = [];
let cachedSettings = {};
let pendingConfirmationOptions = {};
let fillTargetTabId = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('No active tab found.');
  }
  return tab;
}

async function getFillTargetTab() {
  if (fillTargetTabId) {
    try {
      return await chrome.tabs.get(fillTargetTabId);
    } catch (e) {
      fillTargetTabId = null;
    }
  }

  const tab = await getActiveTab();
  fillTargetTabId = tab.id;
  return tab;
}

async function sendMessageToFillTarget(message) {
  const tab = await getFillTargetTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    debug('Content script unavailable, injecting scripts', e.message);
    await injectContentScript(tab);
    return await chrome.tabs.sendMessage(tab.id, message);
  }
}

function showToast(message, type = 'info') {
  const toast = elements.toast;
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

function showLoading(text = 'Generating form data with AI...') {
  elements.loadingText.textContent = text;
  elements.stopFillBtn.classList.remove('hidden');
  elements.loadingOverlay.classList.remove('hidden');
}

elements.loadingOverlay.addEventListener('click', (e) => {
  e.stopPropagation();
});

function hideLoading() {
  elements.stopFillBtn.classList.add('hidden');
  elements.loadingOverlay.classList.add('hidden');
}

async function loadPromptTemplates() {
  const templates = await window.AppStorage.getPromptTemplates();
  const list = elements.promptTemplatesList;
  list.innerHTML = '';
  if (templates.length === 0) {
    list.style.display = 'none';
    return;
  }
  list.style.display = 'flex';
  templates.forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'prompt-template-chip';
    chip.title = t.prompt;
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = t.name;
    name.addEventListener('click', () => {
      elements.customPrompt.value = t.prompt;
      elements.customPrompt.dispatchEvent(new Event('input', { bubbles: true }));
      showToast(`Loaded "${t.name}"`, 'info');
    });
    const del = document.createElement('button');
    del.className = 'chip-delete';
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.AppStorage.deletePromptTemplate(t.id);
      await loadPromptTemplates();
      showToast(`Deleted "${t.name}"`, 'info');
    });
    chip.appendChild(name);
    chip.appendChild(del);
    list.appendChild(chip);
  });
}

async function saveCurrentPrompt() {
  const prompt = elements.customPrompt.value.trim();
  if (!prompt) {
    showToast('Write a prompt first.', 'error');
    return;
  }
  const name = prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt;
  const { value: templateName } = await new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = name;
    input.placeholder = 'Template name';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:3000;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;width:300px;display:flex;flex-direction:column;gap:12px;';
    const label = document.createElement('div');
    label.textContent = 'Save Prompt Template';
    label.style.cssText = 'font-size:14px;font-weight:600;color:var(--text-primary);';
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px;';
    const save = document.createElement('button');
    save.textContent = 'Save';
    save.className = 'btn btn-primary';
    save.style.cssText = 'flex:1;padding:8px 16px;border:none;border-radius:8px;background:var(--accent);color:white;cursor:pointer;font-size:13px;';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.className = 'btn btn-secondary';
    cancel.style.cssText = 'flex:1;padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:13px;';
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(buttons);
    buttons.appendChild(save);
    buttons.appendChild(cancel);
    dialog.appendChild(box);
    document.body.appendChild(dialog);
    input.focus();
    input.select();
    const close = (val) => {
      document.body.removeChild(dialog);
      resolve({ value: val });
    };
    save.addEventListener('click', () => close(input.value));
    cancel.addEventListener('click', () => close(''));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(''); });
  });
  if (!templateName) return;
  await window.AppStorage.savePromptTemplate({ name: templateName, prompt });
  await loadPromptTemplates();
  showToast('Prompt saved.', 'success');
}

function updateProgress(message) {
  if (!message) return;
  elements.loadingText.textContent = message;
  elements.fillStatus.textContent = message;
  elements.fillStatus.className = 'status-msg loading';
  debug('Progress', message);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.source !== 'ai-form-filler') return;

  if (message.type === 'progress') {
    updateProgress(message.message);
  }

  if (message.type === 'debug') {
    const label = message.level === 'error' ? 'Error' : 'Debug';
    debug(label + ': ' + message.message, message.data);
  }
});

async function loadApiKey() {
  debug('loadApiKey');
  const key = await window.AppStorage.getApiKey();
  if (key) {
    elements.apiKeyInput.value = key;
    elements.apiKeyStatus.textContent = 'API key is set';
    elements.apiKeyStatus.className = 'status-msg success';
  } else {
    elements.apiKeyStatus.textContent = 'No API key set';
    elements.apiKeyStatus.className = 'status-msg';
  }
}

async function loadSettings() {
  const settings = await window.AppStorage.getSettings();
  cachedSettings = settings;
  const hasSavedModel = Array.from(elements.modelSelect.options)
    .some(option => option.value === settings.model);
  elements.modelSelect.value = hasSavedModel ? settings.model : 'gemma-4-31b-it';
  elements.fillSpeed.value = settings.fillSpeed;
  elements.autoFillConfirm.checked = settings.autoFillConfirm;
  elements.aiPreview.checked = settings.aiPreview;
  elements.toneSelect.value = settings.tone || 'professional';
}

const MEMORY_FIELDS = [
  { key: 'company', label: 'Company' },
  { key: 'phone', label: 'Phone' },
  { key: 'gst', label: 'GST' },
  { key: 'pan', label: 'PAN' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' }
];

async function loadSmartMemory() {
  const memory = await window.AppStorage.getSmartMemory();
  const grid = elements.smartMemoryGrid;
  grid.innerHTML = '';
  MEMORY_FIELDS.forEach(mf => {
    const row = document.createElement('div');
    row.className = 'memory-row';

    const label = document.createElement('span');
    label.className = 'memory-label';
    label.textContent = mf.label;

    const input = document.createElement('input');
    input.className = 'input';
    input.type = 'text';
    input.value = memory[mf.key] || '';
    input.placeholder = `Enter ${mf.label.toLowerCase()}`;
    input.dataset.memoryKey = mf.key;

    row.appendChild(label);
    row.appendChild(input);
    grid.appendChild(row);
  });
}

async function saveSmartMemory() {
  const data = {};
  elements.smartMemoryGrid.querySelectorAll('.memory-row .input').forEach(input => {
    data[input.dataset.memoryKey] = input.value.trim();
  });
  try {
    const tab = await getActiveTab();
    const origin = tab && tab.url ? (new URL(tab.url)).origin : '';
    await window.AppStorage.saveSmartMemory(data, origin);
  } catch (e) {
    await window.AppStorage.saveSmartMemory(data);
  }
  elements.smartMemoryStatus.textContent = 'Smart memory saved.';
  elements.smartMemoryStatus.className = 'status-msg success';
  showToast('Smart memory saved.', 'success');
  setTimeout(() => {
    elements.smartMemoryStatus.textContent = '';
    elements.smartMemoryStatus.className = 'status-msg';
  }, 3000);
}

let extractedOcrText = '';

function getCurrentOcrContext() {
  if (elements.ocrContext.style.display !== 'none') {
    return (elements.ocrContext.value || '').trim();
  }
  return (extractedOcrText || '').trim();
}

function updateDocumentFillButton() {
  if (!elements.fillFromUploadBtn) return;
  const hasContext = !!getCurrentOcrContext();
  elements.fillFromUploadBtn.disabled = !hasContext;
  elements.fillFromUploadBtn.style.display = hasContext ? '' : 'none';
}

async function setDocumentContext(text) {
  extractedOcrText = text || '';
  elements.ocrContext.value = extractedOcrText;
  elements.ocrContext.style.display = extractedOcrText ? '' : 'none';
  await window.AppStorage.saveDocumentContext(extractedOcrText);
  updateDocumentFillButton();
}

async function loadDocumentContext() {
  const text = await window.AppStorage.getDocumentContext();
  if (!text) return;

  extractedOcrText = text;
  elements.ocrContext.value = text;
  elements.ocrContext.style.display = '';
  elements.uploadPlaceholder.classList.add('hidden');
  elements.uploadPreview.classList.remove('hidden');
  elements.uploadFileInfo.textContent = 'Saved document context';
  elements.ocrStatus.textContent = `Loaded ${text.length} saved context characters.`;
  elements.ocrStatus.className = 'status-msg success';
  updateDocumentFillButton();
}

let saveDocumentContextTimer = null;
function scheduleDocumentContextSave() {
  extractedOcrText = elements.ocrContext.value || '';
  updateDocumentFillButton();
  clearTimeout(saveDocumentContextTimer);
  saveDocumentContextTimer = setTimeout(async () => {
    await window.AppStorage.saveDocumentContext(extractedOcrText);
  }, 300);
}

const EXCEL_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
const SPREADSHEET_TYPES = [...EXCEL_TYPES, 'text/csv', 'text/tsv', 'text/comma-separated-values'];

function isExcelType(type) { return EXCEL_TYPES.includes(type); }

async function extractXlsxText(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  console.log('[XLSX] file:', file.name, 'size:', bytes.length, 'first bytes:', bytes[0]?.toString(16), bytes[1]?.toString(16), bytes[2]?.toString(16), bytes[3]?.toString(16));

  if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
    throw new Error('This file is not a valid .xlsx workbook. For .xls files, save as .xlsx or CSV and try again.');
  }

  const decoder = new TextDecoder('utf-8');

  function findZipEntries(data) {
    const decoderLocal = new TextDecoder('utf-8');

    function hasSig(offset, b2, b3) {
      return offset + 4 <= data.length
        && data[offset] === 0x50
        && data[offset + 1] === 0x4B
        && data[offset + 2] === b2
        && data[offset + 3] === b3;
    }
    function readU16(offset) {
      if (offset + 2 > data.length) throw new Error('This workbook appears to be incomplete or corrupted.');
      return data[offset] | (data[offset + 1] << 8);
    }
    function readU32(offset) {
      if (offset + 4 > data.length) throw new Error('This workbook appears to be incomplete or corrupted.');
      return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    }

    const entries = [];

    let eocd = data.length - 22;
    while (eocd >= 0 && !hasSig(eocd, 0x05, 0x06)) {
      eocd--;
    }
    if (eocd < 0) {
      throw new Error('This workbook appears to be incomplete or corrupted.');
    }

    const cdOffset = readU32(eocd + 16);
    const cdEntries = readU16(eocd + 8);

    console.log('[XLSX] eocd at:', eocd, 'cdOffset:', cdOffset, 'cdEntries:', cdEntries);

    let off = cdOffset;
    for (let ci = 0; ci < cdEntries; ci++) {
      if (off + 46 > data.length || !hasSig(off, 0x01, 0x02)) {
        throw new Error('This workbook appears to be incomplete or corrupted.');
      }
      const compression = readU16(off + 10);
      const compSize = readU32(off + 20);
      const uncompSize = readU32(off + 24);
      const nameLen = readU16(off + 28);
      const extraLen = readU16(off + 30);
      const commentLen = readU16(off + 32);
      const localOffset = readU32(off + 42);
      const entryEnd = off + 46 + nameLen + extraLen + commentLen;
      if (entryEnd > data.length) {
        throw new Error('This workbook appears to be incomplete or corrupted.');
      }
      const name = decoderLocal.decode(data.slice(off + 46, off + 46 + nameLen));

      const localHeader = localOffset;
      if (localHeader + 30 > data.length || !hasSig(localHeader, 0x03, 0x04)) {
        throw new Error('This workbook appears to be incomplete or corrupted.');
      }
      const localNameLen = readU16(localHeader + 26);
      const localExtraLen = readU16(localHeader + 28);
      const dataStart = localHeader + 30 + localNameLen + localExtraLen;

      if (dataStart + compSize > data.length) {
        throw new Error('This workbook appears to be incomplete or corrupted.');
      }

      const localCompSize = readU32(localHeader + 18);
      const localFlags = readU16(localHeader + 6);
      console.log('[XLSX] entry:', name, 'compression:', compression, 'compSize(cd):', compSize, 'compSize(local):', localCompSize, 'uncompSize:', uncompSize, 'localSigOK:', true, 'localOffset:', localOffset, 'dataStart:', dataStart, 'flags:', localFlags.toString(2));

      entries.push({
        name,
        data: data.slice(dataStart, dataStart + compSize),
        compression,
        uncompSize
      });

      off = entryEnd;
    }

    return entries;
  }

  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Your browser does not support XLSX parsing. Try saving as CSV instead.');
    }

    async function tryDecompress(bytes, format) {
      const cs = new DecompressionStream(format);
      const blob = new Blob([bytes]);
      const stream = blob.stream().pipeThrough(cs);
      const reader = stream.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const result = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { result.set(c, pos); pos += c.length; }
      return decoder.decode(result);
    }

    try {
      return await tryDecompress(data, 'deflate-raw');
    } catch (rawError) {
      try {
        return await tryDecompress(data, 'deflate');
      } catch (deflateError) {
        console.warn('[XLSX] decompression failed:', rawError?.message, deflateError?.message);
        throw new Error('Could not read this XLSX workbook. Save it again as .xlsx or CSV and try again.');
      }
    }
  }

  function parseXmlText(xml) {
    const texts = [];
    const textMatch = xml.match(/<t[^>]*>([^<]*)<\/t>/g);
    if (textMatch) {
      for (const m of textMatch) {
        const inner = m.replace(/<t[^>]*>/, '').replace(/<\/t>/, '');
        texts.push(inner.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
      }
    }
    const rowMatch = xml.match(/<row[^>]*>([\s\S]*?)<\/row>/g);
    if (rowMatch) {
      const cellTexts = texts.length > 0 ? texts : [];
      return cellTexts.join(' ');
    }
    return texts.join(' ');
  }

  const entries = findZipEntries(bytes);

  let output = '';

  const strings = [];
  const ssEntry = entries.find(e => e.name === 'xl/sharedStrings.xml');
  if (ssEntry) {
    const ssXml = ssEntry.compression === 0 ? decoder.decode(ssEntry.data) : await inflate(ssEntry.data);
    const siMatch = ssXml.match(/<si>([\s\S]*?)<\/si>/g);
    if (siMatch) {
      for (const si of siMatch) {
        const tMatch = si.match(/<t[^>]*>([^<]*)<\/t>/);
        if (tMatch) strings.push(tMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
      }
    }
    output += 'Shared Values:\n' + strings.join(', ') + '\n\n';
  }

  const sheetEntries = entries.filter(e => e.name.match(/xl\/worksheets\/sheet\d+\.xml/));
  for (const se of sheetEntries) {
    const sheetXml = se.compression === 0 ? decoder.decode(se.data) : await inflate(se.data);
    const rows = sheetXml.match(/<row[^>]*>([\s\S]*?)<\/row>/g) || [];
    const rowTexts = [];
    for (const row of rows) {
      const cells = row.match(/<c[^>]*>([\s\S]*?)<\/c>/g) || [];
      const cellTexts = [];
      for (const cell of cells) {
        const vMatch = cell.match(/<v>([^<]*)<\/v>/);
        const tMatch = cell.match(/<t[^>]*>([^<]*)<\/t>/);
        const typeAttr = cell.match(/<c[^>]*t="([^"]*)"/);
        if (tMatch) {
          cellTexts.push(tMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
        } else if (vMatch) {
          if (typeAttr && typeAttr[1] === 's') {
            const idx = parseInt(vMatch[1]);
            cellTexts.push(strings && strings[idx] !== undefined ? strings[idx] : vMatch[1]);
          } else {
            cellTexts.push(vMatch[1]);
          }
        }
      }
      if (cellTexts.length > 0) rowTexts.push(cellTexts.join(', '));
    }
    output += `Sheet (${se.name}):\n${rowTexts.join('\n')}\n\n`;
  }

  return output.trim() || 'No text could be extracted from this spreadsheet.';
}

async function handleFileUpload(file) {
  if (!file) return;

  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  const isCsv = file.type === 'text/csv' || file.type === 'text/tsv' || file.type === 'text/comma-separated-values' || file.name.endsWith('.csv');
  const isExcel = isExcelType(file.type) || file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
  const validTypes = isImage || isPdf || isCsv || isExcel;

  if (!validTypes) {
    showToast('Please upload an image, PDF, CSV, or Excel file.', 'error');
    return;
  }

  const ext = file.name.split('.').pop().toLowerCase();
  const allowedExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'csv', 'tsv', 'xlsx', 'xls'];
  if (!allowedExts.includes(ext)) {
    showToast('Unsupported file format.', 'error');
    return;
  }

  elements.uploadPlaceholder.classList.add('hidden');
  elements.uploadPreview.classList.remove('hidden');
  elements.uploadFileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  elements.ocrStatus.textContent = 'Extracting text...';
  elements.ocrStatus.className = 'status-msg loading';
  elements.ocrContext.style.display = 'none';

  try {
    let text = '';

    if (isCsv) {
      text = await file.text();
    } else if (isExcel) {
      text = await extractXlsxText(file);
    } else {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const apiKey = await window.AppStorage.getApiKey();
      if (!apiKey) {
        elements.ocrStatus.textContent = 'Set your API key first.';
        elements.ocrStatus.className = 'status-msg error';
        return;
      }

      const settings = await window.AppStorage.getSettings();
      text = await window.GeminiService.extractTextFromFile(base64, file.type, settings);
    }

    await setDocumentContext(text);
    elements.ocrStatus.textContent = `Extracted ${text.length} characters.`;
    elements.ocrStatus.className = 'status-msg success';
    showToast('Document text extracted.', 'success');
  } catch (error) {
    debug('OCR error', error.message);
    elements.ocrStatus.textContent = error.message;
    elements.ocrStatus.className = 'status-msg error';
    elements.ocrContext.style.display = 'none';
  }
}

async function clearUpload() {
  extractedOcrText = '';
  elements.fileInput.value = '';
  elements.ocrContext.value = '';
  elements.ocrContext.style.display = 'none';
  elements.ocrStatus.textContent = '';
  elements.ocrStatus.className = 'status-msg';
  elements.uploadPlaceholder.classList.remove('hidden');
  elements.uploadPreview.classList.add('hidden');
  await window.AppStorage.removeDocumentContext();
  updateDocumentFillButton();
}

async function detectForms() {
  debug('detectForms start');
  try {
    const tab = await getActiveTab();
    fillTargetTabId = tab.id;

    if (tab.url && tab.url.startsWith('file://')) {
      throw new Error('This extension does not work on local file:// pages. Enable "Allow access to file URLs" in extension settings, or test on a live website.');
    }

    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getForms' });
    } catch (e) {
      debug('Content script unavailable, injecting scripts', e.message);
      await injectContentScript(tab);
      result = await chrome.tabs.sendMessage(tab.id, { action: 'getForms' });
    }

    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to detect forms.');
    }

    debug('detectForms success, forms:', result.forms?.length);
    return result.forms || [];
  } catch (error) {
    debug('detectForms error:', error.message);
    if (error.message.includes('Could not establish connection') ||
        error.message.includes('Receiving end does not exist')) {
      throw new Error('Please refresh the page and try again.');
    }
    throw error;
  }
}

async function refreshFormsList() {
  try {
    const forms = await detectForms();
    detectedForms = forms;
    
    if (forms.length === 0) {
      elements.formsSection.style.display = 'none';
      return;
    }

    elements.formsSection.style.display = 'block';
    elements.formCount.textContent = forms.length;
    elements.formsList.innerHTML = '';

    forms.forEach((form, index) => {
      const item = document.createElement('div');
      item.className = 'form-item';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'form-name';
      nameSpan.textContent = form.title || `Form ${index + 1}`;
      
      const countSpan = document.createElement('span');
      countSpan.className = 'form-field-count';
      countSpan.textContent = `${form.fields.length} fields`;
      
      const fillBtn = document.createElement('button');
      fillBtn.className = 'btn btn-primary';
      fillBtn.textContent = 'Fill';
      fillBtn.addEventListener('click', () => fillSpecificForm(index));
      
      item.appendChild(nameSpan);
      item.appendChild(countSpan);
      item.appendChild(fillBtn);
      elements.formsList.appendChild(item);
    });
  } catch (error) {
    elements.formsSection.style.display = 'none';
    debug('Error: refresh forms failed', error.message);
    showToast(error.message, 'error');
  }
}

async function fillCurrentForm() {
  debug('fillCurrentForm start');
  const apiKey = await window.AppStorage.getApiKey();
  if (!apiKey) {
    showToast('Please set your Gemini API key first.', 'error');
    return;
  }

  showLoading('Scanning page for forms...');

  try {
    const tab = await getActiveTab();
    fillTargetTabId = tab.id;

    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'fillForms', customPrompt: elements.customPrompt.value, aiPreview: elements.aiPreview.checked, ocrContext: getCurrentOcrContext() });
    } catch (e) {
      debug('Content script unavailable, injecting scripts', e.message);
      await injectContentScript(tab);
      result = await chrome.tabs.sendMessage(tab.id, { action: 'fillForms', customPrompt: elements.customPrompt.value, aiPreview: elements.aiPreview.checked, ocrContext: getCurrentOcrContext() });
    }

    if (!result) {
      throw new Error('Failed to communicate with the page.');
    }

    if (!result.success) {
      throw new Error(result.error || 'Failed to fill forms.');
    }

    if (result.needsConfirmation && result.forms) {
      hideLoading();
      detectedForms = result.forms;
      elements.modalPrompt.value = elements.customPrompt.value;
      pendingConfirmationOptions = {
        documentOnly: false,
        aiPreview: elements.aiPreview.checked,
        tabId: fillTargetTabId,
        ocrContext: getCurrentOcrContext()
      };
      showConfirmationModal(detectedForms);
      return;
    }

    if (result.needsPreview && result.formsData) {
      hideLoading();
      showAiPreviewModal(result.formsData);
      return;
    }

    hideLoading();

    if (result.results && result.results.length > 0) {
      const total = result.results.reduce((sum, r) => sum + Object.keys(r.values).length, 0);
      showToast(`Filled ${total} field(s) across ${result.results.length} form(s).`, 'success');
    } else {
      showToast('Forms filled successfully.', 'success');
    }

    await refreshFormsList();
  } catch (error) {
    hideLoading();
    debug('Error: fill current form failed', error.message);
    showToast(error.message, 'error');
  }
}

async function fillFromUploadedDocument() {
  debug('fillFromUploadedDocument start');
  const ocrContext = getCurrentOcrContext();
  if (!ocrContext) {
    showToast('Upload a document first.', 'error');
    return;
  }

  const apiKey = await window.AppStorage.getApiKey();
  if (!apiKey) {
    showToast('Please set your Gemini API key first.', 'error');
    return;
  }

  showLoading('Scanning page for fields...');

  try {
    const forms = await detectForms();
    if (forms.length === 0) {
      throw new Error('No fillable forms detected on this page.');
    }

    hideLoading();
    detectedForms = forms;
    pendingConfirmationOptions = {
      documentOnly: true,
      aiPreview: false,
      tabId: fillTargetTabId,
      ocrContext
    };
    elements.modalPrompt.value = 'Use only the uploaded document data. Do not invent values. Leave fields blank when the document has no matching value.';
    showConfirmationModal(detectedForms);
  } catch (error) {
    hideLoading();
    debug('Error: fill from document failed', error.message);
    showToast(error.message, 'error');
  }
}

async function injectContentScript(tab) {
  debug('Injecting content scripts into tab', tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [
      'utils/storage.js',
      'utils/dom.js',
      'utils/events.js',
      'services/gemini.js',
      'content/parser.js',
      'content/filler.js',
      'content/content.js'
    ]
  });
  await new Promise(r => setTimeout(r, 100));
}

async function fillSpecificForm(index, customPrompt = '', excludedFields = []) {
  debug('fillSpecificForm', index);
  const apiKey = await window.AppStorage.getApiKey();
  if (!apiKey) {
    showToast('Please set your Gemini API key first.', 'error');
    return;
  }

  showLoading('Generating form data...');

  try {
    const tab = await getActiveTab();
    fillTargetTabId = tab.id;
    let result;
    const ocr = getCurrentOcrContext();
    try {
      result = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillSpecificForm',
        formIndex: index,
        customPrompt,
        excludedFields,
        aiPreview: elements.aiPreview.checked,
        ocrContext: ocr
      });
    } catch (e) {
      debug('Content script unavailable, injecting scripts', e.message);
      await injectContentScript(tab);
      result = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillSpecificForm',
        formIndex: index,
        customPrompt,
        excludedFields,
        aiPreview: elements.aiPreview.checked,
        ocrContext: ocr
      });
    }

    hideLoading();

    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to fill form.');
    }

    const count = Object.keys(result.result.values).length;
    showToast(`Filled ${count} field(s) in "${result.result.form}".`, 'success');
    await refreshFormsList();
  } catch (error) {
    hideLoading();
    debug('Error: fill selected form failed', error.message);
    showToast(error.message, 'error');
  }
}

function showConfirmationModal(forms) {
  const preview = elements.previewContent;
  preview.innerHTML = '';

  forms.forEach((form, fi) => {
    const formDiv = document.createElement('div');
    formDiv.className = 'preview-form';
    
    const headerRow = document.createElement('div');
    headerRow.className = 'preview-form-title';
    headerRow.textContent = `${fi + 1}. ${form.title || 'Form'} (${form.fields.length} fields)`;
    formDiv.appendChild(headerRow);

    const toggleAll = document.createElement('label');
    toggleAll.className = 'field-checkbox';
    toggleAll.style.marginBottom = '6px';
    toggleAll.style.padding = '4px 8px';
    toggleAll.style.background = 'var(--bg-input)';
    toggleAll.style.borderRadius = '4px';
    const toggleCheck = document.createElement('input');
    toggleCheck.type = 'checkbox';
    toggleCheck.checked = true;
    toggleCheck.addEventListener('change', () => {
      const checkboxes = formDiv.querySelectorAll('.field-checkbox > input[type="checkbox"]');
      checkboxes.forEach(cb => { cb.checked = toggleCheck.checked; updateFieldRow(cb); });
    });
    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'field-label';
    toggleLabel.textContent = 'Toggle all';
    toggleLabel.style.color = 'var(--text-muted)';
    toggleAll.appendChild(toggleCheck);
    toggleAll.appendChild(toggleLabel);
    formDiv.appendChild(toggleAll);

    form.fields.forEach(field => {
      if (!field.name && !field.id) return;
      const row = document.createElement('div');
      row.className = 'preview-field';
      
      const cb = document.createElement('label');
      cb.className = 'field-checkbox';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = true;
      check.dataset.fieldKey = getFieldExclusionKey(field);
      check.addEventListener('change', () => updateFieldRow(check));
      const label = document.createElement('span');
      label.className = 'field-label';
      label.textContent = field.label || field.name || field.id;
      const typeBadge = document.createElement('span');
      typeBadge.className = 'field-type';
      typeBadge.textContent = field.type || 'text';
      
      cb.appendChild(check);
      cb.appendChild(label);
      cb.appendChild(typeBadge);
      row.appendChild(cb);
      formDiv.appendChild(row);
    });

    preview.appendChild(formDiv);
  });

  elements.confirmationModal.classList.remove('hidden');
}

function getFieldExclusionKey(field) {
  return [
    field.id,
    field.name,
    field.label,
    field.placeholder,
    field.type,
    field.xpath,
    field.cssSelector
  ].filter(Boolean).join('|').toLowerCase();
}

function updateFieldRow(checkbox) {
  const row = checkbox.closest('.preview-field');
  if (!row) return;
  row.classList.toggle('excluded', !checkbox.checked);
}

async function handleConfirmFill() {
  elements.confirmationModal.classList.add('hidden');

  const excludedFields = [];
  const checkboxes = elements.previewContent.querySelectorAll('.field-checkbox input[type="checkbox"]');
  checkboxes.forEach(cb => {
    if (!cb.checked && cb.dataset.fieldKey) {
      excludedFields.push(cb.dataset.fieldKey);
    }
  });
  const customPrompt = elements.modalPrompt.value;
  const options = pendingConfirmationOptions || {};

  showLoading(options.documentOnly ? 'Filling from uploaded document...' : 'Generating AI data and filling forms...');

  try {
    fillTargetTabId = options.tabId || fillTargetTabId;

    const results = [];
    const allFormsData = [];
    const ocr = options.ocrContext || getCurrentOcrContext();
    for (let i = 0; i < detectedForms.length; i++) {
      const result = await sendMessageToFillTarget({
        action: 'fillSpecificForm',
        formIndex: i,
        customPrompt,
        excludedFields,
        aiPreview: options.aiPreview ?? elements.aiPreview.checked,
        documentOnly: Boolean(options.documentOnly),
        ocrContext: ocr
      });
      if (result.success) {
        if (result.needsPreview && result.formsData) {
          allFormsData.push(...result.formsData);
        } else if (result.result) {
          results.push(result.result);
        }
      }
    }

    if (allFormsData.length > 0) {
      hideLoading();
      showAiPreviewModal(allFormsData);
      elements.customPrompt.value = customPrompt;
      return;
    }

    hideLoading();
    const total = results.reduce((sum, r) => sum + Object.keys(r.values).filter(k => r.values[k] !== '').length, 0);
    elements.customPrompt.value = customPrompt;
    showToast(options.documentOnly ? `Filled ${total} field(s) from document.` : `Filled ${total} field(s) across ${results.length} form(s).`, 'success');
    pendingConfirmationOptions = {};
    await refreshFormsList();
  } catch (error) {
    hideLoading();
    debug('Error: confirmed fill failed', error.message);
    showToast(error.message, 'error');
  }
}

function showAiPreviewModal(formsData) {
  const content = elements.aiPreviewContent;
  content.innerHTML = '';

  formsData.forEach((fd, fi) => {
    const formDiv = document.createElement('div');
    formDiv.className = 'preview-form';

    const title = document.createElement('div');
    title.className = 'preview-form-title';
    title.textContent = `${fi + 1}. ${fd.form || 'Form'} (${Object.keys(fd.values).length} fields)`;
    formDiv.appendChild(title);

    for (const [key, value] of Object.entries(fd.values)) {
      const fieldMeta = fd.fields.find(f => f.uniqueKey === key || f.name === key || f.id === key);
      const label = fieldMeta?.label || fieldMeta?.name || fieldMeta?.id || key;

      const row = document.createElement('div');
      row.className = 'preview-field';
      row.style.flexDirection = 'column';
      row.style.alignItems = 'stretch';
      row.style.gap = '4px';
      row.style.padding = '8px';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'field-label';
      labelSpan.textContent = label;
      labelSpan.style.fontSize = '11px';

      const input = document.createElement('input');
      input.className = 'input';
      input.value = value;
      input.style.fontSize = '12px';
      input.style.padding = '6px 10px';
      input.dataset.formIndex = fd.formIndex;
      input.dataset.fieldKey = key;

      row.appendChild(labelSpan);
      row.appendChild(input);
      formDiv.appendChild(row);
    }

    content.appendChild(formDiv);
  });

  elements.aiPreviewModal.classList.remove('hidden');
}

async function handleConfirmAiFill() {
  elements.aiPreviewModal.classList.add('hidden');
  showLoading('Filling form with reviewed values...');

  const formsData = [];
  const formGroups = elements.aiPreviewContent.querySelectorAll('.preview-form');
  formGroups.forEach(group => {
    const titleEl = group.querySelector('.preview-form-title');
    const rows = group.querySelectorAll('.preview-field');
    const values = {};
    let formIndex = -1;
    rows.forEach(row => {
      const input = row.querySelector('input');
      if (!input) return;
      formIndex = parseInt(input.dataset.formIndex);
      values[input.dataset.fieldKey] = input.value;
    });
    if (formIndex >= 0) {
      formsData.push({ formIndex, values });
    }
  });

  try {
    const result = await sendMessageToFillTarget({
      action: 'applyPreviewValues',
      formsData
    });

    hideLoading();

    if (result.success) {
      const total = result.results.reduce((sum, r) => sum + Object.keys(r.values).length, 0);
      showToast(`Filled ${total} field(s) across ${result.results.length} form(s).`, 'success');
    } else {
      showToast(result.error || 'Failed to fill forms.', 'error');
    }

    await refreshFormsList();
  } catch (error) {
    hideLoading();
    debug('Error: apply preview failed', error.message);
    showToast(error.message, 'error');
  }
}

function handleCancelFill() {
  elements.confirmationModal.classList.add('hidden');
  pendingConfirmationOptions = {};
}

async function saveApiKey() {
  debug('saveApiKey');
  const key = elements.apiKeyInput.value.trim();
  if (!key) {
    elements.apiKeyStatus.textContent = 'Please enter an API key.';
    elements.apiKeyStatus.className = 'status-msg error';
    return;
  }

  await window.AppStorage.saveApiKey(key);
  elements.apiKeyStatus.textContent = 'API key saved successfully!';
  elements.apiKeyStatus.className = 'status-msg success';
  showToast('API key saved.', 'success');
  
  setTimeout(() => refreshFormsList(), 500);
}

async function clearApiKey() {
  await window.AppStorage.removeApiKey();
  elements.apiKeyInput.value = '';
  elements.apiKeyStatus.textContent = 'API key removed.';
  elements.apiKeyStatus.className = 'status-msg';
  showToast('API key cleared.', 'info');
  elements.formsSection.style.display = 'none';
}

async function saveSettings() {
  const settings = {
    model: elements.modelSelect.value,
    fillSpeed: elements.fillSpeed.value,
    autoFillConfirm: elements.autoFillConfirm.checked,
    aiPreview: elements.aiPreview.checked,
    tone: elements.toneSelect.value
  };

  await window.AppStorage.saveSettings(settings);
  cachedSettings = settings;
  elements.settingsStatus.textContent = 'Settings saved.';
  elements.settingsStatus.className = 'status-msg success';
  showToast('Settings saved.', 'success');

  setTimeout(() => {
    elements.settingsStatus.textContent = '';
    elements.settingsStatus.className = 'status-msg';
  }, 3000);
}

elements.saveApiKey.addEventListener('click', saveApiKey);
elements.clearApiKey.addEventListener('click', clearApiKey);
elements.fillForm.addEventListener('click', fillCurrentForm);
elements.saveSettings.addEventListener('click', saveSettings);
elements.confirmFill.addEventListener('click', handleConfirmFill);
elements.cancelFill.addEventListener('click', handleCancelFill);
elements.closeModal.addEventListener('click', handleCancelFill);
elements.confirmAiFill.addEventListener('click', handleConfirmAiFill);
elements.cancelAiPreview.addEventListener('click', () => elements.aiPreviewModal.classList.add('hidden'));
elements.closeAiPreview.addEventListener('click', () => elements.aiPreviewModal.classList.add('hidden'));

elements.apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveApiKey();
});

elements.savePromptBtn.addEventListener('click', saveCurrentPrompt);


elements.saveSmartMemory.addEventListener('click', saveSmartMemory);

elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
});
elements.clearUploadBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  clearUpload();
});
elements.fillFromUploadBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fillFromUploadedDocument();
});
elements.ocrContext.addEventListener('input', scheduleDocumentContextSave);

elements.stopFillBtn.addEventListener('click', async () => {
  try {
    const tab = await getFillTargetTab();
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { action: 'stopFill' });
    }
  } catch (e) {}
  hideLoading();
  showToast('Fill cancelled.', 'info');
});

function hideApiKeyHelp() {
  elements.apiKeyHelpPopover?.classList.add('hidden');
}

function toggleApiKeyHelp() {
  elements.apiKeyHelpPopover?.classList.toggle('hidden');
}

elements.apiKeyHelpBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleApiKeyHelp();
});

elements.apiKeyHelpPopover?.addEventListener('click', (e) => {
  e.stopPropagation();
});

document.addEventListener('click', hideApiKeyHelp);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideApiKeyHelp();
});

document.addEventListener('DOMContentLoaded', async () => {
  debug('Popup DOMContentLoaded');

  document.querySelectorAll('.collapsible').forEach(el => {
    el.classList.add('collapsed');
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const status = await chrome.tabs.sendMessage(tab.id, { action: 'checkStatus' });
      if (status?.isFilling) {
        showLoading('Filling form...');
      }
    } catch (e) {}
  }

  await loadApiKey();
  await loadSettings();
  await loadPromptTemplates();
  await loadSmartMemory();
  await loadDocumentContext();
  await refreshFormsList();
});

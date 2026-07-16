chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'fill-form-ai',
      title: 'Fill this Form with AI',
      contexts: ['page', 'editable'],
      documentUrlPatterns: ['<all_urls>']
    });
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.sidePanel.setOptions({ path: 'popup/popup.html' });

function reportDebug(level, message, data) {
  chrome.runtime.sendMessage({
    source: 'ai-form-filler',
    type: 'debug',
    level,
    message,
    data
  }, () => {
    void chrome.runtime.lastError;
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'fill-form-ai') {
    fillCurrentForm(tab);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'fill-form') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        fillCurrentForm(tabs[0]);
      }
    });
  }
});

function fillCurrentForm(tab) {
  if (!tab || !tab.id) return;

  chrome.tabs.sendMessage(tab.id, { action: 'checkStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      injectAndRetry(tab);
      return;
    }

    if (response && response.isFilling) {
      reportDebug('info', 'Form filler is already running');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: 'fillForms' }, () => {
      void chrome.runtime.lastError;
    });
  });
}

async function injectAndRetry(tab) {
  try {
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

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'fillForms' });
        return;
      } catch (e) {}
    }
    reportDebug('error', 'Failed to reach content script after injection');
  } catch (err) {
    reportDebug('error', 'Failed to inject content scripts', err.message);
  }
}

const AppStorage = {
  async get(keys) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, resolve);
    });
  },

  async set(data) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(data, resolve);
    });
  },

  async remove(keys) {
    return new Promise((resolve) => {
      chrome.storage.sync.remove(keys, resolve);
    });
  },

  async getLocal(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  },

  async setLocal(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  },

  async removeLocal(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  },

  async clear() {
    return new Promise((resolve) => {
      chrome.storage.sync.clear(resolve);
    });
  },

  async getApiKey() {
    const { apiKey } = await this.get('apiKey');
    return apiKey || '';
  },

  async saveApiKey(key) {
    await this.set({ apiKey: key });
  },

  async removeApiKey() {
    await this.remove('apiKey');
  },

  async getSettings() {
    const defaults = {
      model: 'gemma-4-31b-it',
      fillSpeed: 'instant',
      autoFillConfirm: true,
      aiPreview: false,
      tone: 'professional'
    };
    const { settings } = await this.get('settings');
    const merged = { ...defaults, ...(settings || {}) };
    const supportedModels = [
      'auto',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemma-4-26b-a4b-it',
      'gemma-4-31b-it'
    ];
    if (!supportedModels.includes(merged.model)) {
      merged.model = defaults.model;
    }
    return merged;
  },

  async saveSettings(settings) {
    await this.set({ settings });
  },

  async getSmartMemory() {
    const { smartMemory } = await this.get('smartMemory');
    return smartMemory || {
      company: '',
      phone: '',
      gst: '',
      pan: '',
      email: '',
      address: ''
    };
  },

  async saveSmartMemory(data, origin = '') {
    await this.set({ smartMemory: data, smartMemoryMeta: { origin: origin || '', savedAt: Date.now() } });
  },

  async getSmartMemoryMeta() {
    const { smartMemoryMeta } = await this.get('smartMemoryMeta');
    return smartMemoryMeta || { origin: '', savedAt: 0 };
  },

  async getPromptTemplates() {
    const { promptTemplates } = await this.get('promptTemplates');
    return promptTemplates || [];
  },

  async savePromptTemplate(template) {
    const templates = await this.getPromptTemplates();
    templates.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: template.name,
      prompt: template.prompt,
      createdAt: Date.now()
    });
    await this.set({ promptTemplates: templates });
    return templates;
  },

  async deletePromptTemplate(id) {
    let templates = await this.getPromptTemplates();
    templates = templates.filter(t => t.id !== id);
    await this.set({ promptTemplates: templates });
    return templates;
  },

  async getDocumentContext() {
    const { documentContext } = await this.getLocal('documentContext');
    return documentContext || '';
  },

  async saveDocumentContext(text) {
    await this.setLocal({ documentContext: text || '' });
  },

  async removeDocumentContext() {
    await this.removeLocal('documentContext');
  }
};

if (typeof window !== 'undefined') {
  window.AppStorage = AppStorage;
}

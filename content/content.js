(function () {
  let isFilling = false;
  let fillAborted = false;
  let initialized = false;
  let previewData = null;

  function reportProgress(message) {
    try {
      chrome.runtime.sendMessage({
        source: 'ai-form-filler',
        type: 'progress',
        message
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  function reportDebug(level, message, data) {
    try {
      chrome.runtime.sendMessage({
        source: 'ai-form-filler',
        type: 'debug',
        level,
        message,
        data
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  async function initialize() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'getForms':
          handleGetForms(sendResponse);
          break;
        case 'fillForms':
          handleFillForms(sendResponse, message);
          break;
        case 'fillSpecificForm':
          handleFillSpecificForm(message.formIndex, sendResponse, message);
          break;
        case 'checkStatus':
          sendResponse({ isFilling, initialized: true });
          break;
        case 'stopFill':
          fillAborted = true;
          isFilling = false;
          if (typeof window !== 'undefined') {
            window.__fillAborted = true;
            if (window.__fillController) {
              window.__fillController.abort();
              window.__fillController = null;
            }
          }
          sendResponse({ success: true });
          break;
        case 'applyPreviewValues':
          handleApplyPreviewValues(message.formsData, sendResponse);
          break;
      }
      return true;
    });

    try {
      await window.AppStorage.getSettings();
      initialized = true;
    } catch (e) {
      reportDebug('error', 'Content script initialization error', e.message);
      initialized = true;
    }
  }

  function handleGetForms(sendResponse) {
    try {
      reportProgress('Detecting forms on this page');
      if (typeof window.FormParser === 'undefined') {
        throw new Error('FormParser not loaded');
      }
      const forms = window.FormParser.getVisibleForms();
      reportProgress(`Detected ${forms.length} form(s)`);
      sendResponse({ success: true, forms });
    } catch (error) {
      reportDebug('error', 'Form detection error', error.message);
      sendResponse({ success: false, error: error.message });
    }
  }

  function checkAborted() {
    if (fillAborted) throw new Error('Fill cancelled by user.');
  }

  async function handleFillForms(sendResponse, message) {
    if (isFilling) {
      sendResponse({ success: false, error: 'Already filling a form. Please wait.' });
      return;
    }

    fillAborted = false;
    isFilling = true;
    window.__fillAborted = false;
    try {
      checkAborted();
      reportProgress('Reading extension settings');
      const settings = window.AppStorage ? await window.AppStorage.getSettings() : {};
      const customPrompt = message?.customPrompt || '';
      const ocrContext = message?.ocrContext || '';
      const documentOnly = Boolean(message?.documentOnly);
      if (documentOnly && !ocrContext.trim()) {
        throw new Error('Upload a document before using document fill.');
      }
      const fillSettings = documentOnly
        ? { ...settings, documentOnlyContext: true, autoFillConfirm: false, aiPreview: false }
        : { ...settings, autoFillConfirm: message?.autoFillConfirm ?? settings.autoFillConfirm };
      const aiPreview = message?.aiPreview ?? fillSettings.aiPreview;
      reportProgress('Scanning page for fillable forms');
      const forms = window.FormParser.getVisibleForms();
      const formsToFill = message?.primaryOnly
        ? forms.filter(form => form.element)
        : forms;
      const targetForms = formsToFill.length > 0 ? formsToFill : forms;

      if (targetForms.length === 0) {
        throw new Error('No fillable forms detected on this page.');
      }

      if (fillSettings.autoFillConfirm) {
        sendResponse({ success: true, forms: targetForms, needsConfirmation: true, ocrContext });
        isFilling = false;
        return;
      }

      if (aiPreview) {
        const previewForms = [];
        for (const form of targetForms) {
          checkAborted();
          reportProgress(`Generating values for ${form.title || 'form'}`);
          const { fields, values } = await window.FormFiller.generateValues(form, fillSettings, customPrompt, [], ocrContext);
          previewForms.push({ form: form.title, formIndex: forms.indexOf(form), fields, values });
        }
        previewData = { forms: previewForms, settings: fillSettings };
        sendResponse({ success: true, needsPreview: true, formsData: previewForms });
        isFilling = false;
        return;
      }

      const results = [];
      for (const form of targetForms) {
        reportProgress(`Starting ${form.title || 'form'}`);
        const values = await window.FormFiller.fillForm(form, fillSettings, customPrompt, [], ocrContext);
        results.push({ form: form.title, values });
      }

      sendResponse({ success: true, results, forms: targetForms });
    } catch (error) {
      reportDebug('error', 'Fill error', error.message);
      sendResponse({ success: false, error: error.message });
    } finally {
      isFilling = false;
    }
  }

  async function handleFillSpecificForm(formIndex, sendResponse, message = {}) {
    if (isFilling) {
      sendResponse({ success: false, error: 'Already filling a form. Please wait.' });
      return;
    }

    fillAborted = false;
    isFilling = true;
    window.__fillAborted = false;
    try {
      checkAborted();
      reportProgress('Reading extension settings');
      const settings = window.AppStorage ? await window.AppStorage.getSettings() : {};
      const customPrompt = message.customPrompt || '';
      const ocrContext = message.ocrContext || '';
      const excludedFields = message.excludedFields || [];
      const documentOnly = Boolean(message.documentOnly);
      if (documentOnly && !ocrContext.trim()) {
        throw new Error('Upload a document before using document fill.');
      }
      const fillSettings = documentOnly
        ? { ...settings, documentOnlyContext: true, aiPreview: false }
        : settings;
      const aiPreview = message.aiPreview ?? fillSettings.aiPreview;
      reportProgress('Scanning page for fillable forms');
      const forms = window.FormParser.getVisibleForms();
      const form = forms[formIndex];

      if (!form) {
        throw new Error('Form not found at index ' + formIndex);
      }

      if (aiPreview) {
        reportProgress(`Generating values for ${form.title || 'form'}`);
        const { fields, values } = await window.FormFiller.generateValues(form, fillSettings, customPrompt, excludedFields, ocrContext);
        const formData = { form: form.title, formIndex, fields, values };
        if (!previewData) {
          previewData = { forms: [formData], settings: fillSettings };
        } else {
          previewData.forms.push(formData);
        }
        sendResponse({ success: true, needsPreview: true, formsData: [formData] });
        isFilling = false;
        return;
      }

      reportProgress(`Starting ${form.title || 'form'} (${form.fields.length} fields)`);
      const values = await window.FormFiller.fillForm(form, fillSettings, customPrompt, excludedFields, ocrContext);
      sendResponse({ success: true, result: { form: form.title, values } });
    } catch (error) {
      reportDebug('error', 'Fill specific error', error.message);
      sendResponse({ success: false, error: error.message });
    } finally {
      isFilling = false;
    }
  }

  async function handleApplyPreviewValues(formsData, sendResponse) {
    if (isFilling) {
      sendResponse({ success: false, error: 'Already filling.' });
      return;
    }
    isFilling = true;
    try {
      const forms = window.FormParser.getVisibleForms();
      const results = [];
      for (const fd of formsData) {
        if (window.__fillAborted) throw new Error('Fill cancelled by user.');
        const form = forms[fd.formIndex];
        if (!form) continue;
        const stored = previewData?.forms?.find(p => p.formIndex === fd.formIndex);
        if (!stored) continue;
        reportProgress(`Filling ${fd.form || 'form'}`);
        const values = await window.FormFiller.applyGeneratedValues(stored.fields, fd.values, previewData?.settings || {});
        results.push({ form: fd.form, values });
      }
      sendResponse({ success: true, results });
    } catch (error) {
      reportDebug('error', 'Apply preview error', error.message);
      sendResponse({ success: false, error: error.message });
    } finally {
      isFilling = false;
      previewData = null;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();

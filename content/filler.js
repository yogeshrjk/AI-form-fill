const FormFiller = {
  async fillForm(form, settings = {}, customPrompt = '', excludedFields = [], ocrContext = '') {
    const fillSpeed = settings.fillSpeed || 'instant';
    const isHumanLike = fillSpeed === 'human';
    const typeDelay = isHumanLike ? 45 : 0;
    const fieldDelay = isHumanLike ? 120 : 0;

    if (settings.documentOnlyContext && ocrContext && window.GeminiService?.getDocumentLineItems) {
      await this.ensureDocumentLineItemRows(ocrContext);
    }

    let fields = this.getFillableFields(form.fields, excludedFields, { skipExistingValues: true });
    if (fields.length === 0) {
      this.reportProgress(`Skipping ${form.title || 'form'}; all fields already have values.`);
      return {};
    }

    const memoryContext = (form && form.id === 'standalone-fields') ? '' : await this.getMemoryContext();
    const filledSignatures = new Set();

    const attemptedSignatures = new Set();
    const allValues = {};
    const maxPasses = settings.fillDynamicFields === false ? 1 : 3;

    for (let pass = 0; pass < maxPasses && fields.length > 0; pass++) {
      this.assignUniqueKeys(fields);
      this.annotateLineItemIndexes(fields);
      this.highlightFields(fields, 'generating');

      for (const field of fields) {
        attemptedSignatures.add(this.getFieldSignature(field));
      }

      const values = await this.generateFieldValues(
        form.title || (pass === 0 ? 'Fill this form' : 'Fill newly added fields'),
        fields,
        settings,
        customPrompt,
        ocrContext,
        memoryContext
      );

      const filteredValues = this.filterAlreadyFilledValues(values, fields, filledSignatures);
      Object.assign(allValues, filteredValues);
      await this.applyValues(filteredValues, fields, typeDelay, fieldDelay);
      this.unhighlightFields(fields, 'generating');

      for (const field of fields) {
        filledSignatures.add(this.getFieldSignature(field));
      }

      if (pass >= maxPasses - 1) break;

      await this.waitForDynamicFields();
      fields = this.getNewlyAddedFields(excludedFields, attemptedSignatures, form);
      if (fields.length > 0) {
        this.reportProgress(`Detected ${fields.length} newly added field(s)`);
      }
    }

    if (!allValues || Object.keys(allValues).length === 0) {
      throw new Error('No values to fill for this form.');
    }

    return allValues;
  },

  async generateValues(form, settings = {}, customPrompt = '', excludedFields = [], ocrContext = '') {
    let fields = this.getFillableFields(form.fields, excludedFields, { skipExistingValues: true });
    if (fields.length === 0) {
      return { fields: [], values: {} };
    }
    this.assignUniqueKeys(fields);
    this.annotateLineItemIndexes(fields);
    this.highlightFields(fields, 'generating');
    const memoryContext = (form && form.id === 'standalone-fields') ? '' : await this.getMemoryContext();

    let generatedValues = {};
    if (fields.length > 0) {
      this.reportProgress(`Generating values for ${form.title || 'form'} (${fields.length} fields)`);
      this.checkAborted();
      generatedValues = await window.GeminiService.generate(
        form.title || 'Fill this form', fields, { ...settings, memoryContext }, customPrompt, ocrContext, memoryContext
      );
      generatedValues = this.normalizeRepeatedFamilyValues(fields, generatedValues);
      this.unhighlightFields(fields, 'generating');
      this.checkAborted();
    }

    return { fields, values: generatedValues };
  },

  async generateFieldValues(prompt, fields, settings = {}, customPrompt = '', ocrContext = '', memoryContext) {
    const context = (typeof memoryContext !== 'undefined') ? memoryContext : await this.getMemoryContext();
    this.highlightFields(fields, 'generating');

    let generatedValues = {};
    if (fields.length > 0) {
      this.reportProgress(`Generating values for ${prompt} (${fields.length} fields)`);
      this.checkAborted();
      generatedValues = await window.GeminiService.generate(
        prompt,
        fields,
        { ...settings, memoryContext: context },
        customPrompt,
        ocrContext,
        context
      );
      generatedValues = this.normalizeRepeatedFamilyValues(fields, generatedValues);
      this.unhighlightFields(fields, 'generating');
      this.checkAborted();
    }

    return generatedValues;
  },

  async getMemoryContext() {
    if (!window.AppStorage) return '';
    const memory = await window.AppStorage.getSmartMemory();
    const meta = await window.AppStorage.getSmartMemoryMeta();

    try {
      const currentOrigin = (new URL(window.location.href)).origin;
      if (meta && meta.origin && meta.origin !== currentOrigin) {
        // Do not apply saved smart memory across different origins/pages
        return '';
      }
    } catch (e) {
      // If URL parsing fails, fall back to using memory
    }
    const entries = [
      ['company', 'Company'],
      ['phone', 'Phone'],
      ['gst', 'GST'],
      ['pan', 'PAN'],
      ['email', 'Email'],
      ['address', 'Address']
    ]
      .map(([key, label]) => {
        const value = (memory[key] || '').trim();
        return value ? `${label}: ${value}` : '';
      })
      .filter(Boolean);

    return entries.join('\n');
  },

  highlightFields(fields, mode = 'editing') {
    for (const field of fields || []) {
      const element = this.findElement(field);
      if (!element) continue;
      this.setHighlightMode(element, mode);
    }
  },

  unhighlightFields(fields, mode = 'editing') {
    for (const field of fields || []) {
      const element = this.findElement(field);
      if (!element) continue;
      this.clearHighlightMode(element, mode);
    }
  },

  setHighlightMode(element, mode) {
    element.dataset.affHighlightMode = mode;
    element.style.transition = 'box-shadow 0.2s ease, outline 0.2s ease';
    element.style.outlineOffset = '2px';
    if (mode === 'generating') {
      element.classList.remove('field-highlight-editing');
      element.classList.add('field-highlight-generating');
      element.style.setProperty('outline', '2px solid #f59e0b', 'important');
      element.style.setProperty('box-shadow', '0 0 0 3px rgba(245, 158, 11, 0.28)', 'important');
      return;
    }

    element.classList.remove('field-highlight-generating');
    element.classList.add('field-highlight-editing');
    element.style.setProperty('outline', '2px solid #7c5cfc', 'important');
    element.style.setProperty('box-shadow', '0 0 0 3px rgba(124, 92, 252, 0.3)', 'important');
  },

  clearHighlightMode(element, mode) {
    if (element.dataset.affHighlightMode && element.dataset.affHighlightMode !== mode) return;
    delete element.dataset.affHighlightMode;
    element.classList.remove('field-highlight-editing');
    element.classList.remove('field-highlight-generating');
    element.style.transition = '';
    element.style.removeProperty('outline');
    element.style.removeProperty('outline-offset');
    element.style.removeProperty('box-shadow');
  },

  normalizeRepeatedFamilyValues(fields, values) {
    const normalized = { ...values };
    const fieldsByFamily = new Map();

    for (const field of fields) {
      if (!field.repeatedGroupFamilyId) continue;
      const family = fieldsByFamily.get(field.repeatedGroupFamilyId) || [];
      family.push(field);
      fieldsByFamily.set(field.repeatedGroupFamilyId, family);
    }

    for (const familyFields of fieldsByFamily.values()) {
      const rowsByIndex = new Map();
      for (const field of familyFields) {
        const rowIndex = Number.isInteger(field.repeatedGroupIndex) ? field.repeatedGroupIndex : 0;
        const row = rowsByIndex.get(rowIndex) || [];
        row.push(field);
        rowsByIndex.set(rowIndex, row);
      }

      const orderedRows = Array.from(rowsByIndex.entries()).sort((a, b) => a[0] - b[0]);
      const seenRowSignatures = new Set();

      orderedRows.forEach(([rowIndex, rowFields], rowPosition) => {
        const rowSignature = rowFields.map(field => {
          const key = field.uniqueKey || field.name || field.id;
          return String(normalized[key] ?? '').trim();
        }).join('|').toLowerCase();

        const duplicateRow = seenRowSignatures.has(rowSignature);
        seenRowSignatures.add(rowSignature);

        rowFields.forEach((field, fieldIndex) => {
          const key = field.uniqueKey || field.name || field.id;
          if (!key || normalized[key] === undefined || normalized[key] === null || normalized[key] === '') return;

          if (!duplicateRow && rowPosition === 0) return;

          const currentValue = normalized[key];
          const distinctValue = this.makeRepeatedValueDistinct(currentValue, field, rowIndex, fieldIndex, rowPosition);
          if (distinctValue !== null && distinctValue !== undefined && distinctValue !== '') {
            normalized[key] = distinctValue;
          }
        });
      });
    }

    return normalized;
  },

  filterAlreadyFilledValues(values, fields, filledSignatures) {
    const filtered = {};
    for (const [key, value] of Object.entries(values || {})) {
      const field = fields.find(f => f.uniqueKey === key || f.name === key || f.id === key || f.label === key);
      if (!field) continue;

      const signature = this.getFieldSignature(field);
      if (filledSignatures.has(signature) && !field.repeatedGroupFamilyId) continue;

      filtered[key] = value;
    }
    return filtered;
  },

  makeRepeatedValueDistinct(value, field, rowIndex, fieldIndex, rowPosition) {
    const type = String(field.type || '').toLowerCase();
    const raw = Array.isArray(value) ? value[0] : value;

    if (typeof raw === 'boolean') return raw;

    if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'week' || type === 'time') {
      const rawText = String(raw || '').trim();
      if (!rawText || /^""$/.test(rawText) || /^''$/.test(rawText)) return '';
      const isoMatch = rawText.match(/^(\d{4}-\d{2}-\d{2})/);
      if (isoMatch) return isoMatch[1];
      const normalized = window.GeminiService?.normalizeDateValue ? window.GeminiService.normalizeDateValue(rawText) : '';
      return normalized || rawText;
    }

    if (type === 'number' || type === 'range') {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        const offset = rowIndex + 1 + fieldIndex;
        const adjusted = numeric + offset;
        return String(Number.isInteger(numeric) && Number.isInteger(adjusted) ? adjusted : Number(adjusted.toFixed(2)));
      }
      const extracted = String(raw).match(/-?\d+(?:\.\d+)?/);
      if (extracted) {
        const numericValue = Number(extracted[0]);
        const adjusted = numericValue + rowIndex + 1;
        return String(Number.isInteger(numericValue) ? adjusted : Number(adjusted.toFixed(2)));
      }
      return `${String(raw).trim()} ${rowPosition + 1}`.trim();
    }

    if (type === 'select') {
      return raw;
    }

    const text = String(raw).trim();
    if (!text) return raw;
    if (/(row\s*\d+|item\s*\d+|line\s*\d+)/i.test(text)) return text;

    const suffix = rowPosition + 1;
    return `${text} ${suffix}`;
  },

  getFillableFields(fields, excludedFields = [], options = {}) {
    let fillable = fields.filter(f => f.name || f.id);
    if (excludedFields.length > 0) {
      fillable = fillable.filter(f => {
        const key = f.name || f.id;
        const uniqueKey = f.uniqueKey || key;
        const signature = this.getFieldSignature(f);
        return !excludedFields.includes(key)
          && !excludedFields.includes(uniqueKey)
          && !excludedFields.includes(signature);
      });
    }
    if (options.skipExistingValues) {
      fillable = fillable.filter(field => !this.fieldHasExistingValue(field));
    }
    return fillable;
  },

  getNewlyAddedFields(excludedFields = [], attemptedSignatures = new Set(), form = null) {
    if (!window.FormParser) return [];

    const fields = form?.element
      ? window.FormParser.parseForm(form.element, 0).fields || []
      : window.FormParser.findStandaloneInputs();

    return this.getFillableFields(fields, excludedFields, { skipExistingValues: true })
      .filter(field => !attemptedSignatures.has(this.getFieldSignature(field)))
      .filter(field => this.findElement(field));
  },

  fieldHasExistingValue(field) {
    const element = this.findElement(field);
    if (!element) {
      return this.fieldValueIsPresent(field.value);
    }

    const tagName = element.tagName.toLowerCase();
    const type = (element.type || '').toLowerCase();

    if (type === 'checkbox' || type === 'radio') {
      return element.checked === true;
    }

    if (tagName === 'select') {
      const selected = element.options?.[element.selectedIndex];
      if (!selected) return false;
      const value = String(element.value || '').trim();
      const text = String(selected.text || '').trim().toLowerCase();
      if (!value) return false;
      return !/^(select|choose|pick|--|please select)/i.test(text);
    }

    if (type === 'number' || type === 'range') {
      const value = String(element.value ?? '').trim();
      return value !== '';
    }

    return this.fieldValueIsPresent(element.value);
  },

  fieldValueIsPresent(value) {
    if (value === null || value === undefined) return false;
    const text = String(value).trim();
    return text !== '' && text !== '0' && text !== '0.00';
  },

  annotateLineItemIndexes(fields) {
    if (!window.FormParser || !window.GeminiService?.getLineItemColumnForField) return;

    const countsByColumn = {};
    const indexBySignature = new Map();
    const allFields = window.FormParser.getVisibleForms()
      .flatMap(form => form.fields || []);

    for (const field of allFields) {
      const column = window.GeminiService.getLineItemColumnForField(this.getFieldHint(field));
      if (!column) continue;

      const index = countsByColumn[column] || 0;
      countsByColumn[column] = index + 1;
      indexBySignature.set(this.getFieldSignature(field), index);
    }

    for (const field of fields) {
      const index = indexBySignature.get(this.getFieldSignature(field));
      if (index !== undefined) {
        field.documentLineItemIndex = index;
      }
    }
  },

  async ensureDocumentLineItemRows(ocrContext) {
    const rows = window.GeminiService.getDocumentLineItems(ocrContext);
    if (!rows || rows.length === 0) return;

    let visibleLineItemCount = this.countVisibleLineItemRows();
    const missing = rows.length - visibleLineItemCount;
    if (missing <= 0) return;

    const addButton = this.findAddLineItemButton();
    if (!addButton) {
      this.reportProgress(`Document has ${rows.length} line items; only ${visibleLineItemCount} row(s) are visible.`);
      return;
    }

    for (let i = 0; i < missing; i++) {
      this.checkAborted();
      this.reportProgress(`Adding line item row ${visibleLineItemCount + i + 1}`);
      addButton.click();
      await this.waitForDynamicFields();
    }
  },

  countVisibleLineItemRows() {
    if (!window.FormParser) return 0;

    const descriptionFields = window.FormParser.getVisibleForms()
      .flatMap(form => form.fields || [])
      .filter(field => {
        const hint = this.getFieldHint(field);
        return /\b(description|item|product|material|goods|service|particular|particulars)\b/.test(hint);
      });

    return descriptionFields.length;
  },

  findAddLineItemButton() {
    const controls = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"]'));
    return controls.find(control => {
      if (window.DOMUtils?.isHidden(control) || window.DOMUtils?.isDisabled(control)) return false;

      const text = [
        control.textContent,
        control.value,
        control.getAttribute('aria-label'),
        control.getAttribute('title')
      ].filter(Boolean).join(' ').trim().toLowerCase();

      if (!text) return false;
      if (/submit|create|save|cancel|delete|remove|clear|back/.test(text)) return false;
      return /\b(add|new)\b/.test(text) && /\b(item|line|row|detail|product|material)\b/.test(text);
    }) || null;
  },

  getFieldSignature(field) {
    return [
      field.id,
      field.name,
      field.label,
      field.placeholder,
      field.type,
      field.xpath,
      field.cssSelector
    ].filter(Boolean).join('|').toLowerCase();
  },

  getFieldHint(field) {
    return [
      field.label,
      field.name,
      field.id,
      field.placeholder,
      field.uniqueKey,
      field.ariaLabel
    ].filter(Boolean).join(' ').toLowerCase();
  },

  waitForDynamicFields() {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve();
      };

      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(finish, 200);
      });
      let timer = setTimeout(finish, 500);

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'disabled']
      });
    });
  },

  async applyGeneratedValues(fields, values, settings = {}) {
    const fillSpeed = settings.fillSpeed || 'instant';
    const isHumanLike = fillSpeed === 'human';
    const typeDelay = isHumanLike ? 45 : 0;
    const fieldDelay = isHumanLike ? 120 : 0;
    await this.applyValues(values, fields, typeDelay, fieldDelay);
    return values;
  },

  assignUniqueKeys(fields) {
    const seen = new Map();
    for (const field of fields) {
      let baseKey = field.uniqueKey || field.name || field.id || field.label || 'field';

      // If the field is part of a repeated family/group, include a short family suffix
      // so keys are unique per row. Normalize to alphanumerics to keep keys safe.
      if (field.repeatedGroupFamilyId) {
        try {
          const fam = String(field.repeatedGroupFamilyId).replace(/[^a-zA-Z0-9]/g, '_').slice(0, 12);
          const idx = Number.isInteger(field.repeatedGroupIndex) ? field.repeatedGroupIndex : 0;
          baseKey = `${baseKey}__fam_${fam}_${idx}`;
        } catch (e) {
          // ignore and fall back to baseKey
        }
      }

      const count = seen.get(baseKey) || 0;
      seen.set(baseKey, count + 1);
      field.uniqueKey = count === 0 ? baseKey : `${baseKey}_${count}`;
    }
  },

  checkAborted() {
    if (typeof window !== 'undefined' && window.__fillAborted) {
      throw new Error('Fill cancelled by user.');
    }
  },

  async applyValues(values, fields, typeDelay, fieldDelay) {
    try {
      this.reportDebug('info', 'applyValues keys', Object.keys(values));
    } catch (e) {}

    for (const [key, value] of Object.entries(values)) {
      this.checkAborted();
      if (value === null || value === undefined || value === '') continue;

      const field = fields.find(f =>
        f.uniqueKey === key || f.name === key || f.id === key || f.label === key
      );

      if (!field) {
        this.reportDebug('warn', `No matching field found for key: ${key}`, null);
        continue;
      }

      const element = this.findElement(field);
      if (!element) continue;
      if (!element) {
        this.reportDebug('warn', `Element not found for field: ${field.uniqueKey || field.name || field.id}`, null);
        continue;
      }
      if (this.fieldHasExistingValue(field)) {
        this.reportDebug('info', `Skipping already-filled field: ${this.getFieldName(field)}`);
        this.reportProgress(`Skipping ${this.getFieldName(field)}; already has a value`);
        continue;
      }

      try {
        this.reportProgress(`Filling ${this.getFieldName(field)}`);
        this.highlightElement(element);
        await this.fillElement(element, field, value, typeDelay);
        await this.wait(120);
        this.unhighlightElement(element);
        if (fieldDelay > 0) {
          await this.wait(fieldDelay);
        }
      } catch (e) {
        this.unhighlightElement(element);
        if (typeof window !== 'undefined' && window.__fillAborted) {
          throw new Error('Fill cancelled by user.');
        }
        this.reportDebug('error', `Failed to fill field "${key}"`, e.message);
      }
    }
  },

  highlightElement(element) {
    this.setHighlightMode(element, 'editing');
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  unhighlightElement(element) {
    this.clearHighlightMode(element, 'editing');
  },

  findElement(field) {
    const repeatedElement = this.findRepeatedGroupElement(field);
    if (repeatedElement) {
      return repeatedElement;
    }

    if (field.xpath) {
      try {
        const result = document.evaluate(
          field.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        );
        if (result.singleNodeValue) return result.singleNodeValue;
      } catch (e) {}
    }

    if (field.cssSelector) {
      try {
        const el = document.querySelector(field.cssSelector);
        if (el) return el;
      } catch (e) {}
    }

    if (field.id) {
      const el = document.getElementById(field.id);
      if (el) return el;
    }

    if (field.name) {
      const el = document.querySelector(`[name="${CSS.escape(field.name)}"]`);
      if (el) return el;
    }

    return null;
  },

  findRepeatedGroupElement(field) {
    if (!field.repeatedGroupId) return null;

    const container = this.findElementByXPath(field.repeatedGroupId);
    if (!container) return null;

    const descendants = this.getFillableDescendants(container);
    if (descendants.length === 0) return null;

    const index = Number.isInteger(field.repeatedGroupFieldIndex) ? field.repeatedGroupFieldIndex : 0;
    const byIndex = descendants[index];
    if (byIndex) return byIndex;

    const hint = this.getFieldHint(field);
    return descendants.find(element => {
      const tagName = element.tagName.toLowerCase();
      const type = (element.type || '').toLowerCase();
      const elementHint = [
        element.getAttribute('placeholder'),
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.id,
        element.name,
        window.DOMUtils?.getLabelForElement(element),
        tagName,
        type
      ].filter(Boolean).join(' ').toLowerCase();

      return hint && elementHint && (elementHint.includes(hint) || hint.includes(elementHint));
    }) || null;
  },

  findElementByXPath(xpath) {
    if (!xpath) return null;

    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue || null;
    } catch (e) {
      return null;
    }
  },

  getFillableDescendants(container) {
    return Array.from(container.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'))
      .filter(el => !window.DOMUtils?.isHidden(el) && !window.DOMUtils?.isDisabled(el) && !window.DOMUtils?.isReadOnly(el));
  },

  async fillElement(element, field, value, typeDelay) {
    const tagName = element.tagName.toLowerCase();
    const type = (element.type || 'text').toLowerCase();

    if (tagName === 'textarea') {
      await window.EventUtils.fillFieldWithDelay(element, value, typeDelay);
      return;
    }

    if (tagName === 'select') {
      window.EventUtils.fillSelect(element, value);
      return;
    }

    if (this.shouldUseDropdownOptions(field, element)) {
      const option = this.findBestDropdownOption(field, value);
      if (option) {
        this.fillSelectableInput(element, option.value || option.text || '');
        return;
      }
    }

    switch (type) {
      case 'checkbox':
        window.EventUtils.fillCheckbox(element, value);
        break;

      case 'radio':
        if (field.groupName) {
          const group = document.querySelectorAll(
            `input[type="radio"][name="${CSS.escape(field.groupName)}"]`
          );
          window.EventUtils.fillRadio(group, value);
        } else {
          window.EventUtils.fillRadio([element], value);
        }
        break;

      case 'color':
        window.EventUtils.setNativeValue(element, value);
        break;

      case 'range':
        window.EventUtils.setNativeValue(element, Number(value));
        break;

      case 'date':
      case 'datetime-local':
      case 'month':
      case 'week':
      case 'time':
      case 'number':
        window.EventUtils.setNativeValue(element, value);
        break;

      default:
        await window.EventUtils.fillFieldWithDelay(element, value, typeDelay);
        break;
    }
  },

  shouldUseDropdownOptions(field, element) {
    const hasOptions = Array.isArray(field.options) && field.options.length > 0;
    if (!hasOptions) return false;

    const tagName = element.tagName.toLowerCase();
    const type = (element.type || 'text').toLowerCase();
    if (tagName === 'select' || type === 'radio' || type === 'checkbox') return false;

    return Boolean(field.listId || field.autocomplete || field.options.length > 0);
  },

  findBestDropdownOption(field, value) {
    const options = Array.isArray(field.options) ? field.options : [];
    if (options.length === 0) return null;

    const rawValue = String(Array.isArray(value) ? value[0] : value || '').trim();
    const normalizedValue = rawValue.toLowerCase();
    const nonPlaceholderOptions = options.filter(option => {
      const text = String(option.text || option.value || '').trim().toLowerCase();
      return text && !/^(select|choose|pick|--|please select|enter|type)/.test(text);
    });

    if (!rawValue) return nonPlaceholderOptions[0] || options[0] || null;

    const exactMatch = options.find(option => {
      const text = String(option.text || '').trim().toLowerCase();
      const optionValue = String(option.value || '').trim().toLowerCase();
      return text === normalizedValue || optionValue === normalizedValue;
    });
    if (exactMatch) return exactMatch;

    const containsMatch = options.find(option => {
      const text = String(option.text || option.value || '').trim().toLowerCase();
      return text && (text.includes(normalizedValue) || normalizedValue.includes(text));
    });
    if (containsMatch) return containsMatch;

    const hint = this.getFieldHint(field);
    const hintMatch = options.find(option => {
      const text = String(option.text || option.value || '').trim().toLowerCase();
      return text && (hint.includes(text) || text.includes(hint));
    });
    if (hintMatch) return hintMatch;

    return nonPlaceholderOptions[0] || options[0] || null;
  },

  fillSelectableInput(element, value) {
    const type = (element.type || 'text').toLowerCase();
    if (type === 'date' || type === 'datetime-local' || type === 'month' || type === 'week' || type === 'time' || type === 'number') {
      window.EventUtils.setNativeValue(element, value);
      return;
    }

    const stringValue = String(value ?? '').trim();
    window.EventUtils.setNativeValue(element, stringValue);
  },

  getFieldName(field) {
    return field.label || field.name || field.id || field.type || 'field';
  },

  wait(ms) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        try {
          this.checkAborted();
          if (Date.now() - start >= ms) {
            resolve();
          } else {
            setTimeout(poll, 50);
          }
        } catch (e) {
          reject(e);
        }
      };
      poll();
    });
  },

  reportProgress(message) {
    try {
      chrome.runtime.sendMessage({
        source: 'ai-form-filler',
        type: 'progress',
        message
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  },

  reportDebug(level, message, data) {
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
  },

};

if (typeof window !== 'undefined') {
  window.FormFiller = FormFiller;
}

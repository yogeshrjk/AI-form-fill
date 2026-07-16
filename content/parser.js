const FormParser = {
  detectForms() {
    const forms = [];
    const formElements = document.querySelectorAll('form');
    const standaloneInputs = this.findStandaloneInputs();

    if (formElements.length > 0) {
      formElements.forEach((form, index) => {
        const formData = this.parseForm(form, index);
        if (formData.fields.length > 0) {
          forms.push(formData);
        }
      });
    }

    if (standaloneInputs.length > 0) {
      forms.push({
        element: null,
        id: 'standalone-fields',
        title: 'Standalone Fields',
        fields: standaloneInputs,
        index: forms.length
      });
    }

    return forms;
  },

  findStandaloneInputs() {
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
    );

    const standalone = [];
    inputs.forEach(input => {
      if (!input.closest('form') && this.isVisible(input)) {
        const field = this.parseField(input);
        if (field) standalone.push(field);
      }
    });

    return standalone;
  },

  parseForm(form, index) {
    const fields = [];
    const elements = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select'
    );

    elements.forEach(el => {
      const field = this.parseField(el);
      if (field) fields.push(field);
    });

    this.annotateCheckboxGroups(fields);

    return {
      element: form,
      id: form.id || `form-${index}`,
      title: this.getFormTitle(form),
      action: form.action || '',
      method: (form.method || 'get').toUpperCase(),
      fields
    };
  },

  parseField(element) {
    if (!this.isVisible(element)) return null;
    if (window.DOMUtils.isSensitiveField(element)) return null;

    const tagName = element.tagName.toLowerCase();
    const type = (element.type || 'text').toLowerCase();

    if (type === 'file') return null;

    const field = {
      id: element.id || '',
      name: element.name || '',
      label: window.DOMUtils.getLabelForElement(element) || '',
      placeholder: element.placeholder || '',
      type: tagName === 'textarea' ? 'textarea' : type,
      required: element.required === true || element.hasAttribute('required'),
      autocomplete: element.autocomplete || '',
      ariaLabel: element.getAttribute('aria-label') || '',
      options: [],
      listId: element.getAttribute('list') || '',
      value: element.value || '',
      xpath: window.DOMUtils.getXPath(element),
      cssSelector: window.DOMUtils.getCssSelector(element),
      minLength: element.minLength || null,
      maxLength: element.maxLength || null,
      min: element.min || null,
      max: element.max || null,
      pattern: element.getAttribute('pattern') || ''
    };

    if (tagName === 'select') {
      field.options = Array.from(element.options).map(opt => ({
        value: opt.value,
        text: opt.text,
        selected: opt.selected
      }));
    }

    if (field.listId) {
      const datalist = document.getElementById(field.listId);
      if (datalist) {
        field.options = Array.from(datalist.querySelectorAll('option')).map(opt => ({
          value: opt.value || opt.textContent || '',
          text: opt.textContent || opt.value || '',
          selected: false
        })).filter(opt => opt.value || opt.text);
      }
    }

    if (type === 'radio' && element.name) {
      const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`);
      field.options = Array.from(group).map(r => ({
        value: r.value,
        text: window.DOMUtils.getLabelForElement(r) || r.value,
        selected: r.checked
      }));
      field.groupName = element.name;
    }

    if (type === 'checkbox') {
      field.checked = element.checked;
      field.optionValue = element.value || '';
      field.optionLabel = window.DOMUtils.getLabelForElement(element) || element.value || element.name || element.id || '';
      const checkboxGroup = this.getCheckboxGroupInfo(element);
      if (checkboxGroup) {
        field.checkboxGroupKey = checkboxGroup.key;
        field.checkboxGroupLabel = checkboxGroup.label;
        field.checkboxGroupIndex = checkboxGroup.index;
        field.checkboxGroupSize = checkboxGroup.size;
      }
    }

    const repeatedGroup = this.getRepeatedGroupInfo(element);
    if (repeatedGroup) {
      field.repeatedGroupId = repeatedGroup.id;
      field.repeatedGroupIndex = repeatedGroup.index;
      field.repeatedGroupSize = repeatedGroup.size;
      field.repeatedGroupLabel = repeatedGroup.label;
      field.repeatedGroupFieldIndex = repeatedGroup.fieldIndex;
      field.repeatedGroupFieldSize = repeatedGroup.fieldSize;
      field.repeatedGroupFamilyId = repeatedGroup.familyId;
      field.repeatedGroupFamilyLabel = repeatedGroup.familyLabel;
      field.repeatedGroupFamilySize = repeatedGroup.familySize;
    }

    if (!field.label && field.placeholder) {
      field.label = field.placeholder;
    }

    if (!field.label && field.name) {
      field.label = field.name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    if (!field.name && field.id) {
      field.name = field.id;
    }

    if (!field.name && !field.id) {
      field.name = field.label.toLowerCase().replace(/[^a-z0-9]/g, '_')
        || field.type
        || `field_${Math.random().toString(36).slice(2, 8)}`;
    }

    return field;
  },

  annotateCheckboxGroups(fields) {
    const groups = new Map();

    for (const field of fields) {
      if (field.type !== 'checkbox' || !field.checkboxGroupKey) continue;
      const group = groups.get(field.checkboxGroupKey) || [];
      group.push(field);
      groups.set(field.checkboxGroupKey, group);
    }

    for (const group of groups.values()) {
      const options = group.map(optionField => ({
        key: optionField.uniqueKey || optionField.name || optionField.id,
        value: optionField.optionValue || optionField.value || '',
        label: optionField.optionLabel || optionField.label || optionField.name || optionField.id || ''
      }));

      group.forEach((field, index) => {
        field.checkboxGroupIndex = index;
        field.checkboxGroupSize = group.length;
        field.checkboxGroupOptions = options;
      });
    }
  },

  getCheckboxGroupInfo(element) {
    const name = (element.name || '').trim();
    if (name) {
      return {
        key: `name:${name.toLowerCase()}`,
        label: window.DOMUtils.getLabelForElement(element) || name,
        index: 0,
        size: document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`).length || 1
      };
    }

    const container = this.findRepeatedContainer(element, 'checkbox');
    if (!container) return null;

    return {
      key: `container:${window.DOMUtils.getXPath(container)}`,
      label: this.getContainerLabel(container),
      index: this.getContainerIndex(container),
      size: this.getContainerGroupSize(container)
    };
  },

  getRepeatedGroupInfo(element) {
    const container = this.findRepeatedContainer(element, 'field');
    if (!container) return null;

    const fields = this.getFillableDescendants(container, 'field');
    const fieldIndex = fields.indexOf(element);
    const familyContainer = container.parentElement;

    return {
      id: window.DOMUtils.getXPath(container),
      index: this.getContainerIndex(container),
      size: this.getContainerGroupSize(container),
      label: this.getContainerLabel(container),
      fieldIndex: fieldIndex >= 0 ? fieldIndex : 0,
      fieldSize: fields.length,
      familyId: familyContainer ? window.DOMUtils.getXPath(familyContainer) : window.DOMUtils.getXPath(container),
      familyLabel: familyContainer ? this.getContainerLabel(familyContainer) : this.getContainerLabel(container),
      familySize: familyContainer ? this.getContainerGroupSize(familyContainer) : 1
    };
  },

  findRepeatedContainer(element, fieldType = 'field') {
    let current = element.parentElement;
    while (current && current !== document.body) {
      if (this.isRepeatedContainer(current, fieldType)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  },

  isRepeatedContainer(container, fieldType = 'field') {
    if (!container || container === document.body || container === document.documentElement) return false;

    const descendants = this.getFillableDescendants(container, fieldType);
    if (descendants.length === 0) return false;

    const parent = container.parentElement;
    if (!parent) return false;

    const siblings = Array.from(parent.children).filter(child => child !== container);
    const signature = this.getContainerSignature(container, fieldType);
    const similarSiblings = siblings.filter(sibling => this.getContainerSignature(sibling, fieldType) === signature && this.getFillableDescendants(sibling, fieldType).length > 0);

    if (similarSiblings.length > 0) return true;

    const className = (container.className || '').toString().toLowerCase();
    if (/(row|item|line|entry|record|repeat|array|table|group|dynamic|option)/.test(className) && descendants.length > 0) {
      return true;
    }

    return false;
  },

  getContainerSignature(container, fieldType = 'field') {
    const className = (container.className || '').toString().trim().toLowerCase().split(/\s+/).filter(Boolean).sort().join('.');
    const role = (container.getAttribute('role') || '').toLowerCase();
    const tagName = container.tagName.toLowerCase();
    const fieldCount = this.getFillableDescendants(container, fieldType).length;
    return [tagName, className, role, fieldCount].join('|');
  },

  getFillableDescendants(container, fieldType = 'field') {
    const selectors = fieldType === 'checkbox'
      ? 'input[type="checkbox"]'
      : 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select';
    return Array.from(container.querySelectorAll(selectors)).filter(el => this.isVisible(el) && !window.DOMUtils.isSensitiveField(el));
  },

  getContainerIndex(container) {
    const parent = container.parentElement;
    if (!parent) return 0;

    const signature = this.getContainerSignature(container);
    const similar = Array.from(parent.children).filter(child => this.getContainerSignature(child) === signature);
    const index = similar.indexOf(container);
    return index >= 0 ? index : 0;
  },

  getContainerGroupSize(container) {
    const parent = container.parentElement;
    if (!parent) return 1;

    const signature = this.getContainerSignature(container);
    const similar = Array.from(parent.children).filter(child => this.getContainerSignature(child) === signature);
    return similar.length || 1;
  },

  getContainerLabel(container) {
    const heading = container.querySelector('legend, caption, h1, h2, h3, h4, h5, h6');
    if (heading && heading.textContent.trim()) return heading.textContent.trim();

    const text = container.textContent.trim().replace(/\s+/g, ' ');
    return text.slice(0, 120);
  },

  getFormTitle(form) {
    const caption = form.querySelector('caption');
    if (caption) return caption.textContent.trim();

    const legend = form.querySelector('legend');
    if (legend) return legend.textContent.trim();

    const heading = form.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) return heading.textContent.trim();

    const ariaLabel = form.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const title = form.getAttribute('title');
    if (title) return title;

    const name = form.getAttribute('name');
    if (name) return name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    return 'Form';
  },

  isVisible(element) {
    return !window.DOMUtils.isHidden(element) &&
           !window.DOMUtils.isDisabled(element) &&
           !window.DOMUtils.isReadOnly(element);
  },

  getVisibleForms() {
    const allForms = this.detectForms();
    return allForms.filter(form => {
      return form.fields.length > 0;
    });
  }
};

if (typeof window !== 'undefined') {
  window.FormParser = FormParser;
}

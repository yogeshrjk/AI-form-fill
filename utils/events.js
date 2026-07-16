const EventUtils = {
  dispatchInputEvent(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
  },

  dispatchChangeEvent(element) {
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  },

  dispatchBlurEvent(element) {
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  },

  dispatchAllEvents(element) {
    this.dispatchInputEvent(element);
    this.dispatchChangeEvent(element);
    this.dispatchBlurEvent(element);
  },

  setNativeValueSilently(element, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;

    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(element, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else {
      element.value = value;
    }
  },

  setNativeValue(element, value) {
    this.setNativeValueSilently(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  },

  setNativeCheckbox(element, checked) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'checked'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, checked);
    } else {
      element.checked = checked;
    }

    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  },

  fillFieldWithDelay(element, value, delay = 0) {
    return new Promise((resolve) => {
      if (delay <= 0) {
        this.setNativeValue(element, value);
        resolve();
        return;
      }

      const strValue = String(value);
      let index = 0;
      this.setNativeValueSilently(element, '');
      element.focus();

      const typeInterval = setInterval(() => {
        if (index >= strValue.length) {
          clearInterval(typeInterval);
          this.dispatchChangeEvent(element);
          this.dispatchBlurEvent(element);
          resolve();
          return;
        }
        const currentValue = strValue.substring(0, index + 1);
        this.setNativeValueSilently(element, currentValue);
        this.dispatchInputEvent(element);
        index++;
      }, delay);
    });
  },

  fillSelect(element, value) {
    const found = Array.from(element.options).find(
      opt => opt.value === value || opt.text === value
    );
    if (found) {
      element.value = found.value;
    } else {
      element.value = value;
    }
    this.dispatchAllEvents(element);
  },

  fillCheckbox(element, checked) {
    this.setNativeCheckbox(element, checked === true || checked === 'true' || checked === 'yes');
  },

  fillRadio(group, value) {
    const target = String(Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
    const radio = Array.from(group).find(r => {
      const candidates = [
        r.value,
        r.getAttribute('aria-label'),
        r.getAttribute('title'),
        r.id,
        r.name,
        r.value && r.value.toLowerCase()
      ].filter(Boolean).map(item => String(item).trim().toLowerCase());

      const label = window.DOMUtils?.getLabelForElement(r) || '';
      const context = [label, r.closest('label')?.textContent, r.parentElement?.textContent].filter(Boolean).join(' ').trim().toLowerCase();

      return candidates.some(candidate => candidate === target || candidate.includes(target) || target.includes(candidate)) ||
        (context && (context === target || context.includes(target) || target.includes(context)));
    });
    if (radio) {
      this.setNativeCheckbox(radio, true);
    }
  }
};

if (typeof window !== 'undefined') {
  window.EventUtils = EventUtils;
}

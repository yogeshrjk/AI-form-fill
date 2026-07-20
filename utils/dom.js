var DOMUtils = {
  getXPath(element) {
    if (element === document.body) return '/html/body';
    if (element === document.documentElement) return '/html';

    let ix = 0;
    const siblings = element.parentNode ? element.parentNode.children : [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const tagName = element.tagName.toLowerCase();
        ix++;
        const parentPath = element.parentNode !== document.documentElement && element.parentNode !== document.body
          ? this.getXPath(element.parentNode)
          : `/html/${element.parentNode ? element.parentNode.tagName.toLowerCase() : ''}`;
        return `${parentPath}/${tagName}[${ix}]`;
      }
      if (sibling.tagName === element.tagName) ix++;
    }
    return '';
  },

  getCssSelector(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;

    const path = [];
    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        path.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c.length > 0);
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }
      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          s => s.tagName === current.tagName
        );
        if (sameTagSiblings.length > 1) {
          const index = sameTagSiblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(' > ');
  },

  getLabelForElement(element) {
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      if (label) return label.textContent.trim();
    }

    let parent = element.parentElement;
    let depth = 0;
    while (parent && depth < 5) {
      const label = parent.querySelector('label');
      if (label && label.textContent.trim()) {
        const text = label.textContent.trim();
        if (text.length < 200) return text;
      }
      depth++;
      parent = parent.parentElement;
    }

    const closestLabel = element.closest('label');
    if (closestLabel) {
      const text = closestLabel.textContent.trim();
      if (text.length < 200) return text;
    }

    parent = element.parentElement;
    depth = 0;
    while (parent && depth < 3) {
      const textNodes = [];
      const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (t && node.parentElement !== element) {
          textNodes.push(t);
        }
      }
      if (textNodes.length > 0) {
        const combined = textNodes.join(' ').substring(0, 200);
        if (combined) return combined;
      }
      depth++;
      parent = parent.parentElement;
    }

    const prev = element.previousElementSibling;
    if (prev) {
      const text = prev.textContent.trim();
      if (text && text.length < 200) return text;
    }

    const grandparent = element.parentElement ? element.parentElement.parentElement : null;
    if (grandparent) {
      const allText = grandparent.textContent.trim();
      const lines = allText.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length > 0) {
        const firstLine = lines[0];
        if (firstLine.length < 200) return firstLine;
      }
    }

    return '';
  },

  isHidden(element) {
    const type = element.getAttribute('type');
    if (type === 'hidden') return true;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return true;

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return true;

    return false;
  },

  isDisabled(element) {
    return element.disabled === true;
  },

  isReadOnly(element) {
    return element.hasAttribute('readonly') || element.readOnly === true;
  },

  isSensitiveField(element) {
    const type = element.type ? element.type.toLowerCase() : '';
    if (type === 'password') return true;

    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const autocomplete = (element.autocomplete || '').toLowerCase();
    const label = (DOMUtils.getLabelForElement(element) || '').toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();

    const combined = `${name} ${id} ${autocomplete} ${label} ${placeholder} ${ariaLabel}`;

    const sensitivePatterns = [
      'password', 'passwd', 'pwd', 'creditcard', 'credit_card', 'cc-number',
      'cc_num', 'ccnumber', 'card-number', 'cardnumber', 'card_num',
      'cvv', 'cvc', 'cvv2', 'cc-cvv', 'security-code', 'securitycode',
      'pin', 'otp', 'one-time', 'totp', '2fa', 'two-factor',
      'captcha', 'recaptcha', 'g-recaptcha'
    ];

    return sensitivePatterns.some(p => combined.includes(p));
  }
};

if (typeof window !== 'undefined') {
  window.DOMUtils = DOMUtils;
}

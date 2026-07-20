var MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it'
];

var OCR_MODELS = [
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it'
];

var RATE_LIMIT_BACKOFF_MS = 60 * 1000;

var GeminiService = {
  MODELS,
  rateLimitedUntil: {},

  TONES: {
    professional: 'Professional — Use formal business language, complete sentences, and standard formatting.',
    formal: 'Formal — Use very formal language with precise terminology and proper structure.',
    friendly: 'Friendly — Use warm, approachable language as if speaking to a colleague.',
    short: 'Short — Keep responses brief and minimal. Only include essential information.',
    detailed: 'Detailed — Provide comprehensive, thorough responses with ample context.',
    technical: 'Technical — Use industry-specific terminology and precise technical language.',
    marketing: 'Marketing — Use persuasive, benefit-driven language with a promotional tone.'
  },

  async generate(prompt, fields, settings, customPrompt = '', ocrContext = '') {
    const tone = settings?.tone || 'professional';
    const pageContext = settings?.pageContext || '';
    const systemPrompt = this.buildSystemPrompt(fields, customPrompt, tone, ocrContext, settings, pageContext);
    const userPrompt = this.buildUserPrompt(prompt, fields, pageContext);
    const text = await this.generateText(systemPrompt, userPrompt, settings);

    return this.parseResponse(text, fields, settings, ocrContext);
  },

  async extractTextFromFile(base64, mimeType, settings) {
    const apiKey = await window.AppStorage.getApiKey();
    if (!apiKey) {
      throw new Error('API key not set. Please set your Gemini API key in the extension settings.');
    }

    const modelsToTry = [...OCR_MODELS];
    let lastError = null;

    for (const model of modelsToTry) {
      if (this.isRateLimited(model)) {
        this.reportProgress(`Skipping ${model}; it recently hit a quota limit.`);
        lastError = this.buildQuotaError(model, 'Recently rate limited.');
        continue;
      }

      if (model !== modelsToTry[0]) {
        this.reportProgress(`Trying OCR model ${model}`);
      }

      const url = this.buildUrl(model);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.buildHeaders(apiKey),
          body: JSON.stringify({
            contents: [{
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64
                  }
                },
                {
                  text: [
                    'Extract the text from this document/image.',
                    'Return ONLY the extracted document text as plain text.',
                    'Do not include analysis, plans, explanations, markdown headings, or commentary.',
                    'Preserve document order, labels, values, tables, numbers, names, and line breaks as much as possible.'
                  ].join(' ')
                }
              ]
            }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 8192
            }
          })
        });

        if (response.ok) {
          const data = await response.json();
          return this.cleanExtractedText(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
        }

        const errorText = await response.text();
        this.reportDebug('info', `OCR model ${model} failed (${response.status})`, errorText);

        if (response.status === 403 || response.status === 401) {
          throw new Error('Invalid Gemini API key. Check the key in extension settings.');
        }

        let errorMsg = `OCR API error: ${response.status}`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) errorMsg = errorData.error.message;
        } catch (e) {}

        lastError = response.status === 429
          ? this.buildQuotaError(model, errorMsg)
          : new Error(errorMsg);

        if (response.status === 429) {
          this.markRateLimited(model);
          this.reportProgress(`Quota reached for ${model}, trying next OCR model...`);
          continue;
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastError = e;
        continue;
      }
    }

    throw lastError || new Error('All OCR models failed. Please try again later.');
  },

  async generateText(systemPrompt, userPrompt, settings) {
    const apiKey = await window.AppStorage.getApiKey();
    if (!apiKey) {
      throw new Error('API key not set. Please set your Gemini API key in the extension settings.');
    }

    if (typeof window !== 'undefined' && window.__fillAborted) {
      throw new Error('Fill cancelled by user.');
    }

    const controller = typeof window !== 'undefined' ? (window.__fillController = new AbortController()) : null;
    const signal = controller?.signal;

    const selectedModel = this.normalizeModel(settings?.model);
    if (!selectedModel) {
      throw new Error('Unsupported model selection.');
    }

    const modelsToTry = selectedModel === 'auto'
      ? [...this.MODELS]
      : [selectedModel];

    let lastError = null;

    for (const model of modelsToTry) {
      if (typeof window !== 'undefined' && window.__fillAborted) {
        throw new Error('Fill cancelled by user.');
      }

      if (this.isRateLimited(model)) {
        this.reportProgress(`Skipping ${model}; it recently hit a quota limit.`);
        lastError = this.buildQuotaError(model, 'Recently rate limited.');
        continue;
      }

      if (selectedModel === 'auto' && model !== modelsToTry[0]) {
        this.reportProgress(`Trying fallback model ${model}`);
      }

      const { url, headers, body } = this.buildRequest(apiKey, model, systemPrompt, userPrompt);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal
        });

        if (response.ok) {
          const data = await response.json();
          if (!data.candidates || data.candidates.length === 0) {
            throw new Error('Model returned no response.');
          }
          return data.candidates[0]?.content?.parts?.[0]?.text || '';
        }

        const errorText = await response.text();
        this.reportDebug('info', `Model ${model} failed (${response.status})`, errorText);

        if (response.status === 403 || response.status === 401) {
          throw new Error('Invalid Gemini API key. Check the key in extension settings.');
        }

        let errorMsg = `API error: ${response.status}`;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message) errorMsg = errorData.error.message;
        } catch (e) {}

        lastError = response.status === 429
          ? this.buildQuotaError(model, errorMsg)
          : new Error(errorMsg);

        if (response.status === 429) {
          this.markRateLimited(model);
          if (selectedModel === 'auto') {
            this.reportProgress(`Quota reached for ${model}, trying next model...`);
            continue;
          }
          throw lastError;
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastError = e;
        if (selectedModel === 'auto') {
          continue;
        }
        throw e;
      }
    }

    throw lastError || new Error('All models failed. Please try again later.');
  },

  buildRequest(apiKey, model, systemPrompt, userPrompt) {
    const body = {
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          parts: [
            {
              text: userPrompt
            }
          ]
        }
      ],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.8,
        topP: 0.95,
        responseMimeType: 'application/json'
      }
    };
    return {
      url: this.buildUrl(model),
      headers: this.buildHeaders(apiKey),
      body
    };
  },

  buildUrl(model) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  },

  buildHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    };
  },

  buildQuotaError(model, message) {
    return new Error(`Gemini quota or rate limit reached for ${model}. Try Auto model fallback, wait a minute, or check your Gemini API quota. Details: ${message}`);
  },

  markRateLimited(model) {
    this.rateLimitedUntil[model] = Date.now() + RATE_LIMIT_BACKOFF_MS;
  },

  isRateLimited(model) {
    return (this.rateLimitedUntil[model] || 0) > Date.now();
  },

  getFallbackModels(primary) {
    const all = [...this.MODELS];
    return all.filter(m => m !== primary);
  },

  getRemainingModels(model) {
    const idx = this.MODELS.indexOf(model);
    if (idx < 0) return [...this.MODELS];
    return [...this.MODELS.slice(idx + 1), ...this.MODELS.slice(0, idx)];
  },

  normalizeModel(model) {
    if (model === 'auto') return 'auto';
    return this.MODELS.includes(model) ? model : null;
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

  cleanExtractedText(text) {
    let cleaned = String(text || '').replace(/```(?:text|markdown)?/gi, '').replace(/```/g, '').trim();
    const finalMarkers = [
      '**Final Text Construction:**',
      'Final Text Construction:',
      '**Final Text:**',
      'Final Text:',
      '**Extracted Text:**',
      'Extracted Text:'
    ];

    for (const marker of finalMarkers) {
      const idx = cleaned.toLowerCase().indexOf(marker.toLowerCase());
      if (idx !== -1) {
        cleaned = cleaned.slice(idx + marker.length).trim();
        break;
      }
    }

    const lines = cleaned.split(/\r?\n/);
    const firstDocumentLine = lines.findIndex(line => {
      const value = line.trim();
      if (!value) return false;
      if (/^[-*]\s/.test(value)) return false;
      if (/^#{1,6}\s/.test(value)) return false;
      if (/^i\s+(need|will|can|have)\b/i.test(value)) return false;
      if (/^(document structure analysis|extraction plan|drafting text content|let'?s|the table-like structure)\b/i.test(value)) return false;
      return /^[A-Z][A-Z0-9 .,&()/-]{3,}$/.test(value) || /^[A-Za-z][A-Za-z .]+[|,]\s*.+/.test(value);
    });

    if (firstDocumentLine > 0) {
      cleaned = lines.slice(firstDocumentLine).join('\n').trim();
    }

    return cleaned
      .split(/\r?\n/)
      .filter(line => {
        const value = line.trim();
        if (/^\*\*[^*]+:\*\*$/.test(value)) return false;
        if (/^---(?:\s*\|\s*---)*$/.test(value)) return false;
        return true;
      })
      .join('\n')
      .trim();
  },

  buildSystemPrompt(fields, customPrompt = '', tone = 'professional', ocrContext = '', settings = {}, pageContext = '') {
    const fieldKeys = fields.map(f => f.uniqueKey || f.name || f.id).filter(Boolean);
    const toneInstruction = this.TONES[tone] || this.TONES.professional;

    const hasReferenceContext = Boolean((ocrContext || '').trim());
    const documentOnly = Boolean(settings?.documentOnlyContext);
    let rules = `You are a form-filling assistant. Fill every single field with a realistic value. Never leave any field empty.

${documentOnly ? 'Fill forms using ONLY the reference document data. Do not invent, infer, or use sample values.' : (hasReferenceContext ? 'Extract form values from the reference document data when possible. For fields not covered by the reference, generate realistic values.' : 'You generate realistic, unique, and diverse values for forms. Every request is independent with no history or memory of previous responses.')}

TONE: ${toneInstruction}

RULES:
1. Return ONLY a valid JSON object. Never include any text, explanation, commentary, thinking, descriptions, markdown, or code fences. The entire response must be a single JSON object and nothing else.
2. ${documentOnly ? 'Use exact values from the reference document when a field matches. If the reference document does not contain a matching value, return empty string "" for that field.' : 'Fill every single field with a realistic value. Never leave any field empty or return empty string "".'}
3. Use the "uniqueKey" value as the JSON key for each field. Map each field's value to its uniqueKey.
4. Respect field types (email fields get emails, tel fields get phone numbers).
5. For select/choice fields, ONLY pick from provided options. Never invent options.
6. Fill every field. Never skip, leave blank, or return empty string "" for any field. Every field must have a realistic value.
7. For date fields, use YYYY-MM-DD.
8. For checkbox fields, use true/false for single checkboxes. If a checkbox field belongs to a checkbox group, only mark the relevant options true and leave unrelated options false.
9. For radio fields, choose exactly one option value per radio group and match by label, value, and nearby context.
10. Repeated groups, tables, arrays, and dynamic rows are marked with repeatedGroupId and repeatedGroupIndex. Treat each row as a separate object, keep row indexes stable, and generate distinct values for each row instead of copying the same values across every row. Do NOT append row numbers, indices, or any identifiers (e.g., " 1", " 2") to field values. Each value must be a complete, standalone value without trailing numbering.
11. Use region and formatting hints from the page, field labels, placeholders, option labels, and group context.
12. Every field must have a value. Do not return empty string "" for any field. Generate a realistic, context-appropriate value for every field.
13. You are generating data for these fields: ${fieldKeys.join(', ')}.
14. Never reuse examples from previous responses. Every response must contain different products, services, items, or works.
15. Avoid overusing common items (e.g., "Northstar Labs", "Alex Morgan", "Widget"). Pull from a wide range of industries: manufacturing, healthcare, construction, education, hospitality, logistics, agriculture, retail, laboratories, security, networking, electrical, civil works, furniture, software, licensing, maintenance, and facility management.
16. Make every generated value unique within the response. No two fields should receive the same or nearly identical values unless the form explicitly asks for the same information twice.`;

    if (ocrContext) {
      rules += `\n\nREFERENCE DOCUMENT DATA (${documentOnly ? 'only source of values; return empty string for unmatched fields' : 'use these values when they match form fields — prefer these over generated data'}):\n${ocrContext}`;
    }

    if (pageContext) {
      rules += `\n\nPAGE VISIBLE TEXT (visible text extracted from the page — use this as context to understand the form purpose and determine appropriate values):\n${pageContext}`;
    }

    if (customPrompt) {
      rules += `\n\nUSER INSTRUCTIONS (follow these above all other rules):\n${customPrompt}`;
    }

    return rules;
  },

  buildUserPrompt(prompt, fields, pageContext = '') {
    const fieldsJson = JSON.stringify(this.serializeFieldsForPrompt(fields), null, 2);
    let result = `Page: ${document?.title || 'Unknown'}
URL: ${window?.location?.href || 'Unknown'}
Form: ${prompt}

Fields:
${fieldsJson}

`;
    if (pageContext) {
      result += `PAGE VISIBLE TEXT (use this to understand the page context, determine what this form is for, and decide which values are appropriate):
${pageContext}

`;
    }
    result += `Return ONLY a JSON object with values for these fields using the keys shown above. Do not include any text, explanation, or commentary outside the JSON object.`;

    return result;
  },

  serializeFieldsForPrompt(fields) {
    return fields.map(field => ({
      key: field.uniqueKey || field.name || field.id || '',
      type: field.type,
      label: field.label || '',
      name: field.name || '',
      id: field.id || '',
      placeholder: field.placeholder || '',
      required: Boolean(field.required),
      value: field.value || '',
      options: Array.isArray(field.options) ? field.options : [],
      checkboxGroupKey: field.checkboxGroupKey || '',
      checkboxGroupLabel: field.checkboxGroupLabel || '',
      checkboxGroupIndex: Number.isInteger(field.checkboxGroupIndex) ? field.checkboxGroupIndex : null,
      checkboxGroupSize: Number.isInteger(field.checkboxGroupSize) ? field.checkboxGroupSize : null,
      checkboxGroupOptions: Array.isArray(field.checkboxGroupOptions) ? field.checkboxGroupOptions : [],
      repeatedGroupId: field.repeatedGroupId || '',
      repeatedGroupIndex: Number.isInteger(field.repeatedGroupIndex) ? field.repeatedGroupIndex : null,
      repeatedGroupSize: Number.isInteger(field.repeatedGroupSize) ? field.repeatedGroupSize : null,
      repeatedGroupLabel: field.repeatedGroupLabel || '',
      groupName: field.groupName || '',
      optionValue: field.optionValue || '',
      optionLabel: field.optionLabel || '',
      checked: Boolean(field.checked),
      ariaLabel: field.ariaLabel || ''
    }));
  },

  parseResponse(text, fields, settings = {}, ocrContext = '') {
    let cleaned = text.trim();

    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) cleaned = jsonMatch[1].trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    try {
      const parsed = JSON.parse(cleaned);
      const result = {};
      const fieldOccurrences = {};
      for (const field of fields) {
        const key = field.uniqueKey || field.name || field.id || '';
        if (!key) continue;
        const occurrenceKey = this.getFieldOccurrenceKey(field);
        const occurrenceIndex = fieldOccurrences[occurrenceKey] || 0;
        fieldOccurrences[occurrenceKey] = occurrenceIndex + 1;
        const documentOccurrenceIndex = Number.isInteger(field.documentLineItemIndex)
          ? field.documentLineItemIndex
          : occurrenceIndex;

        const directValue = settings?.documentOnlyContext
          ? this.getDirectDocumentValue(field, ocrContext, documentOccurrenceIndex)
          : '';
        if (directValue) {
          result[key] = directValue;
          continue;
        }
        const foundKey = Object.keys(parsed).find(k =>
          k === key || k === field.uniqueKey || k === field.name || k === field.id || k === field.label ||
          k.replace(/[^a-zA-Z0-9]/g, '') === key.replace(/[^a-zA-Z0-9]/g, '')
        );
        const value = foundKey !== undefined ? parsed[foundKey] : undefined;
        const normalizedValue = this.normalizeParsedValueForField(field, value);
        if (this.hasUsableValue(normalizedValue)) {
          if (this.isFieldLabelReturnedAsValue(normalizedValue, field)) {
            result[key] = settings?.documentOnlyContext ? '' : this.getFallbackValue(field);
          } else {
            result[key] = settings?.documentOnlyContext && !this.valueAppearsInContext(normalizedValue, ocrContext)
              ? ''
              : normalizedValue;
          }
        } else {
          result[key] = settings?.documentOnlyContext ? '' : this.getFallbackValue(field);
        }
      }
      for (const key of Object.keys(result)) {
        const val = result[key];
        if (typeof val === 'string') {
          result[key] = val.replace(/\s+\d{1,2}$/, '');
        }
      }
      return result;
    } catch (e) {
      const repaired = settings?.documentOnlyContext
        ? this.buildDocumentOnlyResult(fields, ocrContext)
        : this.repairStructuredResponse(cleaned, fields);
      if (repaired) {
        for (const key of Object.keys(repaired)) {
          const val = repaired[key];
          if (typeof val === 'string') {
            repaired[key] = val.replace(/\s+\d{1,2}$/, '');
          }
        }
        return repaired;
      }

      this.reportDebug('error', 'Failed to parse Gemini response', text);
      throw new Error('Failed to parse AI response. The model returned invalid JSON.');
    }
  },

  repairStructuredResponse(text, fields) {
    const result = {};
    const lookup = new Map();

    for (const field of fields) {
      const keys = [field.uniqueKey, field.name, field.id, field.label]
        .filter(Boolean)
        .flatMap(value => [
          String(value),
          String(value).replace(/[`*\-]/g, '').trim(),
          String(value).replace(/\s+/g, '_').trim(),
          String(value).replace(/[^a-zA-Z0-9_\-]/g, '').trim()
        ])
        .map(value => value.toLowerCase())
        .filter(Boolean);

      for (const key of keys) {
        lookup.set(key, field);
      }
    }

    const lines = String(text || '').split(/\r?\n/);
    let matchedAny = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const match = line.match(/^(?:[-*]\s*)?(?:\*\s*)?(?:`([^`]+)`|"([^"]+)"|'([^']+)'|([^:]+?))\s*:\s*(.+)$/);
      if (!match) continue;

      const key = (match[1] || match[2] || match[3] || match[4] || '').trim().toLowerCase();
      const valueText = (match[5] || '').trim();
      if (!key) continue;

      const field = lookup.get(key) || lookup.get(key.replace(/\s+/g, '_')) || lookup.get(key.replace(/[^a-z0-9_\-]/g, ''));
      if (!field) continue;

      const parsedValue = this.coerceStructuredValue(valueText, field);
      if (this.hasUsableValue(parsedValue)) {
        result[field.uniqueKey || field.name || field.id] = parsedValue;
        matchedAny = true;
      }
    }

    if (!matchedAny) {
      const fallback = this.repairValueFromProse(text, fields);
      if (fallback) {
        return fallback;
      }
    }

    return matchedAny ? result : null;
  },

  repairValueFromProse(text, fields) {
    const result = {};
    const prose = String(text || '');

    for (const field of fields) {
      const key = field.uniqueKey || field.name || field.id;
      if (!key) continue;

      const value = this.extractValueFromProse(prose, field);
      if (this.hasUsableValue(value)) {
        result[key] = value;
      }
    }

    return Object.keys(result).length > 0 ? result : null;
  },

  buildDocumentOnlyResult(fields, context) {
    const result = {};
    const fieldOccurrences = {};

    for (const field of fields) {
      const key = field.uniqueKey || field.name || field.id || '';
      if (!key) continue;

      const occurrenceKey = this.getFieldOccurrenceKey(field);
      const occurrenceIndex = fieldOccurrences[occurrenceKey] || 0;
      fieldOccurrences[occurrenceKey] = occurrenceIndex + 1;

      const directValue = this.getDirectDocumentValue(field, context, occurrenceIndex);
      result[key] = directValue || '';
    }

    return result;
  },

  extractValueFromProse(text, field) {
    const type = String(field.type || '').toLowerCase();
    const hint = this.getFieldHint(field);

    if (type === 'date' || /\b(date|due|required\s*by|required\s*on)\b/.test(hint)) {
      return this.extractDateFromText(text, field);
    }

    if (type === 'number' || type === 'range') {
      const numericMatch = text.match(/-?\d+(?:\.\d+)?/);
      return numericMatch ? numericMatch[0] : '';
    }

    if (type === 'checkbox') {
      if (/\b(true|yes|checked|selected|on)\b/i.test(text)) return true;
      if (/\b(false|no|unchecked|off)\b/i.test(text)) return false;
      return '';
    }

    if (type === 'radio') {
      const options = [field.optionLabel, field.optionValue, ...(Array.isArray(field.options) ? field.options.map(opt => opt.value || opt.text) : [])]
        .filter(Boolean);
      const normalizedText = this.normalizeForContextMatch(text);
      const match = options.find(option => {
        const normalizedOption = this.normalizeForContextMatch(option);
        return normalizedOption && (normalizedText.includes(normalizedOption) || normalizedOption.includes(normalizedText));
      });
      return match || '';
    }

    const label = this.getFieldLabelCandidates(field)
      .map(candidate => String(candidate || '').trim())
      .filter(Boolean)
      .find(candidate => new RegExp(this.escapeRegExp(candidate), 'i').test(text));

    if (label) {
      const afterLabel = text.match(new RegExp(`${this.escapeRegExp(label)}\s*[:\-]\s*([^\n\r]+)`, 'i'));
      if (afterLabel && afterLabel[1]) return this.cleanProseTextValue(afterLabel[1]);
    }

    const valueLine = text.match(/(?:realistic value|value|answer|result)\s*[:\-]\s*([^\n\r]+)/i);
    if (valueLine && valueLine[1]) return this.cleanProseTextValue(valueLine[1]);

    return '';
  },

  cleanProseTextValue(valueText) {
    let value = String(valueText || '').trim();
    if (!value) return '';

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('`') && value.endsWith('`'))) {
      value = value.slice(1, -1).trim();
    }

    const structuredTail = value.match(/^(.*?)(?=(?:,\s*|;\s*|\s+)(?:`[^`]+`|"[^"]+"|'[^']+'|[A-Za-z0-9_ ]+)\s*:)/);
    if (structuredTail && structuredTail[1]) {
      value = structuredTail[1].trim();
    }

    value = value.replace(/[",;]+$/g, '').trim();
    value = value.replace(/\s+\d{1,2}$/, '');
    return value;
  },

  extractDateFromText(text, field) {
    const candidates = [
      ...String(text || '').matchAll(/\b(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/g),
      ...String(text || '').matchAll(/\b(\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4})\b/g),
      ...String(text || '').matchAll(/\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g),
      ...String(text || '').matchAll(/\b([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/g)
    ];

    for (const match of candidates) {
      const candidate = match[1] || match[0];
      const normalized = this.normalizeDateValue(candidate);
      if (normalized) return normalized;
      if (/^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}$/.test(candidate)) return candidate.replace(/[/.]/g, '-');
    }

    const hint = this.getFieldHint(field);
    if (/\bnear\s+future\b/i.test(text) || /\bdate\b/i.test(hint)) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    return '';
  },

  escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  coerceStructuredValue(valueText, field) {
    const type = String(field.type || '').toLowerCase();
    const cleaned = String(valueText || '').trim();

    const unwrapped = cleaned
      .replace(/^`([^`]+)`$/, '$1')
      .replace(/^"([^"]+)"$/, '$1')
      .replace(/^'([^']+)'$/, '$1');

    if (type === 'number' || type === 'range') {
      const numberMatch = unwrapped.match(/-?\d+(?:\.\d+)?/);
      if (numberMatch) return numberMatch[0];
    }

    if (type === 'checkbox') {
      return /^(true|yes|checked|selected|on|1)$/i.test(unwrapped);
    }

    if (type === 'radio') {
      return unwrapped;
    }

    if (type === 'textarea' || /\b(description|justification|message|summary|note|notes|remarks)\b/.test(this.getFieldHint(field))) {
      return this.cleanProseTextValue(unwrapped);
    }

    if (/^\[(.*)\]$/.test(unwrapped) || /^\{(.*)\}$/.test(unwrapped)) {
      try {
        return JSON.parse(unwrapped);
      } catch (e) {}
    }

    if (type === 'date') {
      return this.normalizeDateValue(unwrapped) || unwrapped;
    }

    return unwrapped;
  },

  hasUsableValue(value) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return false;
      if (/^""$/.test(trimmed) || /^''$/.test(trimmed)) return false;
    }
    return value !== null && value !== undefined && value !== '';
  },

  isFieldLabelReturnedAsValue(value, field) {
    if (typeof value !== 'string') return false;
    const val = value.trim().toLowerCase();
    if (!val) return false;
    const candidates = [
      field.label,
      field.placeholder,
      field.name,
      field.id,
      field.ariaLabel,
      field.uniqueKey
    ].filter(Boolean).map(s => String(s).trim().toLowerCase());
    return candidates.includes(val);
  },

  normalizeParsedValueForField(field, value) {
    const type = String(field.type || '').toLowerCase();

    if (type === 'checkbox') {
      return this.normalizeCheckboxValue(field, value);
    }

    if (type === 'radio') {
      return this.normalizeChoiceValue(field, value);
    }

    const textValue = typeof value === 'string' ? value.trim() : '';
    if ((type === 'text' || type === 'textarea' || type === '') && textValue) {
      const cleaned = textValue.replace(/\s+\d{1,2}$/, '');
      return cleaned !== textValue ? cleaned : value;
    }

    if (Array.isArray(value)) {
      return value.filter(item => this.hasUsableValue(item));
    }

    return value;
  },

  normalizeCheckboxValue(field, value) {
    if (typeof value === 'boolean') return value;

    const selectedTokens = this.extractChoiceTokens(value);
    if (selectedTokens.length > 0) {
      return selectedTokens.some(token => this.choiceMatchesField(token, field));
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return false;
      if (/^(true|yes|checked|selected|on|1)$/.test(normalized)) return true;
      if (/^(false|no|unchecked|off|0)$/.test(normalized)) return false;
      return this.choiceMatchesField(normalized, field);
    }

    return Boolean(value);
  },

  normalizeChoiceValue(field, value) {
    if (Array.isArray(value)) {
      return value.find(item => this.hasUsableValue(item)) || '';
    }

    if (value && typeof value === 'object') {
      return value.value || value.label || value.text || value.selected || '';
    }

    return value;
  },

  extractChoiceTokens(value) {
    if (Array.isArray(value)) {
      return value.flatMap(item => this.extractChoiceTokens(item));
    }

    if (value && typeof value === 'object') {
      const tokens = [value.value, value.label, value.text, value.selected, value.option].filter(v => this.hasUsableValue(v));
      return tokens.flatMap(token => this.extractChoiceTokens(token));
    }

    if (typeof value !== 'string') return [];

    return value
      .split(/(?:,|\n|\||;|\/)+/)
      .map(part => part.trim())
      .filter(Boolean);
  },

  choiceMatchesField(token, field) {
    const normalizedToken = this.normalizeForContextMatch(token);
    const candidates = [
      field.optionLabel,
      field.optionValue,
      field.label,
      field.name,
      field.id,
      field.checkboxGroupLabel,
      field.ariaLabel
    ].filter(Boolean).map(value => this.normalizeForContextMatch(value));

    return candidates.some(candidate => candidate && (candidate === normalizedToken || candidate.includes(normalizedToken) || normalizedToken.includes(candidate)));
  },

  valueAppearsInContext(value, context) {
    if (typeof value === 'boolean') return true;
    if (!context) return false;

    const rawValue = String(value).trim();
    if (!rawValue) return false;

    const normalizedContext = this.normalizeForContextMatch(context);
    const candidates = [rawValue, ...this.getDateContextCandidates(rawValue)]
      .map(candidate => this.normalizeForContextMatch(candidate))
      .filter(Boolean);

    return candidates.some(candidate => normalizedContext.includes(candidate));
  },

  normalizeForContextMatch(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  },

  getDirectDocumentValue(field, context, occurrenceIndex = 0) {
    if (!context) return '';

    const hint = this.getFieldHint(field);
    const lineItemValue = this.getLineItemValue(field, context, occurrenceIndex);
    if (lineItemValue) return this.normalizeDocumentValueForField(lineItemValue, field);

    if (/\b(title|header|heading|document\s*title|subject)\b/.test(hint) && !/\b(job|role|position)\b/.test(hint)) {
      return this.getDocumentHeading(context);
    }

    const pairs = this.getDocumentKeyValuePairs(context);
    const labels = this.getFieldLabelCandidates(field);
    for (const label of labels) {
      const normalized = this.normalizeForContextMatch(label);
      if (pairs[normalized]) return this.normalizeDocumentValueForField(pairs[normalized], field);
    }

    return '';
  },

  normalizeDocumentValueForField(value, field) {
    const hint = this.getFieldHint(field);
    const type = String(field.type || '').toLowerCase();
    if (type === 'date' || /\b(date|due|required\s*by|required\s*on)\b/.test(hint)) {
      return this.normalizeDateValue(value) || value;
    }
    return value;
  },

  normalizeDateValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      const [, year, month, day] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    match = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
    if (match) {
      const [, day, monthName, year] = match;
      const month = this.getMonthNumber(monthName);
      if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
    }

    return '';
  },

  getMonthNumber(monthName) {
    const months = {
      jan: '01', january: '01',
      feb: '02', february: '02',
      mar: '03', march: '03',
      apr: '04', april: '04',
      may: '05',
      jun: '06', june: '06',
      jul: '07', july: '07',
      aug: '08', august: '08',
      sep: '09', sept: '09', september: '09',
      oct: '10', october: '10',
      nov: '11', november: '11',
      dec: '12', december: '12'
    };
    return months[String(monthName || '').toLowerCase()] || '';
  },

  getFieldOccurrenceKey(field) {
    const label = field.label || field.placeholder || field.name || field.id || field.uniqueKey || '';
    return this.normalizeForContextMatch(String(label).replace(/_\d+$/, ''));
  },

  getLineItemValue(field, context, occurrenceIndex) {
    const rows = this.getDocumentLineItems(context);
    if (!rows.length) return '';

    const hint = this.getFieldHint(field);
    const column = this.getLineItemColumnForField(hint);
    if (!column) return '';

    const row = rows[occurrenceIndex];
    return row?.[column] || '';
  },

  getLineItemColumnForField(hint) {
    if (/\b(unit\s*cost|unit\s*price|rate|price)\b/.test(hint)) return 'unitPrice';
    if (/\b(amount|total)\b/.test(hint)) return 'amount';
    if (/\b(description|item|product|material|goods|service|particular|particulars)\b/.test(hint)) return 'description';
    if (/\b(qty|quantity|count|no\.?\s*of|number\s*of)\b/.test(hint)) return 'quantity';
    if (/\b(unit|uom)\b/.test(hint)) return 'unit';
    if (/\b(vendor\s*remarks|remarks|remark|note|notes)\b/.test(hint)) return 'remarks';
    return '';
  },

  getDocumentLineItems(context) {
    const lines = this.getMeaningfulDocumentLines(context);
    const headerIndex = lines.findIndex(line => {
      const normalized = this.normalizeForContextMatch(line);
      return /sr(no)?/.test(normalized)
        && /description|item|particular/.test(normalized)
        && /qty|quantity/.test(normalized);
    });

    if (headerIndex === -1) return [];

    const headerColumns = this.splitDocumentRow(lines[headerIndex]);
    const normalizedHeaders = headerColumns.map(col => this.normalizeForContextMatch(col));
    const rows = [];

    for (const line of lines.slice(headerIndex + 1)) {
      if (/^(grand\s*total|total)$/i.test(line)) break;
      const columns = this.splitDocumentRow(line);
      if (columns.length < 3 || !/^\d+[.)]?$/.test(columns[0].trim())) continue;

      const row = {};
      columns.forEach((value, index) => {
        const key = this.getLineItemColumnForHeader(normalizedHeaders[index] || '');
        if (key && value.trim()) row[key] = value.trim();
      });

      if (row.description || row.quantity || row.unit) {
        rows.push(row);
      }
    }

    return rows;
  },

  splitDocumentRow(line) {
    if (line.includes('|')) return line.split('|').map(part => part.trim()).filter(Boolean);
    if (line.includes(',')) return line.split(',').map(part => part.trim()).filter(Boolean);
    return line.split(/\s{2,}/).map(part => part.trim()).filter(Boolean);
  },

  getLineItemColumnForHeader(header) {
    if (/^sr(no)?$/.test(header) || header === 'serialno') return '';
    if (/description|item|product|material|goods|service|particular/.test(header)) return 'description';
    if (/qty|quantity|count/.test(header)) return 'quantity';
    if (/unit|uom/.test(header)) return 'unit';
    if (/unitprice|unitcost|vendorunitprice|rate|price/.test(header)) return 'unitPrice';
    if (/amount|totalamount|total/.test(header)) return 'amount';
    if (/remarks|notes/.test(header)) return 'remarks';
    return '';
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

  getFieldLabelCandidates(field) {
    const raw = [
      field.label,
      field.placeholder,
      field.name,
      field.id,
      field.uniqueKey
    ].filter(Boolean);

    const expanded = [];
    for (const value of raw) {
      expanded.push(value);
      expanded.push(String(value).replace(/[_-]/g, ' '));
      expanded.push(String(value).replace(/([a-z])([A-Z])/g, '$1 $2'));
    }

    const hint = this.getFieldHint(field);
    if (/\brequired\s*by\b|\brequired\s*date\b|\bdue\b/.test(hint)) {
      expanded.push('Due Date', 'Required by', 'Required Date');
    }
    if (/\bissue\s*date\b/.test(hint)) {
      expanded.push('Issue Date', 'Date');
    }
    return expanded;
  },

  getDocumentHeading(context) {
    const lines = this.getMeaningfulDocumentLines(context);
    return lines.find(line => {
      if (/[|,:]\s*\S/.test(line)) return false;
      if (/^(field|value|sr|description|qty|unit|requirements)$/i.test(line)) return false;
      return /[A-Za-z]/.test(line);
    }) || '';
  },

  getDocumentKeyValuePairs(context) {
    const pairs = {};
    for (const line of this.getMeaningfulDocumentLines(context)) {
      if (/^\s*-{2,}/.test(line)) continue;
      const columns = this.splitDocumentRow(line);
      if (columns.length >= 4 && columns.length % 2 === 0 && !/^\d+[.)]?$/.test(columns[0].trim())) {
        for (let i = 0; i < columns.length; i += 2) {
          const label = columns[i].trim();
          const value = columns[i + 1].trim();
          if (!label || !value) continue;
          if (/^(field|sr|description|qty|quantity|unit)$/i.test(label)) continue;
          if (/^(value|---)$/i.test(value)) continue;
          pairs[this.normalizeForContextMatch(label)] = value;
        }
        continue;
      }

      const match = line.match(/^(.+?)\s*(?:\||,|:|\t|\s{2,})\s*(.+)$/);
      if (!match) continue;

      const label = match[1].trim();
      const value = match[2].trim();
      if (!label || !value) continue;
      if (/^(field|sr|description|qty|quantity|unit)$/i.test(label)) continue;
      if (/^(value|---)$/i.test(value)) continue;

      pairs[this.normalizeForContextMatch(label)] = value;
    }
    return pairs;
  },

  getMeaningfulDocumentLines(context) {
    return this.cleanExtractedText(context)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => {
        if (!line) return false;
        if (/^sheet\s*\(/i.test(line)) return false;
        if (/^[-*]\s/.test(line)) return false;
        if (/^#{1,6}\s/.test(line)) return false;
        if (/^\*\*[^*]+:\*\*$/.test(line)) return false;
        if (/^---(?:\s*\|\s*---)*$/.test(line)) return false;
        if (/^(document structure analysis|extraction plan|drafting text content|final text construction)\b/i.test(line)) return false;
        if (/^i\s+(need|will|can|have)\b/i.test(line)) return false;
        return true;
      });
  },

  getDateContextCandidates(value) {
    const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!iso) return [];

    const [, year, month, day] = iso;
    const monthNames = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const monthIndex = Number(month) - 1;
    if (monthIndex < 0 || monthIndex >= monthNames.length) return [];

    const shortMonth = monthNames[monthIndex];
    const longMonth = new Date(Number(year), monthIndex, Number(day)).toLocaleString('en-US', { month: 'long' });
    const plainDay = String(Number(day));
    const plainMonth = String(Number(month));

    return [
      `${day}-${shortMonth}-${year}`,
      `${plainDay}-${shortMonth}-${year}`,
      `${day} ${shortMonth} ${year}`,
      `${plainDay} ${shortMonth} ${year}`,
      `${day}-${longMonth}-${year}`,
      `${plainDay}-${longMonth}-${year}`,
      `${day}/${month}/${year}`,
      `${plainDay}/${plainMonth}/${year}`
    ];
  },

  getFallbackValue(field) {
    const type = (field.type || 'text').toLowerCase();

    if (field.options?.length) {
      const option = field.options.find(opt => {
        const text = String(opt.text || opt.value || '').trim();
        const value = String(opt.value || '').trim();
        return (text || value) && !/select|choose|pick|--/.test(text.toLowerCase());
      });
      return option?.value || option?.text || '';
    }

    if (type === 'checkbox') return false;
    if (type === 'radio') return '';
    if (type === 'date') return new Date().toISOString().slice(0, 10);
    if (type === 'color') return '#4f46e5';
    if (type === 'range' || type === 'number') return field.min || '';
    if (type === 'email') return '';
    if (type === 'tel') return '';
    if (type === 'url') return '';
    return '';
  }
};

if (typeof window !== 'undefined') {
  window.GeminiService = GeminiService;
}

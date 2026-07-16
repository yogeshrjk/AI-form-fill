# AI Form Auto Filler

A Chrome Extension (Manifest V3) that automatically detects and fills forms on any website using Google Gemini AI.

## Features

- **Automatic Form Detection** - Detects all form elements (input, textarea, select, checkbox, radio, date, number, email, tel, url, color, range) on any page
- **AI-Powered Filling** - Uses the Google Gemini REST API with plain JavaScript `fetch()` to generate realistic fake data for form fields
- **Smart Label Detection** - Infers field labels from nearby text and DOM structure
- **Framework Compatible** - Works with React, Vue, Angular, Svelte via native value setters and proper event dispatch
- **Dynamic Forms** - Detects newly revealed fields after filling initial fields
- **Privacy Focused** - Never sends passwords, credit card numbers, OTPs, or CAPTCHA fields
- **Progress Updates** - Shows what the extension is generating or filling during form completion
- **Customizable Settings** - Model selection, fill speed, confirmation toggle
- **Keyboard Shortcut** - `Cmd+Shift+F` (Mac) / `Ctrl+Shift+F` (Windows/Linux)
- **Right-Click Menu** - "Fill this Form with AI" context menu option
- **Dark Mode UI** - Modern dark theme with animations and toast notifications
- **Preview & Confirm** - Option to preview generated values before filling

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked" and select the `ai-form-filler` folder
5. The extension icon will appear in your browser toolbar

## Usage

1. Click the extension icon in the toolbar to open the popup
2. Enter your Gemini API key and click "Save Key"
   - Get a free API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
3. Navigate to any page with a form
4. Click the extension icon and press "Fill Current Form"
5. The AI will generate and fill realistic data into all detected form fields

### Settings

- **Model** - Uses Gemini 3.5 Flash by default, with current Gemini Flash fallback options
- **Fill Speed** - Instant sets values immediately; human-like types text fields with short delays
- **Auto-fill Confirmation** - Toggle preview before filling

### Keyboard Shortcut

- **Mac:** `Cmd+Shift+F`
- **Windows/Linux:** `Ctrl+Shift+F`

### Right-Click Menu

Right-click anywhere on a page and select "Fill this Form with AI".

## Privacy

- Your API key is stored securely in `chrome.storage.sync`
- Only field metadata (type, name, label) is sent to Gemini, never the current field values
- Password, credit card, OTP, and CAPTCHA fields are never detected or sent
- No browsing history is collected
- No analytics or tracking

## File Structure

```
ai-form-filler/
├── manifest.json
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/
│   ├── content.js
│   ├── parser.js
│   └── filler.js
├── background/
│   └── background.js
├── services/
│   └── gemini.js
├── utils/
│   ├── dom.js
│   ├── events.js
│   └── storage.js
└── assets/
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

## Requirements

- Google Chrome 88+ (Manifest V3 support)
- A valid Google Gemini API key

## License

MIT

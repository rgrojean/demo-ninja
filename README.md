# Demo Ninja

AI-powered demo customization — personalize any web page for your prospect in seconds.

Demo Ninja is a Chrome extension that lets SEs capture any web page, use AI to generate find-and-replace text swaps tailored to a prospect, and instantly apply them. Works with any SaaS product, any website.

## How It Works

1. **Capture** — take a screenshot + extract text from any page in your browser
2. **Generate** — AI analyzes the page and produces text replacements customized for your prospect's company name, industry, and use case
3. **Apply** — replacements are applied live to the DOM, surviving page navigation and dynamic content updates
4. **Organize** — save replacements into projects (one per prospect), with per-page files you can toggle on/off
5. **Share** — export/import project files to share customized demos with your team

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/demo-ninja.git
```

### 2. Load the extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `demo-ninja` folder you just cloned

### 3. Configure your API key

1. Click the Demo Ninja icon in your Chrome toolbar to open the side panel
2. In the **Settings** section, choose your AI provider:
   - **Claude (Anthropic)** — get a key at [console.anthropic.com](https://console.anthropic.com/)
   - **OpenAI** — get a key at [platform.openai.com](https://platform.openai.com/)
   - **Gemini (Google)** — get a key at [aistudio.google.com](https://aistudio.google.com/apikey)
3. Paste your API key and click **Save Settings**

### 4. Customize a demo

1. Navigate to the web page you want to customize
2. Click **Capture Page** in the side panel
3. Enter the prospect's company name and any additional instructions
4. Click **Generate Replacements**
5. Review, edit, or add replacements as needed
6. Click **Save** — replacements apply automatically

## Features

- **Works on any website** — not locked to any specific product or URL
- **Multi-provider AI** — bring your own key for Claude, OpenAI, or Gemini
- **Project-based organization** — group customizations by prospect
- **Per-page file scoping** — replacements only apply to the page they were captured from
- **Live DOM updates** — handles SPAs and dynamically loaded content via MutationObserver
- **Export/Import** — share demo configs with teammates as JSON files
- **Toggle on/off** — enable or disable individual files or entire projects instantly

## Supported AI Providers

| Provider | Default Model | Vision Support |
|----------|--------------|----------------|
| Anthropic (Claude) | claude-sonnet-4-20250514 | Yes |
| OpenAI | gpt-4o | Yes |
| Google (Gemini) | gemini-2.5-flash | Yes |

You can override the model in Settings if you prefer a different one.

## Privacy

- Your API key is stored locally in Chrome's extension storage — it never leaves your browser except to call the AI provider you selected
- Page screenshots and text are sent to your chosen AI provider to generate replacements — they are not sent anywhere else
- No analytics, no telemetry, no server

## License

MIT

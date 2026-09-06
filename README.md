![Image 1: opencode-openai-codex-auth](assets/readme-hero.svg)
  
  
**Curated by [Numman Ali](https://x.com/nummanali)**
[![Twitter Follow](https://img.shields.io/twitter/follow/nummanali?style=social)](https://x.com/nummanali)
[![npm version](https://img.shields.io/npm/v/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)
[![Tests](https://github.com/numman-ali/opencode-openai-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/numman-ali/opencode-openai-codex-auth/actions)
[![npm downloads](https://img.shields.io/npm/dm/opencode-openai-codex-auth.svg)](https://www.npmjs.com/package/opencode-openai-codex-auth)
**One install. Every Codex model.**
[Install](#-quick-start) · [Models](#-models) · [Configuration](#-configuration) · [Docs](#-docs)

---
## 💡 Philosophy
> **"One config. Every model."**
OpenCode should feel effortless. This plugin keeps the setup minimal while giving you full GPT‑5.x + Codex access via ChatGPT OAuth.
```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ChatGPT OAuth → Codex backend → OpenCode               │
│  One command install, full model presets, done.         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
---
## 🚀 Quick Start
```bash
npx -y opencode-openai-codex-auth@latest
```
Then:
```bash
opencode auth login
opencode run "write hello world to test.txt" --model=openai/gpt-5.2 --variant=medium
```
Legacy OpenCode (v1.0.209 and below):
```bash
npx -y opencode-openai-codex-auth@latest --legacy
opencode run "write hello world to test.txt" --model=openai/gpt-5.2-medium
```
Uninstall:
```bash
npx -y opencode-openai-codex-auth@latest --uninstall
npx -y opencode-openai-codex-auth@latest --uninstall --all
```
---
## 📦 Models
- **gpt-5.6-sol** (none/low/medium/high/xhigh/max; `gpt-5.6` alias)
- **gpt-5.6-terra** (none/low/medium/high/xhigh/max)
- **gpt-5.6-luna** (none/low/medium/high/xhigh/max)
- **gpt-5.2** (none/low/medium/high/xhigh)
- **gpt-5.2-codex** (low/medium/high/xhigh)
- **gpt-5.1-codex-max** (low/medium/high/xhigh)
- **gpt-5.1-codex** (low/medium/high)
- **gpt-5.1-codex-mini** (medium/high)
- **gpt-5.1** (none/low/medium/high)
---
## 🧩 Configuration
- Modern (OpenCode v1.0.210+): `config/opencode-modern.json`
- Legacy (OpenCode v1.0.209 and below): `config/opencode-legacy.json`

Minimal configs are not supported for GPT‑5.x; use the full configs above.
---
## ✅ Features
- ChatGPT Plus/Pro OAuth authentication (official flow)
- GPT‑5.6 Sol/Terra/Luna support, including `max` reasoning effort
- Variant system support (v1.0.210+) + legacy presets
- Multimodal input enabled for all models
- Usage‑aware errors + automatic token refresh
---
## 📚 Docs
- Getting Started: `docs/getting-started.md`
- Configuration: `docs/configuration.md`
- Troubleshooting: `docs/troubleshooting.md`
- Architecture: `docs/development/ARCHITECTURE.md`
---
## ⚠️ Usage Notice
This plugin is for **personal development use** with your own ChatGPT Plus/Pro subscription.
For production or multi‑user applications, use the OpenAI Platform API.

**Built for developers who value simplicity.**

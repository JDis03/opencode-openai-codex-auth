![Image 1: opencode-openai-codex-auth](assets/readme-hero.svg)
  
  
**Originally created by [Numman Ali](https://x.com/nummanali) · Actively maintained fork by [JDis03](https://github.com/JDis03)**

> 🔀 **Fork notice**: The upstream repo ([numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth)) has had no commits since **2026-01-09** (v4.4.0) and open PRs/issues are unreviewed. This fork continues active development (new models, the data-driven model registry, bug fixes) under the same MIT license. Full credit to Numman Ali for creating the original project.

[![Twitter Follow](https://img.shields.io/twitter/follow/nummanali?style=social)](https://x.com/nummanali)
[![Tests](https://github.com/JDis03/opencode-openai-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/JDis03/opencode-openai-codex-auth/actions)
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
- **gpt-6-astra** (low/medium/high/xhigh/max; `gpt-6` alias) — no `none` support
- **gpt-6-sol** (none/low/medium/high/xhigh/max)
- **gpt-6-luna** (none/low/medium/high/xhigh/max)
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
## 🔄 Model Registry (maintainer notes)
Model normalization, reasoning capabilities, and prompt-family selection are
driven by a single data file: `lib/request/helpers/model-registry-data.ts`.
Adding support for a new OpenAI model is normally **one entry in that file**,
not a plugin-wide patch.

For even faster turnaround (no npm release required to get a brand-new model
recognized), point the plugin at a JSON overlay hosted anywhere you control:
```json
// ~/.opencode/openai-codex-auth-config.json
{ "codexMode": true, "modelRegistryUrl": "https://raw.githubusercontent.com/<you>/<repo>/main/model-registry.json" }
```
or via `OPENCODE_CODEX_MODEL_REGISTRY_URL` (env var takes precedence). The
overlay is fetched with ETag caching (checked at most every 15 minutes) and
merged with the bundled registry; it's entirely opt-in — nothing is fetched
unless you configure a URL, and any failure silently falls back to the
bundled defaults.
---
## ✅ Features
- ChatGPT Plus/Pro OAuth authentication (official flow)
- Data-driven model registry: new models add cleanly, with an optional
  self-hosted JSON overlay for instant updates between releases
- GPT‑5.6 Sol/Terra/Luna support, including `max` reasoning effort
- Variant system support (v1.0.210+) + legacy presets
- Multimodal input enabled for all models
- Usage‑aware errors + automatic token refresh
- **Skills + MCP parity with Anthropic sessions**: OpenCode's `<available_skills>`
  catalog and `<mcp_instructions>` block now reach Codex too, instead of being
  silently dropped — same capability awareness Claude sessions already had
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

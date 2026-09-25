![Image 1: opencode-openai-codex-auth](assets/readme-hero.svg)
  
  
**Originally created by [Numman Ali](https://x.com/nummanali) · Actively maintained fork by [JDis03](https://github.com/JDis03)**

> 🔀 **Fork notice**: The upstream repo ([numman-ali/opencode-openai-codex-auth](https://github.com/numman-ali/opencode-openai-codex-auth)) has had no commits since **2026-01-09** (v4.4.0) and open PRs/issues are unreviewed. This fork continues active development (new models, the data-driven model registry, bug fixes) under the same MIT license. Full credit to Numman Ali for creating the original project.

[![Twitter Follow](https://img.shields.io/twitter/follow/nummanali?style=social)](https://x.com/nummanali)
[![Tests](https://github.com/JDis03/opencode-openai-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/JDis03/opencode-openai-codex-auth/actions)
**OpenCode 2 + ChatGPT Codex OAuth.**
[Install](#-quick-start) · [Models](#-models) · [Configuration](#-configuration) · [Docs](#-docs)

---
## 💡 Philosophy
> **"One config. Every model."**
OpenCode should feel effortless. This plugin connects OpenCode 2 to ChatGPT Codex OAuth, with bundled model presets and request transformations.
```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ChatGPT OAuth → Codex backend → OpenCode               │
│  Install the plugin, connect, then choose a model.      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
---
## 🚀 Quick Start
```bash
opencode plugin add @darkjd/opencode-openai-codex-auth
opencode auth login
# Choose openai → "ChatGPT Plus/Pro (Codex Auth)"
opencode run --model 'openai/gpt-6-sol#medium' "Say hello"
```

OpenCode 2 installs packages from its `plugins` configuration. The old `npx opencode-openai-codex-auth` installer writes OpenCode 1 config and is **not** bundled with this scoped OpenCode 2 package. To remove the plugin, use `opencode plugin remove @darkjd/opencode-openai-codex-auth`. Existing OpenCode 1 users should keep their working 4.9.0 installation; the V1 entrypoint remains exported as `@darkjd/opencode-openai-codex-auth/legacy` for manual integrations.
---
## 🆕 OpenCode 2
OpenCode 2 uses a completely new plugin API — V1 plugins (including every release of this
package before this one) do not load at all under OpenCode 2, they fail a schema check
before any of their code runs. This package now ships a native V2 entrypoint alongside the
unchanged V1 one, auto-selected by `exports`:

- The package root (`@darkjd/opencode-openai-codex-auth`) resolves to the **V2** implementation.
- `@darkjd/opencode-openai-codex-auth/legacy` resolves to the **original V1** implementation, for
  anyone still running OpenCode 1.

**How it works under V2**: OpenCode 2 ships its own built-in ChatGPT/Codex OAuth handling
for the `openai` integration (the `ChatGPT Pro/Plus (browser/headless)` methods you may
already see in `opencode auth login`) — but that native path does **not** apply Codex CLI
system instructions, the CODEX_MODE bridge prompt, model-registry-based reasoning
normalization, or the Skills/MCP passthrough this plugin has always provided. This plugin's
V2 build registers native `http.request`/`http.response` session hooks (scoped to the
`openai` provider) to keep applying all of that, plus its **own** OAuth integration method —
**ChatGPT Plus/Pro (Codex Auth)** — with a stable file-based credential store, since V2's
plugin API has no way to import an existing OAuth credential into its built-in connection
store.

**You must complete this plugin's own OAuth method once** for `openai` to route through it:
```bash
opencode auth login
# select "openai" → "ChatGPT Plus/Pro (Codex Auth)"
```
Merely installing the plugin (or already being logged in via OpenCode 2's native ChatGPT
methods) is not enough — an existing V1 `auth.json` credential is imported automatically as
a read-only fallback for token use, but it cannot make OpenCode 2 treat `openai` as
"actively connected" through this plugin's method; only completing that method's login flow
does. See `specs/opencode-v2-plugin-port.md` for the full root-cause investigation.
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

### Additional GPT-6 catalog IDs

CodeNomad/OpenCode currently lists these GPT-6 variants:

- `gpt-6-sol-pro`
- `gpt-6-sol-fast`
- `gpt-6-luna-pro`
- `gpt-6-luna-fast`

These are separate model IDs, not reasoning variants. They are visible in the local OpenCode catalog, but are **not yet verified by this plugin against the ChatGPT Codex backend**. The current Codex CLI account catalog lists the base `gpt-6-sol` and `gpt-6-luna` models, but not these four IDs.

---
## 🧩 Configuration
OpenCode 2 installs the plugin with `opencode plugin add` and obtains its model catalog from OpenCode; no OpenCode 1 config template is needed. The repository's `config/opencode-modern.json` and `config/opencode-legacy.json` are historical **OpenCode 1 examples** and are not shipped in the scoped npm package. Do not paste their `plugin` entry into OpenCode 2.
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

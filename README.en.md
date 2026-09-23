<div align="center">

# ⛏️ AI Mining Daily · ai-daily

**Answering “what happened in AI today” with a daily diff of a model database.**

Not a news aggregator — a **fact diff**. Every word traces back to a data source. No LLM is involved anywhere in the pipeline.

[![Stars](https://img.shields.io/github/stars/hedongli1/ai-daily?style=social&label=Stars)](https://github.com/hedongli1/ai-daily/stargazers)
[![License](https://img.shields.io/github/license/hedongli1/ai-daily)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/hedongli1/ai-daily)](https://github.com/hedongli1/ai-daily/commits/main)
[![Live](https://img.shields.io/badge/%F0%9F%94%97%20Live%20demo-open-brightgreen)](https://hedongli1.github.io/ai-daily/)

[简体中文](README.md) ｜ **English**

🔗 **https://hedongli1.github.io/ai-daily/**

</div>

> ⭐ **If this saves you a scroll every morning, a Star is the best way to keep it free.** Thanks!

The site runs fully automatically twice a day: fetch → diff → publish. The UI is a Minecraft-style pixel-block theme (CSS & SVG **drawn from scratch**, no Mojang assets).

---

## What's on the site

| Section | Content |
|---|---|
| **Today's Dig** | True daily delta vs. yesterday's full snapshot: new models / price changes / context changes / delistings / official posts |
| **Block Plaza** | Headline cards for each event type |
| **Bilibili Vein** | Community intel from public Bilibili search results — what people are talking about today |
| **Domain Leaders** | Epoch per-domain #1 (Language / Multimodal / Vision / Video / Audio / Speech) — only domains that **actually exist** in the raw data |
| **Bios Index** | All first-party models, with **capability search**: type “multimodal” to list every multimodal model |
| **Villages** | Vendors, split into **China / international** |
| **Chronicle** | Full release timeline |

> Capability tags (multimodal / vision / image-gen…) are all derived from `models.dev`'s native `modalities` field — **zero LLM, fully auditable**.

---

## How it works

```
models.dev full snapshot ──┐
                           ├──► diff vs. yesterday ──► five event types ──► site
vendor official posts ─────┤            │
Epoch AI benchmarks ───────┘            └──► evidence links attached to events
```

| Event | Rule |
|---|---|
| **New model** | in today's snapshot, not in yesterday's |
| **Price change** | any `cost.*` field changed |
| **Context change** | `limit.context` changed |
| **Delisting** | in yesterday's snapshot, not in today's |
| **Official post** | new RSS entry (title + link only, never body text) |

Note: new/delisted models are detected by **snapshot diffing**, not by the model's own `release_date` — the latter is the model's release day, not the day *we* learned about it.

---

## 🚨 The biggest gotcha

`models.dev` indexes ~**8,000** entries, but ~**92%** come from **180+ resellers** — API gateways (OpenRouter, NanoGPT), clouds (Amazon Bedrock), hosts (Hugging Face), subscription plans (`*-coding-plan`).

The same model gets indexed by N resellers. On 2026-09-18, `GLM 5.3 FlashX` appeared under **5 different vendors** in a single day. Without filtering, the "new models" feed is drowned by reseller noise.

We tried three statistical signals; **every one had counterexamples**:

| Signal | Counterexample |
|---|---|
| Aggregation rate | **Inverted** — a gateway listing OpenAI makes OpenAI look like a gateway |
| Derivation rate (name contains another's) | **Sibling false positive** — Google's `gemini-2-5-flash-lite` contains `gemini-2-5-flash` |
| Catalog size | Catches the 576-entry NanoGPT, misses the 165-entry Amazon Bedrock |

Conclusion: **this judgment needs human common sense; statistics can't solve it.** The final answer is a **hand-maintained vendor registry** ([`scripts/vendor-registry.js`](scripts/vendor-registry.js)) — currently **33 first-party vendors**. The pipeline prints any unregistered vendor with new models, turning the gap into a visible checklist.

> Result: **620+ first-party model entries** instead of ~8,000 reseller rows.

---

## Data sources & licenses

| Source | Use | License |
|---|---|---|
| [models.dev](https://models.dev) | Model metadata (price / context / open-source / release / modalities) | MIT |
| [Epoch AI](https://epoch.ai) | Third-party benchmark detail | **CC-BY 4.0** |
| Vendor blogs / GitHub | Post titles + links (no body) | respective owners, cited only |
| [Bilibili search](https://search.bilibili.com) | Community intel (public search results) | respective owners, cited only |

**Excluded**: Artificial Analysis (no redistribution), LMArena (no automated scraping).

Attribution in [`NOTICE.md`](NOTICE.md) and the site's `/credits` page.

### No "overall intelligence ranking"

In Epoch AI's raw data, the `Task` column is constant per model — **structurally insufficient** for a cross-benchmark composite rank. Likewise there is no standalone "Code" domain, so we **don't invent a "best at coding" board** either. We only show, honestly, which domain a model is in and its average score.

---

## Run locally

Zero dependencies — only Node.js ≥ 18.

```bash
node scripts/selftest.js        # 78 pure-function assertions, offline
node scripts/fetch.js           # fetch + diff + persist
node scripts/fetch.js --offline # recompute from local raw snapshots, deterministic
node scripts/build-site.js      # compile site data into docs/data/site/
node scripts/build-bilibili.js  # compile Bilibili vein (auto-skips if no raw files)

cd docs && python3 -m http.server 8899   # preview the site
```

---

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Run `node scripts/selftest.js` before changing the pipeline.

---

## License

Code & docs [MIT](LICENSE). Data snapshots follow upstream licenses — see [NOTICE.md](NOTICE.md).

---

<div align="center">

**If it's useful, a ⭐ Star is the best support.**

[⭐ Star](https://github.com/hedongli1/ai-daily/stargazers) · [🐛 Bug](https://github.com/hedongli1/ai-daily/issues/new?template=bug_report.yml) · [💡 Feature](https://github.com/hedongli1/ai-daily/issues/new?template=feature_request.yml)

</div>

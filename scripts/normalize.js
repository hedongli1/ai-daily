// scripts/normalize.js
// 把 models.dev 的原始 payload 展平成一份可 diff 的每日快照。
//
// ── 本项目最核心的一个判断 ──────────────────────────────────────
// models.dev 收录 222 个「厂商」，但真正训练并发布模型的原厂只有几十家，
// 其余是渠道：API 网关（OpenRouter / NanoGPT）、云平台（Bedrock / Vertex）、
// 托管服务（Hugging Face / DeepInfra）、订阅套餐（*-coding-plan）。
//
// 同一个模型会被 N 个渠道重复收录 —— 实测 2026-09-18 的 GLM 5.3 FlashX
// 一天内出现在 5 个条目下。不区分的话，「今日新模型」会被渠道收录动作刷屏。
//
// 区分办法是**白名单查表**，不是启发式。原因见 vendor-registry.js 顶部注释：
// 我试过聚合率、派生率、目录体量三个统计信号，每一个都有反例，每修一次就
// 冒出新反例 —— 这类判断本质上依赖人类常识。
//
// 本文件只负责归一化、去重与优选，不做任何「谁是真厂商」的猜测。

import { normModelName, normalizeDate } from './lib.js';
import { isOriginator, canonicalOf, displayName } from './vendor-registry.js';

export function buildSnapshot(payload, { date }) {
  const vendors = {};
  const flat = [];

  // ---- 1. 展平 ----
  for (const [vid, v] of Object.entries(payload ?? {})) {
    for (const [mid, m] of Object.entries(v?.models ?? {})) {
      flat.push({ vid, mid, m, norm: normModelName(m?.name || mid) });
    }
  }

  // 每个归一名被几家收录 —— 档案页据此显示「N 个渠道有售」
  const sharedOf = new Map();
  {
    const tmp = new Map();
    for (const r of flat) {
      if (!tmp.has(r.norm)) tmp.set(r.norm, new Set());
      tmp.get(r.norm).add(r.vid);
    }
    for (const [k, s] of tmp) sharedOf.set(k, s.size);
  }

  // ---- 2. 厂商：原厂 / 渠道 / 同公司品牌 ----
  for (const [vid, v] of Object.entries(payload ?? {})) {
    const origin = isOriginator(vid);
    const canon = canonicalOf(vid);
    vendors[vid] = {
      id: vid,
      name: displayName(vid, v?.name || vid),
      rawName: v?.name || vid,
      doc: v?.doc || null,
      modelCount: Object.keys(v?.models ?? {}).length,
      // 渠道 = 未登记在注册表里。渠道不产生事件，只在档案页作为「可用渠道」列出。
      isChannel: !origin,
      // 同公司的另一个品牌（如 Z.AI 之于智谱）
      aliasOf: origin && canon !== vid ? canon : null,
    };
  }

  const canonicalVendor = (vid) => canonicalOf(vid);

  // ---- 3. 落成快照条目 ----
  const models = {};
  for (const r of flat) {
    const m = r.m ?? {};
    const cost = m.cost ?? null;
    const canon = canonicalVendor(r.vid);
    const origin = isOriginator(r.vid);
    const rel = normalizeDate(m.release_date);
    const upd = normalizeDate(m.last_updated);
    models[`${r.vid}/${r.mid}`] = {
      name: m.name || r.mid,
      norm: r.norm,
      vendor: canon,
      vendorRaw: r.vid,
      vendorName: displayName(r.vid, vendors[r.vid]?.rawName),
      isOrigin: origin,
      // date 统一为 YYYY-MM-DD 便于排序；precision 记录原始粒度，
      // 只有月粒度的会被站点标成「2026-01（月）」，不假装是精确日期。
      release: rel?.date ?? null,
      releasePrecision: rel?.precision ?? null,
      updated: upd?.date ?? null,
      ctx: m.limit?.context ?? null,
      out: m.limit?.output ?? null,
      in: cost?.input ?? null,
      outCost: cost?.output ?? null,
      cacheRead: cost?.cache_read ?? null,
      open: m.open_weights === true,
      reasoning: m.reasoning === true,
      toolCall: m.tool_call === true,
      // models.dev 原生 modalities 字段（{input:[...], output:[...]}），
      // 用于能力词搜索与模型卡能力标签。diff 只比对 price/ctx/presence，不受影响。
      modalities: m.modalities ?? null,
      shared: sharedOf.get(r.norm) ?? 1,
    };
  }

  const sorted = {};
  for (const k of Object.keys(models).sort()) sorted[k] = models[k];

  const all = Object.values(vendors);
  const originVendors = all.filter((v) => !v.isChannel && !v.aliasOf);

  return {
    schema: 4,
    date,
    source: 'https://models.dev/api.json',
    registrySize: originVendors.length,
    vendorCount: all.length,
    originVendorCount: originVendors.length,
    channelVendorCount: all.filter((v) => v.isChannel).length,
    aliasVendorCount: all.filter((v) => v.aliasOf).length,
    // 原厂发布的模型条目数（渠道收录不重复计入）
    originModelCount: Object.values(models).filter((m) => m.isOrigin).length,
    modelCount: Object.keys(models).length,
    vendors,
    models: sorted,
  };
}

/**
 * 多个条目指向同一个模型时，挑出原厂的那一个。
 *
 * 实测：GLM-5.3-FlashX 同时出现在 zhipuai(原厂) / zai(同品牌) /
 * nano-gpt(渠道) / openrouter(渠道) 四处，这里必须命中 zhipuai。
 * 同属原厂时（如 alibaba 与 alibaba-cn）取目录条目更少的那个。
 */
export function pickCanonical(entries, vendors) {
  const score = (e) => {
    const v = vendors?.[e.vendorRaw ?? e.vendor];
    return [e.isOrigin === true ? 0 : 1, v?.modelCount ?? 1e9];
  };
  return entries.slice().sort((a, b) => {
    const [ga, ca] = score(a);
    const [gb, cb] = score(b);
    return ga - gb || ca - cb;
  })[0];
}

/** 原厂清单，按条目数降序。 */
export function realVendors(snapshot) {
  return Object.values(snapshot.vendors)
    .filter((v) => !v.isChannel && !v.aliasOf)
    .sort((a, b) => b.modelCount - a.modelCount);
}

/**
 * 未登记但有近期新模型的厂商 —— 把注册表的缺口变成可见清单。
 * 只报「有 release_date 落在窗口内的模型」的厂商，避免把数百个渠道全倒出来。
 */
export function unregisteredWithRecentModels(snapshot, { windowDays = 14 } = {}) {
  const cutoff = new Date(new Date(snapshot.date + 'T00:00:00Z').getTime() - windowDays * 86400000)
    .toISOString()
    .slice(0, 10);

  const hits = new Map();
  for (const m of Object.values(snapshot.models)) {
    if (m.isOrigin || m.release == null || m.release < cutoff) continue;
    const e = hits.get(m.vendorRaw) ?? { id: m.vendorRaw, name: m.vendorName, count: 0, sample: m.name };
    e.count++;
    hits.set(m.vendorRaw, e);
  }
  return [...hits.values()].sort((a, b) => b.count - a.count);
}

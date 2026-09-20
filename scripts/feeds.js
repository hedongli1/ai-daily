// scripts/feeds.js
// 证据层：抓官方公告，按厂商与时间窗挂到事实事件上。
//
// 只取标题 / 链接 / 时间，**不抓正文、不加工文案**。这是「零 LLM」原则的
// 边界所在：站上每一句话要么来自结构化字段，要么来自原文标题本身。
//
// 最小 RSS / Atom 解析器：不引第三方库，只用正则取 <item>/<entry>。

import { fetchJson, fetchText, stripHtml, todayISO } from './lib.js';

/** 极简 RSS 2.0 / Atom 解析。够用即可，不追求规范完备。 */
export function parseFeed(xml, { limit = 40 } = {}) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];

  for (const block of blocks.slice(0, limit)) {
    const pick = (tag) => {
      const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? stripHtml(m[1]) : null;
    };
    // Atom 的链接在属性上
    const linkAttr = block.match(/<link\b[^>]*href=["']([^"']+)["']/i);
    const title = pick('title');
    if (!title) continue;
    items.push({
      title,
      url: linkAttr ? linkAttr[1] : pick('link'),
      date:
        toDate(pick('pubDate')) ??
        toDate(pick('published')) ??
        toDate(pick('updated')) ??
        toDate(pick('dc:date')),
    });
  }
  return items;
}

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 抓所有 RSS 源。单个源失败只记录状态，不影响其它源。 */
export async function fetchRssSources(sources, { log = console.log } = {}) {
  const results = [];
  for (const src of sources.rss ?? []) {
    const entry = { id: src.id, vendor: src.vendor, label: src.label, url: src.url, items: [], status: 'ok' };
    try {
      const xml = await fetchText(src.url, { timeout: 30000, retries: 1 });
      entry.items = parseFeed(xml);
      if (!entry.items.length) entry.status = 'empty';
    } catch (err) {
      entry.status = 'failed';
      entry.error = String(err?.message ?? err).slice(0, 120);
      log(`  ⚠️  RSS ${src.label} 抓取失败：${entry.error}（已降级，不影响其它源）`);
    }
    results.push(entry);
  }
  return results;
}

/** 抓各厂商 GitHub org 的近期 release，作为无 RSS 厂商的兜底证据源。 */
export async function fetchGithubSources(sources, { token = '', log = console.log } = {}) {
  const results = [];
  for (const src of sources.github ?? []) {
    const entry = { id: src.id, vendor: src.vendor, label: src.label, items: [], status: 'ok' };
    try {
      const headers = { Accept: 'application/vnd.github+json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const url = `https://api.github.com/orgs/${src.org}/repos?sort=updated&per_page=100`;
      const repos = await fetchJson(url, { headers, timeout: 30000, retries: 1 });
      const since = Date.now() - 14 * 86400000;
      for (const repo of (Array.isArray(repos) ? repos : []).slice(0, 20)) {
        if (!repo.pushed_at || new Date(repo.pushed_at).getTime() < since) continue;
        entry.items.push({
          title: `${repo.name} · ${repo.description ?? '仓库更新'}`.slice(0, 200),
          url: `${repo.html_url}/releases`,
          date: repo.pushed_at,
        });
      }
      if (!entry.items.length) entry.status = 'empty';
    } catch (err) {
      entry.status = 'failed';
      entry.error = String(err?.message ?? err).slice(0, 120);
      log(`  ⚠️  GitHub ${src.label} 抓取失败：${entry.error}（已降级）`);
    }
    results.push(entry);
  }
  return results;
}

/** 把 feed 条目转成 news 事件。 */
export function feedItemsToEvents(feedResults, { date, windowDays = 2 } = {}) {
  const cutoff = new Date(new Date(date + 'T00:00:00Z').getTime() - windowDays * 86400000).toISOString().slice(0, 10);
  const events = [];
  for (const src of feedResults) {
    for (const item of src.items) {
      const d = (item.date ?? '').slice(0, 10);
      if (!d || d < cutoff) continue;
      events.push({
        type: 'news',
        key: null,
        vendor: src.vendor,
        vendorName: src.label,
        name: item.title,
        date: d,
        facts: {},
        text: item.title,
        href: item.url,
        source: src.label,
        external: true,
      });
    }
  }
  return events;
}

/**
 * 把 news 事件挂到同厂商、±24h 窗口内的事实事件上，作为「证据」。
 * 挂不上的 news 保留为独立条目 —— 它仍然是「今天发生的事」的一部分。
 */
export function attachEvidence(events) {
  const facts = events.filter((e) => e.type !== 'news');
  const news = events.filter((e) => e.type === 'news');

  for (const n of news) {
    const t = new Date(n.date + 'T00:00:00Z').getTime();
    const best = facts
      .filter((f) => f.vendor === n.vendor)
      .map((f) => ({ f, delta: Math.abs(new Date(f.date + 'T00:00:00Z').getTime() - t) }))
      .filter((x) => x.delta <= 86400000)
      .sort((a, b) => a.delta - b.delta)[0];

    if (best) {
      (best.f.evidence ??= []).push({ title: n.text, url: n.href, source: n.source });
      n.attachedTo = best.key ?? best.name;
    }
  }
  return { facts, news };
}

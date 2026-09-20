// scripts/fetch.js
// 每日管线入口：抓取 -> 归一化 -> 差分 -> 挂证据 -> 落盘。
//
// 用法：
//   node scripts/fetch.js              正常抓取
//   node scripts/fetch.js --offline    只用本地已有的 raw 快照复算（不联网、确定性）
//   node scripts/fetch.js --date=2026-09-20   指定日期（默认今天）
//
// 设计原则（沿用 reverse-radar 的教训）：
//   1. 单源失败绝不拖垮整站 —— 每个源独立 try/catch，只标记 degraded。
//   2. 快照必须在每天固定时刻拍 —— 时刻不固定，差值就没有意义。
//   3. 首跑无基线时优雅降级 —— 只写基线，显式标记 backfill，不冒充真实增量。

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, fetchJson, todayISO, log } from './lib.js';
import { buildSnapshot, unregisteredWithRecentModels } from './normalize.js';
import { diffSnapshots, backfillFromReleaseDates, countByType, sortEvents } from './diff.js';
import { fetchRssSources, fetchGithubSources, feedItemsToEvents, attachEvidence } from './feeds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const SNAPSHOT_DIR = path.join(DATA, 'snapshot');
const RAW_DIR = path.join(DATA, 'raw');
const EVENTS_DIR = path.join(DATA, 'events');

const argv = process.argv.slice(2);
const OFFLINE = argv.includes('--offline');
const dateArg = argv.find((a) => a.startsWith('--date='))?.slice(7);
const DATE = dateArg || todayISO();

async function loadSources() {
  return readJson(path.join(ROOT, 'scripts', 'sources.json'));
}

/** 找到今天之前最近的一份快照作为基线。 */
async function findBaseline(today) {
  const { promises: fs } = await import('node:fs');
  let files;
  try {
    files = (await fs.readdir(SNAPSHOT_DIR)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return null;
  }
  const prior = files.map((f) => f.replace('.json', '')).filter((d) => d < today);
  if (!prior.length) return null;
  const pick = prior[prior.length - 1];
  const snap = await readJson(path.join(SNAPSHOT_DIR, `${pick}.json`));
  return snap ? { ...snap, _baselineDate: pick } : null;
}

async function main() {
  log(`\n📅 ai-daily 管线 · ${DATE}${OFFLINE ? '（离线模式）' : ''}\n`);

  const sources = await loadSources();

  // ---------- 1. 抓取 ----------
  let payload;
  if (OFFLINE) {
    payload = await readJson(path.join(RAW_DIR, `${DATE}.json`));
    if (!payload) throw new Error(`离线模式下找不到 ${DATE} 的原始快照，请先联网跑一次`);
    log(`  ✓ 从本地读取 models.dev 原始快照`);
  } else {
    log(`  → 拉取 models.dev …`);
    payload = await fetchJson(sources.modelsDev, { timeout: 60000 });
    await writeJson(path.join(RAW_DIR, `${DATE}.json`), payload);
    log(`  ✓ models.dev 已保存（${Object.keys(payload).length} 个厂商节点）`);
  }

  // ---------- 2. 归一化 ----------
  const snapshot = buildSnapshot(payload, { date: DATE });
  log(
    `  ✓ 归一化：${snapshot.modelCount} 条模型条目 · ${snapshot.vendorCount} 个厂商节点`
  );
  log(
    `  ✓ 原厂识别：登记原厂 ${snapshot.originVendorCount} 家（${snapshot.originModelCount} 条模型）· ` +
      `渠道 ${snapshot.channelVendorCount} 家 · 同公司品牌 ${snapshot.aliasVendorCount} 家`
  );

  // ---------- 3. 差分 ----------
  const baseline = await findBaseline(DATE);
  let factEvents;
  let mode;

  if (baseline) {
    factEvents = diffSnapshots(baseline, snapshot);
    mode = 'diff';
    log(`  ✓ 与基线 ${baseline._baselineDate} 差分：产出 ${factEvents.length} 条事实事件`);
  } else {
    factEvents = backfillFromReleaseDates(snapshot, { days: 3 });
    mode = 'backfill';
    log(`  ⚠️  仓库中无历史快照（首跑）· 已按 release_date 回填最近 3 天：${factEvents.length} 条`);
    log(`     明日同一时刻跑第二次，才会产出真实的「相比昨天」增量。`);
  }

  // ---------- 4. 证据层 ----------
  let feedResults = [];
  const degraded = [];
  if (!OFFLINE) {
    log(`  → 抓取官方公告源 …`);
    const rss = await fetchRssSources(sources);
    const gh = await fetchGithubSources(sources, { token: process.env.GITHUB_TOKEN || '' });
    feedResults = [...rss, ...gh];
    for (const f of feedResults) {
      if (f.status === 'failed') degraded.push(`${f.label}(${f.status})`);
    }
    const okCount = feedResults.filter((f) => f.status === 'ok').length;
    log(`  ✓ 证据源：${okCount}/${feedResults.length} 正常${degraded.length ? ` · 降级：${degraded.join(' ')}` : ''}`);
  } else {
    feedResults = (await readJson(path.join(DATA, `feeds-${DATE}.json`), [])) ?? [];
  }
  await writeJson(path.join(DATA, `feeds-${DATE}.json`), feedResults.map((f) => ({
    id: f.id, label: f.label, vendor: f.vendor, status: f.status,
    count: f.items?.length ?? 0, error: f.error ?? null,
  })));

  const newsEvents = feedItemsToEvents(feedResults, { date: DATE });
  const all = sortEvents([...factEvents, ...newsEvents]);
  const { facts, news } = attachEvidence(all);
  const attached = news.filter((n) => n.attachedTo).length;

  // ---------- 5. 落盘 ----------
  await writeJson(path.join(SNAPSHOT_DIR, `${DATE}.json`), snapshot);
  const out = {
    schema: 1,
    date: DATE,
    mode,
    baselineDate: baseline?._baselineDate ?? null,
    counts: { ...countByType(all), facts: facts.length, news: news.length, newsAttached: attached },
    degraded,
    sources: feedResults.map((f) => ({ id: f.id, label: f.label, status: f.status, count: f.items?.length ?? 0 })),
    events: all,
  };
  await writeJson(path.join(EVENTS_DIR, `${DATE}.json`), out);
  await writeJson(path.join(DATA, 'latest.json'), out);

  // ---------- 6. 报告 ----------
  log(`\n📊 ${DATE} 战报`);
  log(`   新模型 ${out.counts.new} · 调价 ${out.counts.price} · 上下文变更 ${out.counts.context} · 下架 ${out.counts.retired}`);
  log(`   官方公告 ${out.counts.news} 条（其中 ${attached} 条已挂到对应模型事件上）`);
  if (degraded.length) log(`   ⚠️  降级源：${degraded.join(' ')}`);

  const top = all.filter((e) => e.type === 'new').slice(0, 10);
  if (top.length) {
    log(`\n🆕 今日新模型（前 ${top.length} 条）`);
    for (const e of top) log(`   ${e.vendorName.padEnd(16)} ${e.text}`);
  } else {
    log(`\n· 今日无原厂新模型发布。`);
  }

  // 注册表缺口：未登记、但最近有新模型的厂商。渠道会占绝大多数（正常），
  // 但若出现真正的原厂，这里就是该补一行注册表的地方。
  const missing = unregisteredWithRecentModels(snapshot, { windowDays: 14 });
  if (missing.length) {
    log(`\n🔎 注册表缺口 ${missing.length} 家（未登记但有近 14 天新模型）`);
    log(`   多数是渠道，属正常。若发现真原厂，请补进 scripts/vendor-registry.js：`);
    for (const m of missing.slice(0, 8)) log(`   ${String(m.count).padStart(3)}条  ${m.id}  (${m.name})`);
    if (missing.length > 8) log(`   …另有 ${missing.length - 8} 家`);
  }

  if (mode === 'backfill') {
    log(`\n⚠️  本次是首跑回填（按 release_date），不是真实的「相比昨天」增量。`);
  }
  log(`\n✅ 已写入 docs/data/snapshot/${DATE}.json 与 docs/data/events/${DATE}.json\n`);
}

main().catch((err) => {
  console.error('\n❌ 管线失败：', err);
  process.exit(1);
});

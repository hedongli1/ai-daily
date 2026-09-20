// scripts/build-site.js
// 把当日快照与事件编译成站点消费的紧凑 JSON。
//
// 站点本身是零依赖静态页（docs/index.html + app.js），不做任何数据加工 ——
// 所有加工都在这里完成，浏览器只负责渲染。这样站点不会有构建失败这种故障模式，
// GitHub Pages 可以直接从分支发布，不需要 CI 跑 npm install。
//
//   node scripts/build-site.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, todayISO, log, normModelName } from './lib.js';
import { realVendors } from './normalize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const SITE = path.join(DATA, 'site');

const argv = process.argv.slice(2);
const DATE = argv.find((a) => a.startsWith('--date='))?.slice(7) || todayISO();

/** 字段名压到最短 —— 610 个模型每条省几个字节，整体体积能少三分之一。 */
function slimModel(m) {
  return {
    n: m.norm,
    name: m.name,
    v: m.vendor,
    vn: m.vendorName,
    rel: m.release,
    relP: m.releasePrecision,
    ctx: m.ctx,
    out: m.out,
    in: m.in,
    oc: m.outCost,
    cr: m.cacheRead,
    open: m.open ? 1 : 0,
    rsn: m.reasoning ? 1 : 0,
    tool: m.toolCall ? 1 : 0,
    // 有几家渠道在售 —— 原厂自营也算一路，所以最小是 1
    ch: m.shared,
    rel_ts: m.release ? Date.parse(m.release) : null,
  };
}

async function main() {
  log(`\n🏗  编译站点数据 · ${DATE}\n`);

  const snapshot = await readJson(path.join(DATA, 'snapshot', `${DATE}.json`));
  if (!snapshot) throw new Error(`找不到 ${DATE} 的快照，请先跑 scripts/fetch.js`);

  const events = await readJson(path.join(DATA, 'events', `${DATE}.json`));
  if (!events) throw new Error(`找不到 ${DATE} 的事件，请先跑 scripts/fetch.js`);

  // ---- 只把原厂模型送进站点 ----
  // 渠道条目留在快照里备查，但不进站点数据：7868 条里 92% 是渠道转售的重复，
  // 全发到浏览器纯属浪费，而且会把「今天发生了什么」淹掉。
  const originModels = Object.values(snapshot.models)
    .filter((m) => m.isOrigin)
    .map(slimModel);

  await writeJson(path.join(SITE, 'models.json'), {
    date: DATE,
    count: originModels.length,
    models: originModels,
  });

  // ---- 第三方评测（Epoch AI，CC-BY 4.0）----
  // 按归一名匹配。匹配不上的直接丢弃 —— 宁可少显示，也不猜错分数归属。
  const epoch = await readJson(path.join(DATA, 'bench', 'epoch.json'));
  const bench = {};
  let matched = 0;
  if (epoch?.models) {
    const byNorm = new Map();
    for (const m of epoch.models) {
      const key = normModelName(m.model);
      // 同一归一名出现多次时取运行次数最多的那份
      const prev = byNorm.get(key);
      if (!prev || m.nRuns > prev.nRuns) byNorm.set(key, m);
    }
    for (const m of originModels) {
      const hit = byNorm.get(m.n);
      if (!hit) continue;
      matched++;
      bench[m.n] = { runs: hit.nRuns, domains: hit.domains, rel: hit.release, name: hit.model };
    }
  }
  await writeJson(path.join(SITE, 'bench.json'), {
    date: DATE,
    source: epoch?.source ?? null,
    license: epoch?.license ?? null,
    attribution: epoch?.attribution ?? null,
    honesty: epoch?.honesty ?? null,
    count: matched,
    bench,
  });

  // ---- 厂商 ----
  const vendors = realVendors(snapshot).map((v) => {
    const mine = originModels.filter((m) => m.v === v.id);
    const prices = mine.map((m) => m.in).filter((x) => x != null);
    return {
      id: v.id,
      name: v.name,
      n: mine.length,
      cheapest: prices.length ? Math.min(...prices) : null,
      latest: mine.map((m) => m.rel).filter(Boolean).sort().pop() ?? null,
    };
  });
  await writeJson(path.join(SITE, 'vendors.json'), { date: DATE, vendors });

  // ---- 时间线（按发布日倒序，供时间轴页）----
  const timeline = originModels
    .filter((m) => m.rel)
    .sort((a, b) => (a.rel < b.rel ? 1 : -1))
    .map((m) => ({ n: m.n, name: m.name, vn: m.vn, rel: m.rel, ctx: m.ctx, in: m.in, open: m.open }));
  await writeJson(path.join(SITE, 'timeline.json'), { date: DATE, timeline });

  // ---- 格局：几块领奖台（全部由字段算出，不经任何模型）----
  const withCtx = originModels.filter((m) => m.ctx != null);
  const withPrice = originModels.filter((m) => m.in != null && m.in > 0);
  const newest = originModels.slice().sort((a, b) => String(b.rel ?? '').localeCompare(String(a.rel ?? '')));
  const cnVendors = new Set(['alibaba', 'deepseek', 'moonshotai', 'zhipuai', 'minimax', 'xiaomi', 'stepfun', 'sensenova', 'volcengine', 'bailing', 'longcat', 'tencent-tokenhub']);

  const board = {
    latest: newest.slice(0, 1).map((m) => ({ n: m.n, name: m.name, vn: m.vn, val: m.rel, metric: '发布日期' })),
    longestCtx: withCtx.slice().sort((a, b) => b.ctx - a.ctx).slice(0, 1)
      .map((m) => ({ n: m.n, name: m.name, vn: m.vn, val: m.ctx, metric: '上下文' })),
    cheapest: withPrice.slice().sort((a, b) => a.in - b.in).slice(0, 1)
      .map((m) => ({ n: m.n, name: m.name, vn: m.vn, val: m.in, metric: '输入价' })),
    priciest: withPrice.slice().sort((a, b) => b.in - a.in).slice(0, 1)
      .map((m) => ({ n: m.n, name: m.name, vn: m.vn, val: m.in, metric: '输入价' })),
    cnStrongest: withCtx.filter((m) => cnVendors.has(m.v)).sort((a, b) => (b.ctx ?? 0) - (a.ctx ?? 0)).slice(0, 1)
      .map((m) => ({ n: m.n, name: m.name, vn: m.vn, val: m.ctx, metric: '上下文' })),
    openStrongest: withCtx.filter((m) => m.open === 1).sort((a, b) => (b.ctx ?? 0) - (a.ctx ?? 0)).slice(0, 1)
      .map((m) => ({ n: m.n, name: m.name, vn: m.vn, val: m.ctx, metric: '上下文' })),
    mostChannels: originModels.slice().sort((a, b) => b.ch - a.ch).slice(0, 1)
      .map((m) => ({ n: m.n, name: m.name, vn: m.vn, val: m.ch, metric: '渠道数' })),
  };
  await writeJson(path.join(SITE, 'board.json'), { date: DATE, board });

  // ---- 概览 ----
  await writeJson(path.join(SITE, 'summary.json'), {
    date: DATE,
    mode: events.mode,
    baselineDate: events.baselineDate,
    counts: events.counts,
    degraded: events.degraded,
    sources: events.sources,
    totals: {
      originVendors: snapshot.originVendorCount,
      originModels: snapshot.originModelCount,
      channels: snapshot.channelVendorCount,
      allEntries: snapshot.modelCount,
    },
  });

  // ---- 事件（原样搬过来，站点不重新加工）----
  await writeJson(path.join(SITE, 'events.json'), {
    date: DATE,
    mode: events.mode,
    baselineDate: events.baselineDate,
    events: events.events,
  });

  log(`  ✓ models.json    ${originModels.length} 个原厂模型`);
  log(`  ✓ vendors.json   ${vendors.length} 家原厂`);
  log(`  ✓ timeline.json  ${timeline.length} 条时间线`);
  log(`  ✓ board.json     格局领奖台`);
  log(`  ✓ events.json    ${events.events.length} 条事件`);
  log(`  ✓ summary.json   概览\n`);
}

main().catch((err) => {
  console.error('\n❌ 站点数据编译失败：', err);
  process.exit(1);
});

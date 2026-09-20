// scripts/fetch-bench.js
// 第三方评测层：抓 Epoch AI 的 benchmark 明细。
//
// ⚠️ 关于这份数据的诚实说明（站点 /about 页会原样公示）：
//   · Epoch 的 benchmarks.csv 里，`Task` 列对同一个模型是常量（一组能力标签），
//     不是逐个 benchmark 的名字。所以**不能**据此算出「综合智力世界第 N」。
//     本站只如实展示：该模型被 Epoch 评测过多少次、在哪个 Domain、平均/最佳分。
//   · 因此本站不提供「智力排名」。想看排名请去 Epoch 原始看板或 ai-model-world。
//   · 许可 CC-BY 4.0，署名义务见 NOTICE.md 与 /credits 页。
//
//   node scripts/fetch-bench.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, writeJson, todayISO, log } from './lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'data', 'bench', 'epoch.json');
const SOURCE = 'https://epoch.ai/data/benchmarks.csv';

/** CSV 解析：处理引号包裹与转义引号。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 把 Epoch 的行聚合成「每个模型一份」的评测画像。 */
export function aggregate(rows) {
  const head = rows[0];
  const idx = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  for (const need of ['id_runs', 'Model', 'Version release date', 'Domain', 'Best score (across scorers)']) {
    if (idx[need] === undefined) throw new Error(`Epoch CSV 缺少列: ${need}`);
  }

  const seen = new Set();
  const byModel = new Map();
  let dup = 0;

  for (const r of rows.slice(1)) {
    const id = r[idx['id_runs']];
    if (!id) continue;
    if (seen.has(id)) {
      dup++;
      continue;
    }
    seen.add(id);

    const model = (r[idx['Model']] || '').trim();
    if (!model) continue;
    const score = parseFloat(r[idx['Best score (across scorers)']]);
    if (!Number.isFinite(score)) continue;

    const release = (r[idx['Version release date']] || '').trim().slice(0, 10) || null;
    const domain = (r[idx['Domain']] || '').trim() || '(未标注)';

    const key = model.toLowerCase();
    if (!byModel.has(key)) byModel.set(key, { model, release, runs: {}, n: 0 });
    const e = byModel.get(key);
    if (!e.release && release) e.release = release;
    e.n++;
    (e.runs[domain] ??= []).push(score);
  }

  const models = [...byModel.values()]
    .map((e) => {
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      return {
        model: e.model,
        release: e.release,
        nRuns: e.n,
        domains: Object.fromEntries(
          Object.entries(e.runs).map(([k, v]) => [
            k,
            { n: v.length, avg: Number(avg(v).toFixed(4)), best: Number(Math.max(...v).toFixed(4)) },
          ])
        ),
      };
    })
    .sort((a, b) => b.nRuns - a.nRuns);

  return { models, dup, total: seen.size };
}

async function main() {
  log(`\n📐 抓取 Epoch AI 评测数据\n`);
  const text = await fetchText(SOURCE, { timeout: 120000, retries: 2 });
  const { models, dup, total } = aggregate(parseCsv(text));

  await writeJson(OUT, {
    generated: todayISO(),
    source: SOURCE,
    license: 'CC-BY 4.0',
    attribution: 'Benchmark data from Epoch AI (epoch.ai), licensed CC-BY 4.0',
    honesty:
      'Task 列对同一模型为常量，无法据此算出综合排名。本站只展示运行次数与域内均分，不提供智力排名。',
    count: models.length,
    models,
  });

  log(`  ✓ 解析 ${total} 次运行（去重跳过 ${dup} 行）· ${models.length} 个模型`);
  log(`  ✓ 已写入 docs/data/bench/epoch.json\n`);
}

// 作为脚本直接运行时才执行，被 import（如自检）时不联网
if (process.argv[1] && process.argv[1].endsWith('fetch-bench.js')) {
  main().catch((err) => {
    console.error('\n❌ Epoch 抓取失败：', err);
    process.exit(1);
  });
}

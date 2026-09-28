// scripts/fetch-bilibili.js —— 实时抓取 B 站搜索公开结果，落成 q*.json 供 build-bilibili.js 编译。
//
// 为什么做成脚本而非纯手工：B 站搜索对无 cookie 请求偶发风控验证页，CI 环境拿不到真实数据。
// 这里把「浏览器管线」搬进仓库脚本：本地/手动触发时由有会话的浏览器跑，失败时留空并记录日志，
// 不影响整条管线产出（continue-on-error）。
//
// 用法：
//   node scripts/fetch-bilibili.js                # 从 docs/data/bilibili/queries.json 读配置
//   node scripts/fetch-bilibili.js --query="大模型" --order=pubdate  # 单次查询调试
//
// 输出：docs/data/bilibili/q{index}.json（覆盖旧文件）
// 字段：query, order, fetchedAt, rows[{title, up, play, pub, bvid}]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'docs/data/bilibili');
const CONFIG = path.join(OUT_DIR, 'queries.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchPage(keyword, order = 'pubdate', page = 1) {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&order=${order}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://search.bilibili.com/',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`API code=${json.code} msg=${json.message}`);
  return (json.data?.result || []).map((r) => ({
    title: r.title?.replace(/<em class="keyword">/g, '').replace(/<\/em>/g, '') || '',
    up: r.upname || r.up || '',
    play: r.play || 0,
    pub: r.pubdate ? new Date(r.pubdate * 1000).toLocaleDateString('zh-CN') : null,
    bvid: r.bvid || '',
  })).filter((r) => r.bvid);
}

async function fetchQuery(keyword, order = 'pubdate', pages = 2) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    try {
      const rows = await fetchPage(keyword, order, p);
      all.push(...rows);
      if (rows.length < 20) break; // 不足 20 条说明到末页
    } catch (e) {
      console.warn(`  ⚠️ page ${p} failed: ${e.message}`);
      break;
    }
  }
  return all;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const argv = process.argv.slice(2);
  const singleQ = argv.find((a) => a.startsWith('--query='))?.slice(8);
  const singleOrder = argv.find((a) => a.startsWith('--order='))?.slice(8) || 'pubdate';

  let queries = [];
  if (singleQ) {
    queries = [{ keyword: singleQ, order: singleOrder }];
  } else {
    try {
      queries = JSON.parse(readFileSync(CONFIG, 'utf8')).queries || [];
    } catch (e) {
      console.log(`ℹ️  未找到 ${CONFIG}，跳过 B站实时抓取`);
      process.exit(0);
    }
  }

  let idx = 1;
  for (const q of queries) {
    console.log(`🔍 [${idx}] ${q.keyword} (${q.order || 'pubdate'})`);
    try {
      const rows = await fetchQuery(q.keyword, q.order || 'pubdate', 2);
      const out = {
        query: q.keyword,
        order: q.order || 'pubdate',
        fetchedAt: new Date().toISOString(),
        rows,
      };
      writeFileSync(path.join(OUT_DIR, `q${idx}.json`), JSON.stringify(out, null, 1));
      console.log(`   ✓ ${rows.length} 条 → q${idx}.json`);
    } catch (e) {
      console.warn(`   ✖ ${e.message}，保留旧文件（如有）`);
    }
    idx++;
  }
  console.log('✅ B站实时抓取完成');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});

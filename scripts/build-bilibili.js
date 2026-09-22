// scripts/build-bilibili.js —— 把 B站原始抓取文件编译成站点消费的 docs/data/site/bilibili.json
//
// 数据流：
//   浏览器管线（B站搜索技能）抓取 → 人工/助手落盘为 docs/data/bilibili/q*.json
//   → 本脚本去重、换算日期、打话题标签 → docs/data/site/bilibili.json
//
// 为什么不直接联网抓：B站搜索对无 cookie 的请求做风控（返回验证页而非数据），
// CI 环境里拿不到真实结果。与其假装自动，不如把抓取做成浏览器侧管线、
// 把编译做成可复现的仓库脚本，两边职责分清。
//
// 用法：
//   node scripts/build-bilibili.js            # 从 docs/data/bilibili/ 编译
//   node scripts/build-bilibili.js /path/dir  # 指定原始文件目录

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = process.argv[2] ?? path.join(ROOT, 'docs/data/bilibili');
const OUT = path.join(ROOT, 'docs/data/site/bilibili.json');

const DAY = 86400000;

// B站搜索页只给相对时间（"N分钟前 / N小时前 / 昨天 / N天前"），
// 以该查询文件的抓取时刻（fetchedAt）为基准换算近似日期，并用 dateApprox 标注。
function parsePub(pub, base) {
  const d = (back) => new Date(base.getTime() - back).toISOString().slice(0, 10);
  if (!pub) return { date: null, dateApprox: true };
  let m;
  if ((m = pub.match(/^(\d+)分钟前/))) return { date: d(+m[1] * 60000), dateApprox: true };
  if ((m = pub.match(/^(\d+)小时前/))) return { date: d(+m[1] * 3600000), dateApprox: true };
  if (pub.startsWith('昨天')) return { date: d(DAY), dateApprox: true };
  if ((m = pub.match(/^(\d+)天前/))) return { date: d(+m[1] * DAY), dateApprox: true };
  if (/^\d{4}-\d{2}-\d{2}/.test(pub)) return { date: pub.slice(0, 10), dateApprox: false };
  return { date: null, dateApprox: true };
}

// 话题标签：确定性规则，零 LLM。只标标题里真实出现的词。
const TOPIC_RULES = [
  ['MiMo', /mimo/i], ['Grok', /grok/i], ['Jev', /\bjev\b/i], ['阶跃Step', /阶跃|step\s*5/i],
  ['Qwen', /qwen|通义千问/i], ['DeepSeek', /deepseek/i], ['Kimi', /kimi/i],
  ['GPT/OpenAI', /gpt|openai|open ai/i], ['Claude/Opus', /claude|opus/i], ['Gemini', /gemini/i],
  ['GLM/智谱', /glm|智谱/i], ['Laya', /\blaya\b/i], ['Agent', /agent|智能体/i],
  ['开源', /开源/i], ['评测', /评测|测评|实测|测试|跑分|横评|首发/i],
  ['多模态', /多模态|multimodal|vl\b|vision|视觉|图像|视频生成/i],
  ['具身智能', /具身|机器人|vla\b/i], ['教程', /教程|入门|实战|零基础|保姆级|课程|攻略|上手/i],
  ['硬件跑模型', /mac|显卡|本地跑|迷你主机|内存|算力|m5\s*ultra/i], ['RAG', /\brag\b/i],
];
const topicsOf = (title) => {
  const t = [];
  for (const [label, re] of TOPIC_RULES) if (re.test(title)) t.push(label);
  return t.slice(0, 4);
};

function main() {
  if (!existsSync(SRC)) {
    console.log(`ℹ️  未找到 ${SRC}，跳过 B站矿脉编译（首次使用请先放入 q*.json 原始抓取文件）`);
    process.exit(0);
  }
  const files = readdirSync(SRC).filter((f) => /^q\d+\.json$/.test(f)).sort();
  if (!files.length) {
    console.log('ℹ️  docs/data/bilibili 里没有 q*.json，跳过');
    process.exit(0);
  }

  // 合并 + 按 bvid 去重（同一视频出现在多个查询时保留较多播放数、合并查询来源）
  const byBvid = new Map();
  const queryNames = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(path.join(SRC, f), 'utf8'));
    queryNames.push(d.query);
    const base = new Date(d.fetchedAt);
    for (const r of d.rows ?? []) {
      const { date, dateApprox } = parsePub(r.pub, base);
      const cur = byBvid.get(r.bvid);
      if (cur) {
        if (!cur.queries.includes(d.query)) cur.queries.push(d.query);
        if ((r.play ?? 0) > cur.play) cur.play = r.play;
      } else {
        byBvid.set(r.bvid, {
          title: r.title, up: r.up, play: r.play ?? 0, pub: r.pub,
          date, dateApprox, bvid: r.bvid,
          url: `https://www.bilibili.com/video/${r.bvid}/`,
          queries: [d.query],
        });
      }
    }
  }

  const videos = [...byBvid.values()]
    .map((v) => ({ ...v, topics: topicsOf(v.title), hot: v.play >= 1000, likes: null }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.play - a.play);

  const byQuery = {};
  for (const v of videos) for (const q of v.queries) (byQuery[q] ??= []).push(v.bvid);

  const out = {
    generated: new Date().toISOString(),
    source: 'B站搜索（公开结果，按最新排序）',
    queries: queryNames,
    count: videos.length,
    hotCount: videos.filter((v) => v.hot).length,
    videos, byQuery,
    honesty: '数据来自B站搜索公开结果页，由浏览器管线抓取后以 q*.json 入库、本脚本编译。发布日期由「N分钟/小时/天前」相对时间按抓取时刻推算，已用 dateApprox 标注。搜索页不含点赞数，likes 恒为 null。视频观点为UP主个人创作，不代表事实结论。',
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`✅ bilibili.json ← ${files.length} 个查询 · ${videos.length} 条去重视频 · 热点 ${out.hotCount} 条`);
}

main();

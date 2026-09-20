// scripts/selftest.js
// 纯函数自检。不联网、不读磁盘，同样的输入永远得到同样的结论。
// 覆盖：名称归一化、原厂/渠道判定、同公司品牌合并、原厂优选、
//       五类事件差分、文案模板、RSS 解析、证据挂载、注册表缺口。
//
//   node scripts/selftest.js

import { normModelName, formatContext, formatCost, stripHtml } from './lib.js';
import {
  buildSnapshot, pickCanonical, realVendors, unregisteredWithRecentModels,
} from './normalize.js';
import { isOriginator, canonicalOf, displayName, REGISTRY } from './vendor-registry.js';
import { diffSnapshots, describeNew, describePrice, backfillFromReleaseDates } from './diff.js';
import { parseFeed, attachEvidence } from './feeds.js';

let passed = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed++;
  else failures.push(`${label}\n      期望 ${e}\n      实得 ${a}`);
}
const ok = (cond, label) => (cond ? passed++ : failures.push(label));

const MODEL = (name, extra = {}) => ({
  name,
  release_date: '2026-09-18',
  last_updated: '2026-09-18',
  limit: { context: 131072, output: 8192 },
  cost: { input: 0.5, output: 1.5 },
  open_weights: false,
  reasoning: true,
  tool_call: true,
  ...extra,
});
const vendor = (id, name, n, prefix, extra = {}) => ({
  id,
  name,
  models: Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`${id}-${i}`, MODEL(`${prefix}-${i}`, extra)])
  ),
});

// ---------- 1. 名称归一化 ----------
eq(normModelName('GLM-5.3-FlashX'), 'glm-5-3-flashx', '归一化：连字符');
eq(normModelName('GLM 5.3 FlashX'), 'glm-5-3-flashx', '归一化：空格与连字符版一致');
eq(normModelName('Z.ai: GLM 5.3 FlashX'), 'glm-5-3-flashx', '归一化：去掉渠道前缀');
eq(normModelName('muse-spark-1.3_xhigh'), 'muse-spark-1-3-xhigh', '归一化：下划线');
eq(normModelName('Gemma 4 26B A4B (free)'), 'gemma-4-26b-a4b', '归一化：去掉括号限定词');
eq(normModelName('openai/gpt-6-astra'), 'gpt-6-astra', '归一化：斜杠前缀');
eq(normModelName('  '), '', '归一化：空串');
// 关键断言：渠道写法与官方写法必须归一成同一个 key，否则去重与优选全部失效
eq(
  normModelName('Z.ai: GLM 5.3 FlashX'),
  normModelName('GLM-5.3-FlashX'),
  '归一化：渠道与官方写法一致（去重的前提）'
);

// ---------- 2. 格式化 ----------
eq(formatContext(1100000), '1.1M', '上下文：百万');
eq(formatContext(131072), '131K', '上下文：千');
eq(formatContext(1000000), '1M', '上下文：整百万');
eq(formatContext(null), null, '上下文：空');
eq(formatCost(0.15), '$0.15', '价格：小数');
eq(formatCost(50), '$50', '价格：整数');
eq(formatCost(0), '免费', '价格：零');
eq(stripHtml('<![CDATA[Hello &amp; <b>world</b>]]>'), 'Hello & world', 'HTML 清洗');

// ---------- 3. 注册表 ----------
ok(isOriginator('openai'), '注册表：OpenAI 是原厂');
ok(isOriginator('zhipuai'), '注册表：智谱是原厂');
ok(!isOriginator('nano-gpt'), '注册表：NanoGPT 不是原厂');
ok(!isOriginator('amazon-bedrock'), '注册表：Amazon Bedrock 是云转售，非原厂');
ok(!isOriginator('huggingface'), '注册表：Hugging Face 是托管平台，非原厂');
ok(!isOriginator('helicone'), '注册表：Helicone 是可观测性网关，非原厂');
eq(canonicalOf('zai'), 'zhipuai', '注册表：Z.AI 归到智谱');
eq(canonicalOf('alibaba-cn'), 'alibaba', '注册表：阿里云国内的规范名');
eq(canonicalOf('openai'), 'openai', '注册表：规范厂商指向自己');
eq(displayName('zai', 'Z.AI'), '智谱 AI', '注册表：别名显示规范厂商名');
// 注册表自身的一致性
ok(REGISTRY.every((e) => e.id && e.name), '注册表：每条都有 id 与 name');
ok(
  REGISTRY.every((e) => !e.canonical || REGISTRY.some((x) => x.id === e.canonical)),
  '注册表：canonical 指向的厂商必须存在'
);
ok(
  new Set(REGISTRY.map((e) => e.id)).size === REGISTRY.length,
  '注册表：id 无重复'
);

// ---------- 4. 原厂 / 渠道判定（来自注册表）----------
const mixed = buildSnapshot(
  {
    openai: vendor('openai', 'OpenAI', 10, 'GPT'),
    zhipuai: vendor('zhipuai', 'Zhipu AI', 16, 'GLM'),    // 登记 -> 原厂
    zai: vendor('zai', 'Z.AI', 17, 'GLM'),                // 登记为别名 -> 归到 zhipuai
    nano: {
      id: 'nano', name: 'NanoGPT',                        // 未登记 -> 渠道
      models: {
        // 渠道也收了智谱的 GLM-0，但改写成了前缀风格的名字
        glm: MODEL('GLM-0'),
        ...Object.fromEntries(Array.from({ length: 299 }, (_, i) => [`n${i}`, MODEL(`NANO-${i}`)])),
      },
    },
  },
  { date: '2026-09-20' }
);
ok(mixed.vendors['openai'].isChannel === false, '判定：登记原厂不为渠道');
ok(mixed.vendors['nano'].isChannel === true, '判定：未登记厂商为渠道');
ok(mixed.vendors['nano'].modelCount === 300, '判定：渠道条文数照实记录');
eq(mixed.vendors['zai'].aliasOf, 'zhipuai', '判定：Z.AI 标记为智谱别名');
eq(mixed.vendors['zai'].isChannel, false, '判定：同公司品牌不算渠道');
eq(mixed.models['zai/zai-0'].vendor, 'zhipuai', '判定：别名条目归到规范厂商');
eq(mixed.models['zai/zai-0'].isOrigin, true, '判定：别名条目仍属原厂模型');
eq(mixed.models['nano/glm'].isOrigin, false, '判定：渠道条目非原厂');
eq(mixed.models['nano/glm'].shared, 3, '判定：GLM-0 被 3 家收录');
eq(mixed.originVendorCount, 2, '判定：原厂数 = openai + zhipuai');
eq(mixed.originModelCount, 43, '判定：原厂模型条目 = 10 + 16 + 17');

// ---------- 5. 原厂优选 ----------
// 实测情形：GLM-5.3-FlashX 出现在 4 处。必须命中智谱，不是 300 条的聚合站。
const glm = Object.values(mixed.models).filter((m) => m.norm === 'glm-0');
eq(glm.length, 3, '优选：GLM-0 确有 3 个来源（智谱 ×2 + 渠道）');
eq(glm.filter((m) => m.isOrigin).length, 2, '优选：其中 2 个是原厂条目');
eq(pickCanonical(glm, mixed.vendors).vendorRaw, 'zhipuai', '优选：在同为原厂的条目里取目录更小者');
ok(!pickCanonical(glm, mixed.vendors).isOrigin === false, '优选：选中的是原厂条目');

const realList = realVendors(mixed).map((v) => v.id);
eq(realList.sort(), ['openai', 'zhipuai'], '优选：原厂清单不含渠道与别名');

// ---------- 6. 差分：多渠道只出一条事件 ----------
const newEvents = diffSnapshots(null, mixed).filter((e) => e.name === 'GLM-0');
eq(newEvents.length, 1, '差分：同一模型跨 3 个来源只产出 1 条新模型事件');
eq(newEvents[0].vendor, 'zhipuai', '差分：事件归属到原厂而非渠道');
eq(newEvents[0].href, '/models/glm-0/', '差分：档案链接以归一名为准，与收录来源无关');

const channelOnly = Object.values(mixed.models).filter((m) => m.vendorRaw === 'nano');
eq(channelOnly.length, 300, '差分：渠道模型仍在快照里完整保留（含它转售的那条）');
ok(
  !diffSnapshots(null, mixed).some((e) => e.vendorRaw === 'nano' || e.vendor === 'nano'),
  '差分：渠道自造的模型不进事件流'
);

// ---------- 7. 差分：四类事实事件 ----------
const before = buildSnapshot(
  {
    zhipuai: {
      id: 'zhipuai', name: 'Zhipu AI',
      models: {
        a: MODEL('GLM-A'),
        b: MODEL('GLM-B', { cost: { input: 1.0, output: 3.0 } }),
        c: MODEL('GLM-C', { limit: { context: 32000, output: 8192 } }),
        d: MODEL('GLM-D'), // 当天消失 -> retired
      },
    },
  },
  { date: '2026-09-19' }
);
const after = buildSnapshot(
  {
    zhipuai: {
      id: 'zhipuai', name: 'Zhipu AI',
      models: {
        a: MODEL('GLM-A'),
        b: MODEL('GLM-B', { cost: { input: 0.5, output: 3.0 } }),         // 调价
        c: MODEL('GLM-C', { limit: { context: 200000, output: 8192 } }),  // 上下文变更
        e: MODEL('GLM-E'),                                                // 新增
      },
    },
  },
  { date: '2026-09-20' }
);

const events = diffSnapshots(before, after);
const byType = (t) => events.filter((e) => e.type === t);
eq(byType('new').length, 1, '差分：新增 1 条');
eq(byType('new')[0].name, 'GLM-E', '差分：新增的是 GLM-E');
eq(byType('retired').length, 1, '差分：下架 1 条');
eq(byType('retired')[0].name, 'GLM-D', '差分：下架的是 GLM-D');
eq(byType('price').length, 1, '差分：调价 1 条');
eq(byType('price')[0].text, '输入 $1 → $0.5', '差分：调价文案');
eq(
  describePrice({ in: 99, outCost: 3 }, { in: null, outCost: 3 }),
  '输入 $99 → 未知',
  '差分：价格缺失时显示「未知」而不是 null'
);
eq(byType('context').length, 1, '差分：上下文变更 1 条');
eq(byType('context')[0].text, '上下文 32K → 200K', '差分：上下文文案');
eq(events.length, 4, '差分：没有多余事件');

// 渠道的增删不应产生任何事件
const gwBefore = buildSnapshot(
  {
    openai: vendor('openai', 'OpenAI', 10, 'GPT'),
    somegw: vendor('somegw', 'SomeGW', 200, 'COPY-A'),
  },
  { date: '2026-09-19' }
);
const gwAfter = buildSnapshot(
  {
    openai: vendor('openai', 'OpenAI', 10, 'GPT'),
    somegw: vendor('somegw', 'SomeGW', 200, 'COPY-B'),
  },
  { date: '2026-09-20' }
);
eq(diffSnapshots(gwBefore, gwAfter).length, 0, '差分：渠道换了一批收录对象，不产生任何事件');

// ---------- 8. 文案模板（零 LLM，纯拼接）----------
eq(
  describeNew({ name: 'GLM-5.3-FlashX', open: true, ctx: 131072, in: 0.5, reasoning: true }),
  'GLM-5.3-FlashX · 开源 · 131K 上下文 · 输入 $0.5/M · 支持推理',
  '文案：新模型描述模板'
);
eq(
  describeNew({ name: 'X', open: false, ctx: null, in: null, reasoning: false }),
  'X · 闭源',
  '文案：缺数据时不留空档'
);

// ---------- 9. 首跑回填 ----------
const backfilled = backfillFromReleaseDates(mixed, { days: 3 });
ok(backfilled.length > 0, '回填：能按 release_date 捞出近期模型');
ok(backfilled.every((e) => e.type === 'new'), '回填：只产出 new 事件');
ok(!backfilled.some((e) => e.vendorRaw === 'nano'), '回填：渠道同样被排除');

// ---------- 10. 注册表缺口清单 ----------
const gaps = unregisteredWithRecentModels(mixed, { windowDays: 30 });
eq(gaps.length, 1, '缺口：恰好报出 1 家未登记厂商');
eq(gaps[0].id, 'nano', '缺口：报的是渠道那只');
ok(gaps[0].count === 300, '缺口：统计到该厂商的全部近期模型');
ok(gaps[0].sample != null, '缺口：给出样例模型名便于人工判断');

// ---------- 11. RSS 解析 ----------
const rss = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Introducing GPT-6]]></title><link>https://example.com/a</link>
<pubDate>Tue, 16 Sep 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;
const parsed = parseFeed(rss);
eq(parsed.length, 1, 'RSS：解析出 1 条');
eq(parsed[0].title, 'Introducing GPT-6', 'RSS：CDATA 标题');
eq(parsed[0].url, 'https://example.com/a', 'RSS：链接');
ok(parsed[0].date?.startsWith('2026-09-16'), 'RSS：日期解析');

const atom = `<feed><entry><title>Hello</title>
<link rel="alternate" href="https://example.com/b"/><updated>2026-09-17T00:00:00Z</updated></entry></feed>`;
const a1 = parseFeed(atom);
eq(a1[0].url, 'https://example.com/b', 'Atom：href 属性链接');
eq(a1[0].date, '2026-09-17T00:00:00.000Z', 'Atom：updated 时间');

// ---------- 12. 证据挂载 ----------
const { facts, news } = attachEvidence([
  { type: 'new', key: 'zhipu/glm-e', vendor: 'zhipu', name: 'GLM-E', date: '2026-09-20' },
  { type: 'news', vendor: 'zhipu', name: '智谱发布 GLM-E', date: '2026-09-20', text: '智谱发布 GLM-E',
    href: 'https://example.com/x', source: '智谱' },
  { type: 'news', vendor: 'openai', name: '无关公告', date: '2026-09-20', text: '无关公告',
    href: 'https://example.com/y', source: 'OpenAI' },
]);
eq(facts[0].evidence?.length, 1, '证据：同厂商公告被挂上');
eq(news.find((n) => n.vendor === 'openai').attachedTo, undefined, '证据：跨厂商不误挂');

// ---------- 结果 ----------
console.log(`\n${failures.length ? '❌' : '✅'} ai-daily 自检：${passed} 项通过，${failures.length} 项失败\n`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  console.log();
  process.exit(1);
}
console.log('   全部为纯函数断言，不联网、不读磁盘。\n');

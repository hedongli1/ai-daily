// scripts/diff.js
// 快照对比 —— 本项目的核心：把「昨天一份快照」变成「今天发生的事」。
//
// 为什么不直接用模型自带的 release_date 判断「今天发布」？
//   release_date 是模型的发布日期，不是「我们今天才知道」的日期。
//   用它会天天重复上报同一个模型。真正的增量只能靠两份快照相减得到。
//
// 为什么以 (厂商, 归一名) 为对比单位而不是条目 key？
//   同一个模型会被多个渠道重复收录（实测 GLM-5.3-FlashX 一天内出现在 5 处），
//   按条目 key 对比会产出 5 条重复事件。这里先归并，每个模型每天只出一条。

import { formatContext, formatCost } from './lib.js';
import { pickCanonical } from './normalize.js';

export const TYPES = ['new', 'retired', 'price', 'context', 'news'];

function sameNum(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 1e-9;
}

function isChannel(m, snapshot) {
  const v = snapshot.vendors?.[m.vendorRaw ?? m.vendor];
  return v?.isGateway === true || v?.aliasOf != null;
}

/**
 * 按**归一名**归并，每个模型每天只留一个代表条目。
 *
 * 为什么分组键里不能带厂商？
 *   渠道收录上游模型时往往改写名字（NanoGPT 的 "GLM 5.3 Flash X" 与智谱的
 *   "GLM-5.3-FlashX" 归一名相同，但厂商不同）。按「厂商+归一名」分组的话，
 *   同一模型会落在不同组里各出一条事件 —— 实测单个模型一天被 5 处收录，
 *   就会刷出 5 条重复卡片。
 *
 * 只保留原厂条目：渠道的增删是渠道行为，不是模型发布。
 */
function index(snapshot) {
  const groups = new Map();
  for (const m of Object.values(snapshot?.models ?? {})) {
    if (!m.norm) continue;
    if (!groups.has(m.norm)) groups.set(m.norm, []);
    groups.get(m.norm).push(m);
  }

  const out = new Map();
  for (const [norm, entries] of groups) {
    const origin = entries.filter((m) => m.isOrigin);
    // 只被渠道收录的模型不进事件流 —— 那多半是渠道自造的名字。
    // 它们仍完整保留在 snapshot.models 里，模型库与档案页照常可见。
    if (!origin.length) continue;
    out.set(norm, origin.length === 1 ? origin[0] : pickCanonical(origin, snapshot.vendors));
  }
  return out;
}

/** 生成「新模型」卡片的一句话硬事实描述。纯模板，不经过任何 LLM。 */
export function describeNew(m) {
  const parts = [m.name];
  parts.push(m.open ? '开源' : '闭源');
  if (m.ctx) parts.push(`${formatContext(m.ctx)} 上下文`);
  if (m.in != null) parts.push(`输入 ${formatCost(m.in)}/M`);
  if (m.reasoning) parts.push('支持推理');
  return parts.join(' · ');
}

/** 缺失值统一显示为「未知」，绝不把 null 直接写进文案。 */
const cost = (n) => formatCost(n) ?? '未知';

export function describePrice(before, after) {
  const bits = [];
  if (!sameNum(before.in, after.in)) bits.push(`输入 ${cost(before.in)} → ${cost(after.in)}`);
  if (!sameNum(before.outCost, after.outCost)) bits.push(`输出 ${cost(before.outCost)} → ${cost(after.outCost)}`);
  return bits.join(' · ');
}

export function describeContext(before, after) {
  return `上下文 ${formatContext(before.ctx) ?? '未知'} → ${formatContext(after.ctx) ?? '未知'}`;
}

function eventBase(type, m, date, snapshot) {
  return {
    type,
    key: `${m.vendorRaw}/${m.name}`,
    vendor: m.vendor,
    vendorName: snapshot.vendors?.[m.vendor]?.name ?? m.vendorName,
    name: m.name,
    date,
    facts: {},
    text: '',
    // 档案链接以**归一名**为准，而不是厂商+条目名 —— 这样同一个模型无论
    // 被哪家收录，卡片都指向同一个档案页。
    href: `/models/${encodeURIComponent(m.norm)}/`,
  };
}

/** 两份快照相减，产出四类事实事件（第五类 news 由 feeds 提供）。 */
export function diffSnapshots(baseline, current) {
  const base = index(baseline);
  const curr = index(current);
  const events = [];

  for (const [k, m] of curr) {
    if (!base.has(k)) {
      const e = eventBase('new', m, m.release ?? current.date, current);
      e.facts = { ctx: m.ctx, in: m.in, outCost: m.outCost, open: m.open, reasoning: m.reasoning };
      e.text = describeNew(m);
      e.shared = m.shared;
      events.push(e);
      continue;
    }
    const b = base.get(k);
    if (!sameNum(b.in, m.in) || !sameNum(b.outCost, m.outCost) || !sameNum(b.cacheRead, m.cacheRead)) {
      const e = eventBase('price', m, current.date, current);
      e.facts = { before: { in: b.in, outCost: b.outCost }, after: { in: m.in, outCost: m.outCost } };
      e.text = describePrice(b, m);
      events.push(e);
    }
    if (!sameNum(b.ctx, m.ctx)) {
      const e = eventBase('context', m, current.date, current);
      e.facts = { before: b.ctx, after: m.ctx };
      e.text = describeContext(b, m);
      events.push(e);
    }
  }

  for (const [k, b] of base) {
    if (curr.has(k)) continue;
    const e = eventBase('retired', b, current?.date ?? null, baseline);
    e.text = `已从 ${baseline.vendors?.[b.vendor]?.name ?? b.vendorName} 下架`;
    e.href = `/vendors/${encodeURIComponent(b.vendor)}/`;
    events.push(e);
  }

  return sortEvents(events);
}

/**
 * 首跑回填：仓库里还没有任何历史快照时，用 release_date 把最近 N 天的
 * 发布捞出来当作基线事件。显式标记 mode: "backfill"，不冒充真实增量。
 */
export function backfillFromReleaseDates(snapshot, { days = 3 } = {}) {
  const cutoff = new Date(new Date(snapshot.date + 'T00:00:00Z').getTime() - days * 86400000)
    .toISOString()
    .slice(0, 10);

  const events = [];
  for (const m of index(snapshot).values()) {
    if (!m.release || m.release < cutoff) continue;
    const e = eventBase('new', m, m.release, snapshot);
    e.facts = { ctx: m.ctx, in: m.in, outCost: m.outCost, open: m.open, reasoning: m.reasoning };
    e.text = describeNew(m);
    e.shared = m.shared;
    events.push(e);
  }
  return sortEvents(events);
}

/** 事件按日期降序；同日按类型优先级。 */
export function sortEvents(events) {
  const rank = { new: 0, price: 1, context: 2, retired: 3, news: 4 };
  return events.sort((a, b) => {
    const d = String(b.date ?? '').localeCompare(String(a.date ?? ''));
    if (d !== 0) return d;
    return (rank[a.type] ?? 9) - (rank[b.type] ?? 9);
  });
}

export function countByType(events) {
  const counts = { new: 0, retired: 0, price: 0, context: 0, news: 0 };
  for (const e of events) if (e.type in counts) counts[e.type]++;
  return counts;
}

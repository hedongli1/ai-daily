// scripts/lib.js
// 零依赖共享工具。只用 Node >=18 的内置能力（fetch / node:fs / node:path）。
// 本目录所有脚本都不引入任何第三方依赖，也不需要任何 API 密钥。

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const UA = 'ai-daily/0.1 (+https://github.com/hedongli1/ai-daily)';
export const MODELS_DEV = 'https://models.dev/api.json';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(...a);
export const warn = (...a) => console.warn(...a);

/** 带超时与重试的文本抓取。失败抛错，由调用方决定是否降级。 */
export async function fetchText(url, { timeout = 45000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(2000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export async function writeText(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value, 'utf8');
}

// 日期键用「北京时间」而不是 UTC：日报的两个班次都锚定北京日期，
// 凌晨 / 傍晚的班次在 UTC 下会落到前一天，把战报日期劈成两天。
// 统一用 en-CA 区域格式直接产出 YYYY-MM-DD，避免手工补零。
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * 统一 models.dev 的 release_date 形态。
 *
 * 实测原始数据只有两种写法：`YYYY-MM-DD`（7656 条）与 `YYYY-MM`（212 条）。
 * 后者是只知道月份、不知道日期。这里把 `YYYY-MM` 补成该月 1 号，
 * **同时用 precision 标记它是月粒度** —— 站点据此显示「2026-01（月）」，
 * 不伪装成精确日期。统一后所有日期都可以直接字符串比较排序。
 *
 *   返回 null 表示完全没有日期。
 */
export function normalizeDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (full) return { date: `${full[1]}-${full[2]}-${full[3]}`, precision: 'day' };
  const ym = s.match(/^(\d{4})-(\d{2})$/);
  if (ym) return { date: `${ym[1]}-${ym[2]}-01`, precision: 'month' };
  const y = s.match(/^(\d{4})$/);
  if (y) return { date: `${y[1]}-01-01`, precision: 'year' };
  return null;
}

/**
 * 模型名归一化 —— 跨厂商识别「这是同一个模型」全靠它。
 * 不归一化的话，网关收录的 "Z.ai: GLM 5.3 FlashX" 和官方源里的
 * "GLM-5.3-FlashX" 会被当成两个不同模型，网关判定直接失效。
 *
 *   "GLM 5.3 FlashX"        -> "glm-5-3-flashx"
 *   "Z.ai: GLM 5.3 FlashX"  -> "glm-5-3-flashx"
 *   "muse-spark-1.3_xhigh"  -> "muse-spark-1-3-xhigh"
 *   "Gemma 4 26B A4B (free)"-> "gemma-4-26b-a4b"
 */
export function normModelName(name) {
  let s = String(name ?? '').toLowerCase().trim();
  // 去掉 "z.ai: " / "openai/" 这类厂商前缀
  s = s.replace(/^[a-z0-9._-]+\s*[:/]\s*/, '');
  // 去掉括号限定词：(free) [beta] （预览）
  s = s.replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, ' ');
  // 统一分隔符
  s = s.replace(/[\s._]+/g, '-');
  // 只保留字母数字和连字符
  s = s.replace(/[^a-z0-9-]+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s;
}

/** 上下文长度人读化：1100000 -> "1.1M"，131072 -> "131K" */
export function formatContext(n) {
  if (n == null) return null;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/**
 * 上下文长度的「高精度」写法：只在需要区分两个被 formatContext 取整后看起来相同的值时使用。
 * 例：1048576 与 1000000 都会被 formatContext 显示成 "1M"，
 *     本函数显示为 "1.05M" 与 "1M"，从而如实反映变化方向与幅度。
 */
export function formatContextDetail(n) {
  if (n == null) return null;
  if (n >= 1000000) return `${(n / 1000000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** 价格人读化：0.15 -> "$0.15"，50 -> "$50" */
export function formatCost(n) {
  if (n == null) return null;
  if (n === 0) return '免费';
  const s = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
  return `$${s}`;
}

export function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

/** 去掉 HTML 标签与实体，用于 RSS 标题。 */
export function stripHtml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

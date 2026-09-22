// docs/app.js
// 零依赖静态站点：读 data/site/*.json，按 hash 路由渲染。
// 这里不做任何数据加工 —— 所有加工都在 scripts/build-site.js 里完成。
// 浏览器只负责画出来，所以这个站没有「构建失败」这种故障模式。

const D = './data/site/';
const $ = (s, r = document) => r.querySelector(s);

const state = {
  data: null,
  q: '',
  qIdx: [],
  filters: { vendor: '', open: '', sort: 'rel' },
  page: 1,
  PAGE: 60,
};

// ---------- 工具 ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtCtx = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const fmtCost = (n) => (n == null ? '—' : n === 0 ? '免费' : `$${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}`);
const fmtNum = (n) => (n == null ? '—' : n.toLocaleString('en-US'));
/** 月粒度的日期加「（月）」后缀，不假装是精确到日的发布。 */
const fmtDate = (d, p) => (d == null ? '—' : p === 'month' ? `${d.slice(0, 7)}（月）` : p === 'year' ? `${d.slice(0, 4)}（年）` : d);

const TYPE_LABEL = { new: '新生物', price: '交易行情', context: '背包扩容', retired: '生物灭绝', news: '村庄告示' };
const TYPE_RANK = { new: 0, price: 1, context: 2, retired: 3, news: 4 };

// ---------- 像素生物头像 ----------
// 零素材方案：每个头像由名字哈希驱动的伪随机数在 12x12 网格上画出，
// 同一个名字永远生成同一张脸；不含任何 Mojang 官方贴图或图片文件。
function pxHash(s) {
  let h = 2166136261;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pxRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
// 调色板：[深描边, 主色, 阴影, 点缀]
const PX_PALS = [
  ['#3f6212', '#84cc16', '#4d7c0f', '#ecfccb'],
  ['#7c2d12', '#f97316', '#9a3412', '#ffedd5'],
  ['#0c4a6e', '#38bdf8', '#0369a1', '#e0f2fe'],
  ['#581c87', '#a855f7', '#7e22ce', '#f3e8ff'],
  ['#7f1d1d', '#ef4444', '#b91c1c', '#fecaca'],
  ['#713f12', '#eab308', '#a16207', '#fef9c3'],
  ['#3f3f46', '#a1a1aa', '#52525b', '#fafafa'],
  ['#064e3b', '#34d399', '#047857', '#d1fae5'],
  ['#1e3a8a', '#3b82f6', '#1d4ed8', '#dbeafe'],
  ['#831843', '#ec4899', '#be185d', '#fce7f3'],
];
function pxSvg(g, size, cls, par) {
  const H = g.length, W = g[0].length;
  let r = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W;) {
      const c = g[y][x];
      if (!c) { x++; continue; }
      let x2 = x + 1;
      while (x2 < W && g[y][x2] === c) x2++;
      r += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${c}"/>`;
      x = x2;
    }
  }
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="${cls}"${dim} viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" preserveAspectRatio="${par || 'xMidYMid meet'}" aria-hidden="true">${r}</svg>`;
}
// 在 12x12 网格上画一只小生物：身体、眼睛、嘴、角 / 天线 / 刘海、斑纹。
function pxFace(seed, size = 36) {
  const rnd = pxRng(pxHash(seed));
  const [oc, bc, dc, ac] = PX_PALS[Math.floor(rnd() * PX_PALS.length)];
  const g = Array.from({ length: 12 }, () => Array(12).fill(''));
  const set = (x, y, c) => { if (x >= 0 && x < 12 && y >= 0 && y < 12) g[y][x] = c; };
  // 身体（切角方块）+ 右侧与底部阴影
  for (let y = 2; y <= 9; y++) for (let x = 2; x <= 9; x++) {
    if ((y === 2 || y === 9) && (x === 2 || x === 9)) continue;
    set(x, y, bc);
  }
  for (let y = 3; y <= 8; y++) set(9, y, dc);
  for (let x = 3; x <= 8; x++) set(x, 9, dc);
  // 头顶装饰：双角 / 天线 / 刘海
  const top = rnd();
  if (top < 0.3) { set(3, 1, dc); set(3, 0, oc); set(8, 1, dc); set(8, 0, oc); }
  else if (top < 0.45) { set(6, 1, dc); set(6, 0, ac); }
  else if (top < 0.6) { for (let x = 3; x <= 8; x++) set(x, 2, dc); }
  // 眼睛：独眼 / 发光眼 / 普通眼
  const eye = rnd();
  if (eye < 0.12) {
    for (let y = 4; y <= 5; y++) for (let x = 5; x <= 6; x++) set(x, y, '#ffffff');
    set(rnd() < 0.5 ? 5 : 6, 5, '#111418');
  } else if (eye < 0.3) {
    for (const ex of [3, 7]) { set(ex, 4, ac); set(ex + 1, 4, ac); set(ex, 5, ac); set(ex + 1, 5, ac); }
  } else {
    for (const ex of [3, 7]) {
      set(ex, 4, '#ffffff'); set(ex + 1, 4, '#ffffff'); set(ex, 5, '#ffffff'); set(ex + 1, 5, '#ffffff');
      set(rnd() < 0.5 ? ex : ex + 1, rnd() < 0.3 ? 4 : 5, '#111418');
    }
  }
  // 腮红
  if (rnd() < 0.35) { set(2, 6, ac); set(9, 6, ac); }
  // 嘴：微笑 / 一字 / 张嘴
  const mo = rnd();
  if (mo < 0.35) { set(4, 7, oc); set(5, 8, oc); set(6, 8, oc); set(7, 7, oc); }
  else if (mo < 0.6) { for (let x = 4; x <= 7; x++) set(x, 7, oc); }
  else if (mo < 0.75) { set(5, 7, oc); set(6, 7, oc); set(5, 8, oc); set(6, 8, oc); }
  // 额头斑纹
  if (rnd() < 0.4) { const n = 1 + Math.floor(rnd() * 3); for (let i = 0; i < n; i++) set(2 + Math.floor(rnd() * 8), 3, dc); }
  return pxSvg(g, size, 'pxface');
}
// 首页像素地形横幅：草地表皮 + 泥土 + 深层石头 / 金粒，偶有小花、草丛与树。
function pxTerrain(seed) {
  const rnd = pxRng(pxHash(seed));
  const BW = 320, BH = 12;
  const g = Array.from({ length: BH }, () => Array(BW).fill(''));
  // 云
  for (let i = 0; i < 5; i++) {
    const cx = Math.floor(rnd() * (BW - 8)), cy = Math.floor(rnd() * 3), cw = 3 + Math.floor(rnd() * 6);
    for (let x = cx; x < cx + cw; x++) g[cy][x] = 'rgba(255,255,255,.13)';
  }
  let h = 3;
  for (let x = 0; x < BW; x++) {
    h = Math.max(1, Math.min(5, h + (rnd() < 0.32 ? (rnd() < 0.5 ? 1 : -1) : 0)));
    const top = BH - 4 - h;
    for (let y = top; y < BH; y++) {
      const r = rnd();
      let c;
      if (y === top) c = r < 0.8 ? '#6abe30' : '#7ed148';
      else if (y <= top + 1) c = r < 0.75 ? '#8a5a2b' : '#795122';
      else if (r < 0.06) c = '#8d8d8d';
      else c = '#5e3a17';
      if (y >= top + 3 && rnd() < 0.02) c = '#e6c65a';
      g[y][x] = c;
    }
    const d = rnd();
    if (d < 0.05) g[top - 1][x] = rnd() < 0.5 ? '#e04848' : '#f2d13c';
    else if (d < 0.09) g[top - 1][x] = '#59a524';
    else if (d < 0.115 && x > 1 && x < BW - 2 && top >= 5) {
      for (let ty = top - 3; ty < top; ty++) g[ty][x] = '#6b4423';
      for (let ly = top - 5; ly <= top - 3; ly++) for (let lx = x - 1; lx <= x + 1; lx++) g[ly][lx] = '#3f7d1e';
      if (top - 6 >= 0) g[top - 6][x] = '#4e9a28';
    }
  }
  return pxSvg(g, 0, 'pxterrain', 'xMidYMax slice');
}

async function load() {
  const names = ['models', 'vendors', 'timeline', 'board', 'events', 'summary', 'bench'];
  const got = await Promise.all(names.map((n) => fetch(D + n + '.json').then((r) => (r.ok ? r.json() : null))));
  const [models, vendors, timeline, board, events, summary, bench] = got;
  state.data = { models, vendors, timeline, board, events, summary, bench };

  // 搜索索引：模型 + 厂商
  const idx = [];
  for (const m of models?.models ?? []) {
    idx.push({
      kind: 'model', id: m.n, title: m.name, vendor: m.vn,
      meta: [m.open ? '开源' : '闭源', fmtCtx(m.ctx) + ' 上下文', m.in != null ? fmtCost(m.in) + '/M' : null].filter(Boolean).join(' · '),
      hay: `${m.name} ${m.vn} ${m.n} ${m.open ? '开源 open' : '闭源'} ${m.rsn ? '推理 reasoning' : ''} ${m.tool ? '工具 tool' : ''}`.toLowerCase(),
    });
  }
  for (const v of vendors?.vendors ?? []) {
    idx.push({ kind: 'vendor', id: v.id, title: v.name, vendor: '厂商', meta: `${v.n} 个模型`, hay: `${v.name} ${v.id} 厂商 vendor`.toLowerCase() });
  }
  state.qIdx = idx;
}

// ---------- 路由 ----------
function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const seg = h.split('/').filter(Boolean);
  if (!seg.length) return { page: 'home' };
  if (seg[0] === 'models' && seg[1]) return { page: 'model', id: decodeURIComponent(seg[1]) };
  if (seg[0] === 'vendors' && seg[1]) return { page: 'vendor', id: decodeURIComponent(seg[1]) };
  if (['models', 'timeline', 'vendors', 'about', 'credits'].includes(seg[0])) return { page: seg[0] };
  return { page: 'home' };
}

function render() {
  const r = route();
  document.querySelectorAll('.nav a').forEach((a) => {
    const p = a.dataset.page;
    a.classList.toggle('active', p === r.page || (r.page === 'model' && p === 'models') || (r.page === 'vendor' && p === 'vendors'));
  });
  const views = {
    home: viewHome, models: viewModels, model: () => viewModel(r.id),
    timeline: viewTimeline, vendors: viewVendors, vendor: () => viewVendor(r.id),
    about: viewAbout, credits: viewCredits,
  };
  $('#app').innerHTML = (views[r.page] ?? viewHome)();
  window.scrollTo(0, 0);
  if (r.page === 'home') bindHome();
  if (r.page === 'models') bindModels();
}

// ---------- 首页 ----------
function viewHome() {
  const s = state.data.summary;
  const ev = state.data.events;
  const b = state.data.board?.board ?? {};
  if (!s) return '<div class="empty">暂无数据</div>';

  const banner =
    s.mode === 'backfill'
      ? `<div class="banner">本次是<b>首跑回填</b>：仓库里还没有历史快照，下面的事件是按模型自带的发布日期捞出来的，<b>不是</b>「相比昨天」的真实增量。明天同一时刻跑第二次之后才会开始产出真正的日增量。</div>`
      : '';
  const degraded = (s.degraded ?? []).length
    ? `<div class="banner">以下证据源今天抓取失败，已降级处理，不影响其余内容：<b>${esc(s.degraded.join(' · '))}</b></div>`
    : '';

  const c = s.counts ?? {};
  const tally = `
    <div class="tally">
      <div class="t new">${pxFace('tally:new', 30)}<div class="tt"><div class="num">${c.new ?? 0}</div><div class="lbl">新生物</div></div></div>
      <div class="t price">${pxFace('tally:price', 30)}<div class="tt"><div class="num">${c.price ?? 0}</div><div class="lbl">交易行情</div></div></div>
      <div class="t ctx">${pxFace('tally:context', 30)}<div class="tt"><div class="num">${c.context ?? 0}</div><div class="lbl">背包扩容</div></div></div>
      <div class="t retired">${pxFace('tally:retired', 30)}<div class="tt"><div class="num">${c.retired ?? 0}</div><div class="lbl">生物灭绝</div></div></div>
      <div class="t news">${pxFace('tally:news', 30)}<div class="tt"><div class="num">${c.news ?? 0}</div><div class="lbl">村庄告示</div></div></div>
    </div>`;

  // 事件流：只显示事实事件 + 未挂到任何模型上的公告
  const facts = (ev?.events ?? []).filter((e) => e.type !== 'news');
  const loose = (ev?.events ?? []).filter((e) => e.type === 'news' && !e.attachedTo);
  const merged = [...facts, ...loose].sort(
    (a, b2) => String(b2.date ?? '').localeCompare(String(a.date ?? '')) || (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b2.type] ?? 9)
  );

  const evHtml = merged.length
    ? merged.map(evCard).join('')
    : `<div class="empty">今天矿洞平静无波，没有记录到原厂模型的变动。<br><span style="font-size:12px">这本身也是一个事实 —— AI 圈并没有每天都发生结构性变化。</span></div>`;

  const boardHtml = Object.entries(BOARD_LABEL)
    .filter(([k]) => (b[k] ?? []).length)
    .map(([k, label]) => {
      const x = b[k][0];
      return `<div class="b">${pxFace(x.n, 34)}
        <div class="bb"><div class="k">${label}</div>
        <div class="v"><a href="#/models/${encodeURIComponent(x.n)}">${esc(x.name)}</a></div>
        <div class="m">${esc(x.vn)}</div>
        <div class="w">${esc(x.metric)} ${k === 'cheapest' || k === 'priciest' ? fmtCost(x.val) : fmtCtx(x.val)}</div></div>
      </div>`;
    })
    .join('');

  const t = s.totals ?? {};
  const prevS = state.data.events;
  const nav = [
    prevS?.baselineDate ? `<a href="#/models">全部 ${t.originModels ?? 0} 个原厂模型 →</a>` : null,
  ].filter(Boolean).join('');

  // 方块广场：五类事件各取头条一张卡，一眼看清今天矿洞里的动静。
  const PLAZA_LABEL = { new: '新生物', price: '交易行情', context: '背包扩容', retired: '生物灭绝', news: '村庄告示' };
  const plazaCards = Object.keys(PLAZA_LABEL)
    .map((tp) => merged.find((e) => e.type === tp))
    .filter(Boolean);
  const plazaHtml = plazaCards.length
    ? `<div class="section"><h2>方块广场 <span class="cnt">各类事件头条</span></h2><div class="plaza">${plazaCards
        .map(
          (e) => `<a class="plaza-card plaza-${e.type}" href="${e.type !== 'news' && e.href ? '#' + esc(e.href.replace(/^\//, '/')) : '#'}">
          <div class="plaza-strip"></div>
          <div class="plaza-ico">${pxFace(e.type + ':' + (e.norm || e.name || ''), 56)}</div>
          <div class="plaza-name">${esc(e.name)}</div>
          <div class="plaza-fact">${esc(linkifyFacts(e)) || PLAZA_LABEL[e.type]}</div>
          <div class="plaza-meta">${esc(e.date ?? '')} · ${esc(e.vendorName ?? '')}</div>
        </a>`
        )
        .join('')}</div></div>`
    : '';

  // 英雄区 + 像素地形横幅：给首页一个「世界出生点」，吉祥物 = 今日头号事件的生物。
  const mascotSeed = merged[0] ? String(merged[0].norm || merged[0].name || 'spawn') : String(s.date ?? 'spawn');
  const heroHtml = `
    <div class="hero">
      <div class="hero-l">
        <div class="hero-k">AI 矿务日报 · 每日事实差分</div>
        <h1>今日矿情 <span>${esc(s.date ?? '')}</span></h1>
        <p>与昨日全量快照相减得到的真实增量 —— 每个字都能追溯到数据源。</p>
      </div>
      <div class="hero-m">${pxFace('mascot:' + mascotSeed, 84)}</div>
    </div>
    <div class="terrain">${pxTerrain('spawn:' + (s.date ?? ''))}</div>`;

  return `
    ${banner}${degraded}
    ${heroHtml}
    ${tally}
    ${plazaHtml}
    <div class="cols">
      <div>
        <div class="section">
          <h2>矿洞播报 <span class="cnt">${merged.length} 条</span></h2>
          ${evHtml}
          ${nav ? `<p style="margin-top:14px;font-size:12.5px">${nav}</p>` : ''}
        </div>
      </div>
      <div>
        <div class="section">
          <h2>方块名人堂</h2>
          <div class="board">${boardHtml || '<div class="empty">数据不足</div>'}</div>
        </div>
        <div class="section">
          <h2>世界档案</h2>
          <div class="board">
            <div class="b"><div class="k">原厂</div><div class="v">${t.originVendors ?? 0} 家</div><div class="w">人工登记注册表</div></div>
            <div class="b"><div class="k">原厂模型</div><div class="v">${t.originModels ?? 0} 个</div><div class="w">渠道转售不计入</div></div>
            <div class="b"><div class="k">渠道条目</div><div class="v">${fmtNum(t.channels ?? 0)} 家</div><div class="w">共 ${fmtNum(t.allEntries ?? 0)} 条原始条目</div></div>
            <div class="b"><div class="k">第三方评测</div><div class="v">${state.data.bench?.count ?? 0} 个</div><div class="w">Epoch AI 有记录</div></div>
          </div>
        </div>
      </div>
    </div>`;
}

const BOARD_LABEL = {
  latest: '最新降生', longestCtx: '最大背包', cheapest: '最便宜', priciest: '最昂贵',
  cnStrongest: '国产最大背包', openStrongest: '开源最大背包', mostChannels: '流通最广',
};

function evCard(e) {
  const evi = (e.evidence ?? [])
    .map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener" class="evi">${esc(x.source ?? '原文')} ↗</a>`)
    .join(' ');
  const pro = e.href ? `<a href="#${esc(e.href.replace(/^\//, '/'))}" class="pro">查看档案</a>` : '';
  const body =
    e.type === 'news'
      ? `<span class="nm">${esc(e.name)}</span>`
      : `<span class="nm">${esc(e.name)}</span> <span style="color:var(--fg-dim)">${esc(linkifyFacts(e))}</span>`;
  const ext = e.type === 'news' && e.href ? `<a href="${esc(e.href)}" target="_blank" rel="noopener" class="pro">原文 ↗</a>` : '';
  return `<div class="ev t-${e.type}">
    ${pxFace(e.type + ':' + (e.norm || e.name || ''), 40)}
    <div class="evm">
      <div class="head">
        <span class="tag">${TYPE_LABEL[e.type] ?? e.type}</span>
        <span class="date">${esc(e.date ?? '')}</span>
        <span class="vend">${esc(e.vendorName ?? '')}</span>
      </div>
      <div class="body">${body}</div>
      ${evi || pro || ext ? `<div class="links">${evi}${pro}${ext}</div>` : ''}
    </div>
  </div>`;
}

/** 事件文案里的模型名部分已单独渲染，这里只保留描述性文字。 */
function linkifyFacts(e) {
  if (!e.text) return '';
  return e.text.startsWith(e.name) ? e.text.slice(e.name.length).replace(/^\s*·\s*/, '') : e.text;
}

function bindHome() {
  // 首页无额外交互
}

// ---------- 模型库 ----------
function filteredModels() {
  const all = state.data.models?.models ?? [];
  const f = state.filters;
  let list = all.filter((m) => {
    if (f.vendor && m.v !== f.vendor) return false;
    if (f.open === '1' && m.open !== 1) return false;
    if (f.open === '0' && m.open !== 0) return false;
    return true;
  });
  const cmp = {
    rel: (a, b) => String(b.rel ?? '').localeCompare(String(a.rel ?? '')),
    ctx: (a, b) => (b.ctx ?? -1) - (a.ctx ?? -1),
    ch: (a, b) => (b.ch ?? 0) - (a.ch ?? 0),
    pin: (a, b) => (a.in ?? Infinity) - (b.in ?? Infinity),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
  }[f.sort] ?? (() => 0);
  return list.sort(cmp);
}

function viewModels() {
  const vs = state.data.vendors?.vendors ?? [];
  const list = filteredModels();
  const max = Math.max(1, Math.ceil(list.length / state.PAGE));
  if (state.page > max) state.page = max;
  const slice = list.slice((state.page - 1) * state.PAGE, state.page * state.PAGE);

  const rows = slice
    .map(
      (m) => `<tr>
      <td>${pxFace(m.n, 18)}<a class="mn" href="#/models/${encodeURIComponent(m.n)}">${esc(m.name)}</a>${m.open ? '<span class="chip open">开源</span>' : ''}${m.rsn ? '<span class="chip">推理</span>' : ''}</td>
      <td class="vn">${esc(m.vn)}</td>
      <td class="num">${fmtDate(m.rel, m.relP)}</td>
      <td class="num">${fmtCtx(m.ctx)}</td>
      <td class="num">${fmtCost(m.in)}</td>
      <td class="num">${fmtCost(m.oc)}</td>
      <td class="num">${m.ch ?? 1}</td>
      <td class="num">${state.data.bench?.bench?.[m.n] ? state.data.bench.bench[m.n].runs : '—'}</td>
    </tr>`
    )
    .join('');

  return `
    <div class="section">
      <h2>生物图鉴 <span class="cnt">${list.length} 个原厂模型</span></h2>
      <div class="filters">
        <select id="f-vendor"><option value="">全部厂商</option>${vs
          .map((v) => `<option value="${esc(v.id)}"${state.filters.vendor === v.id ? ' selected' : ''}>${esc(v.name)} (${v.n})</option>`)
          .join('')}</select>
        <select id="f-open">
          <option value="">开源 / 闭源</option>
          <option value="1"${state.filters.open === '1' ? ' selected' : ''}>仅开源</option>
          <option value="0"${state.filters.open === '0' ? ' selected' : ''}>仅闭源</option>
        </select>
        <select id="f-sort">
          <option value="rel"${state.filters.sort === 'rel' ? ' selected' : ''}>按发布日期</option>
          <option value="ctx"${state.filters.sort === 'ctx' ? ' selected' : ''}>按上下文长度</option>
          <option value="ch"${state.filters.sort === 'ch' ? ' selected' : ''}>按渠道数</option>
          <option value="pin"${state.filters.sort === 'pin' ? ' selected' : ''}>按价格从低到高</option>
          <option value="name"${state.filters.sort === 'name' ? ' selected' : ''}>按名称</option>
        </select>
        <span class="stat">第 ${state.page} / ${max} 页</span>
      </div>
      <table class="table">
        <thead><tr>
          <th>模型</th><th>厂商</th><th class="num">发布</th><th class="num">上下文</th>
          <th class="num">输入 $/M</th><th class="num">输出 $/M</th><th class="num">渠道</th><th class="num">评测</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="empty">没有匹配的模型</td></tr>'}</tbody>
      </table>
      <div class="pager">
        <button id="p-prev" ${state.page <= 1 ? 'disabled' : ''}>← 上一页</button>
        <span>${state.page} / ${max}</span>
        <button id="p-next" ${state.page >= max ? 'disabled' : ''}>下一页 →</button>
      </div>
    </div>`;
}

function bindModels() {
  const go = () => { state.page = 1; render(); };
  $('#f-vendor')?.addEventListener('change', (e) => { state.filters.vendor = e.target.value; go(); });
  $('#f-open')?.addEventListener('change', (e) => { state.filters.open = e.target.value; go(); });
  $('#f-sort')?.addEventListener('change', (e) => { state.filters.sort = e.target.value; go(); });
  $('#p-prev')?.addEventListener('click', () => { state.page--; render(); });
  $('#p-next')?.addEventListener('click', () => { state.page++; render(); });
}

// ---------- 模型详情 ----------
function viewModel(id) {
  const m = (state.data.models?.models ?? []).find((x) => x.n === id);
  if (!m) return `<div class="empty">找不到模型 <code>${esc(id)}</code></div>`;
  const bn = state.data.bench?.bench?.[m.n];
  const evs = (state.data.events?.events ?? []).filter((e) => e.norm === m.n || e.href === `/models/${id}/`);

  const kv = [
    ['厂商', esc(m.vn)],
    ['发布日期', m.rel ? fmtDate(m.rel, m.relP) : '未记录'],
    ['开源', m.open ? '是' : '否'],
    ['上下文', m.ctx ? `${fmtCtx(m.ctx)}（${fmtNum(m.ctx)} tokens）` : '未记录'],
    ['最大输出', m.out ? `${fmtCtx(m.out)}（${fmtNum(m.out)} tokens）` : '未记录'],
    ['输入价', m.in != null ? `${fmtCost(m.in)} / 百万 tokens` : '未记录'],
    ['输出价', m.oc != null ? `${fmtCost(m.oc)} / 百万 tokens` : '未记录'],
    ['缓存读取价', m.cr != null ? `${fmtCost(m.cr)} / 百万 tokens` : '未记录'],
    ['支持推理', m.rsn ? '是' : '否'],
    ['支持工具调用', m.tool ? '是' : '否'],
    ['渠道总数', `${m.ch ?? 1} 家收录（含原厂）`],
  ]
    .map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`)
    .join('');

  const benchHtml = bn
    ? `<div class="section"><h2>第三方评测 <span class="cnt">Epoch AI · CC-BY 4.0</span></h2>
        <p style="font-size:12.5px;color:var(--fg-dim);margin:0 0 12px">
          该模型在 Epoch AI 的评测库中共有 <b>${bn.runs}</b> 次运行记录（原数据记作「${esc(bn.name)}」）。
          本站只展示运行次数与域内均分 —— Epoch 原始数据的 <code>Task</code> 列对同一模型为常量，
          <b>不足以算出综合排名</b>，所以本站不提供排名。
        </p>
        ${Object.entries(bn.domains)
          .map(
            ([k, v]) => `<div class="benchrow">
            <div>${esc(k)}</div>
            <div class="dh">${v.n} 次运行 · 均分 <b>${v.avg.toFixed(3)}</b> · 最佳 <b>${v.best.toFixed(3)}</b></div>
            <div class="bar"><i style="width:${Math.max(2, Math.round(v.avg * 100))}%"></i></div>
          </div>`
          )
          .join('')}
      </div>`
    : `<div class="section"><h2>第三方评测</h2><div class="empty">Epoch AI 暂无该模型的评测记录</div></div>`;

  const evHtml = evs.length
    ? evs.map(evCard).join('')
    : '<div class="empty">该模型没有出现在最近的事件流中</div>';

  return `<div class="detail">
    <div class="dhead">${pxFace(m.n, 68)}<div class="dh-t">
    <h1>${esc(m.name)}</h1>
    <p class="sub">${esc(m.vn)} · <a href="#/vendors/${encodeURIComponent(m.v)}">查看该厂商全部模型 →</a></p>
    </div></div>
    <div class="kv">${kv}</div>
    <div class="section"><h2>相关事件</h2>${evHtml}</div>
    ${benchHtml}
  </div>`;
}

// ---------- 时间线 ----------
function viewTimeline() {
  const list = state.data.timeline?.timeline ?? [];
  let year = '';
  const rows = list
    .map((m) => {
      const y = String(m.rel).slice(0, 4);
      const head = y !== year ? ((year = y), `<div class="tlyear">${y} 年</div>`) : '';
      const isNew = m.rel >= (state.data.summary?.date ?? '');
      return `${head}<div class="row${isNew ? ' is-new' : ''}">
        <span class="d">${esc(m.rel)}</span>
        <span class="n">${pxFace(m.n, 16)}<a href="#/models/${encodeURIComponent(m.n)}">${esc(m.name)}</a></span>
        <span class="v">${esc(m.vn)}</span>
        <span class="c">${fmtCtx(m.ctx)}</span>
      </div>`;
    })
    .join('');
  return `<div class="section">
    <h2>编年史 <span class="cnt">${list.length} 个原厂模型 · 按发布时间倒序</span></h2>
    <div class="tl">${rows || '<div class="empty">暂无数据</div>'}</div>
  </div>`;
}

// ---------- 厂商 ----------
function viewVendors() {
  const vs = state.data.vendors?.vendors ?? [];
  const cards = vs
    .map(
      (v) => `<a class="vcard" href="#/vendors/${encodeURIComponent(v.id)}">
      ${pxFace('village:' + v.id, 42)}
      <div class="vm"><div class="n">${esc(v.name)}</div>
      <div class="s"><b>${v.n}</b> 个模型 · 最低输入价 <b>${fmtCost(v.cheapest)}</b></div>
      <div class="s">最近发布 ${esc(v.latest ?? '—')}</div></div>
    </a>`
    )
    .join('');
  return `<div class="section">
    <h2>村庄 <span class="cnt">${vs.length} 家原厂 · 登记在 vendor-registry.js</span></h2>
    <div class="vgrid">${cards || '<div class="empty">暂无数据</div>'}</div>
  </div>`;
}

function viewVendor(id) {
  const v = (state.data.vendors?.vendors ?? []).find((x) => x.id === id);
  if (!v) return `<div class="empty">找不到厂商 <code>${esc(id)}</code></div>`;
  const mine = (state.data.models?.models ?? []).filter((m) => m.v === id).sort((a, b) => String(b.rel ?? '').localeCompare(String(a.rel ?? '')));
  const rows = mine
    .map(
      (m) => `<tr>
      <td>${pxFace(m.n, 18)}<a class="mn" href="#/models/${encodeURIComponent(m.n)}">${esc(m.name)}</a>${m.open ? '<span class="chip open">开源</span>' : ''}</td>
      <td class="num">${fmtDate(m.rel, m.relP)}</td>
      <td class="num">${fmtCtx(m.ctx)}</td>
      <td class="num">${fmtCost(m.in)}</td>
      <td class="num">${fmtCost(m.oc)}</td>
    </tr>`
    )
    .join('');
  return `<div class="section">
    <h2>${pxFace('village:' + v.id, 24)}${esc(v.name)} <span class="cnt">${mine.length} 个模型</span></h2>
    <table class="table">
      <thead><tr><th>模型</th><th class="num">发布</th><th class="num">上下文</th><th class="num">输入 $/M</th><th class="num">输出 $/M</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ---------- 关于 ----------
function viewAbout() {
  const s = state.data.summary;
  const t = s?.totals ?? {};
  return `<div class="prose">
    <h2>这个站回答什么问题</h2>
    <p>「今天 AI 圈发生了什么」。不是新闻聚合，是<b>事实差分</b>。</p>

    <h2>数据从哪来</h2>
    <ul>
      <li><b>models.dev</b>（MIT）—— 模型元数据。本站每天抓一份全量快照存进仓库，与前一天相减，
          得到「今天新增了什么模型、哪个模型调价了、哪个下架了」。今天是第 ${fmtNum(t.allEntries ?? 0)} 条原始条目。</li>
      <li><b>Epoch AI</b>（CC-BY 4.0）—— 第三方评测明细。只用于展示「该模型被评测过多少次」。</li>
      <li><b>厂商官方公告</b> —— 只取标题与链接，不抓正文，用来给事实事件提供溯源证据。</li>
    </ul>

    <h2>为什么不用大模型</h2>
    <p>站上每一个字要么直接来自结构化字段，要么是原文标题本身。理由是<b>可复现</b>：
        同样的输入永远产出同样的输出，而且任何一句话都能被追溯到来源。
        一旦让模型写文案，这个性质就没了。</p>

    <h2>我们遇到的第一个真问题：渠道刷屏</h2>
    <p>models.dev 收录了 ${fmtNum(t.allEntries ?? 0)} 条模型条目，但其中 <b>${fmtNum((t.allEntries ?? 0) - (t.originModels ?? 0))}</b> 条来自
        <b>${t.channels ?? 0} 家渠道</b>——API 网关、云平台、托管服务。同一个模型会被 N 个渠道重复收录，
        实测某模型一天内出现在 5 个条目下。不加处理，「今日新模型」会被渠道的收录动作刷屏。</p>
    <p>我们最后用了一份<b>人工登记的厂商注册表</b>来区分原厂与渠道。为什么不用算法？
        因为试过三个统计信号，每一个都有反例：</p>
    <ul>
      <li><b>聚合率</b>（我的模型被别家收录的比例）—— 方向是反的。网关收录了 OpenAI 的模型，结果把 OpenAI 判成了网关。</li>
      <li><b>派生率</b>（名字里包含别家模型名的比例）—— 会被同族命名误伤。谷歌的
          <code>gemini-2-5-flash-lite</code> 包含 <code>gemini-2-5-flash</code>，被判成蹭名。</li>
      <li><b>目录体量</b> —— 抓得住 576 条的大聚合站，抓不住 165 条的云转售平台。</li>
    </ul>
    <p>每修一次就冒出新反例，说明这类判断本质上依赖人类常识。所以最终采用查表，
        并把缺口做成可见清单：每次管线运行都会打印「未登记但有新模型的厂商」。</p>

    <h2>本站不做什么</h2>
    <ul>
      <li><b>不提供「综合智力排名」</b>。Epoch 原始数据的结构不支持交叉赛制合分，强行合成会失真。
          想看排名请去 <a href="https://epoch.ai/data/ai-benchmarking-dashboard" target="_blank" rel="noopener">Epoch 原始看板</a>。</li>
      <li><b>不抓二手媒体</b>。没有官方一手来源的内容（融资、并购、监管）整体不做。</li>
      <li><b>不使用 Artificial Analysis</b>（条款禁止再分发），<b>不抓取 LMArena</b>（条款禁止自动化抓取）。</li>
    </ul>

    <h2>已知缺口</h2>
    <ul>
      <li>DeepSeek、智谱、月之暗面等国产厂商<b>没有官方 RSS</b>，目前用它们的 GitHub 组织动态兜底，覆盖不完整。</li>
      <li>厂商注册表是人工维护的。出现新原厂时需要补一行，否则它的模型不会出现在事件流里。</li>
      <li>快照每天排班两次（晨报与晚报，北京时间清晨与傍晚触发）。GitHub 托管调度会排队数小时，实际落地多在早晨与晚间；当天更晚发生的变化要等下一个班次。</li>
    </ul>

    <h2>今日运行状态</h2>
    <ul>
      <li>运行模式：<code>${esc(s?.mode ?? '—')}</code>${s?.baselineDate ? `（基线 ${esc(s.baselineDate)}）` : '（首跑回填）'}</li>
      <li>数据源：${(s?.sources ?? []).map((x) => `${esc(x.label)}:${esc(x.status)}(${x.count})`).join(' · ') || '—'}</li>
      ${(s?.degraded ?? []).length ? `<li>降级源：${esc(s.degraded.join(' · '))}</li>` : '<li>所有数据源正常</li>'}
    </ul>
  </div>`;
}

function viewCredits() {
  return `<div class="prose">
    <h2>数据源与署名义务</h2>
    <table class="table" style="margin-bottom:20px">
      <thead><tr><th>来源</th><th>用途</th><th>许可</th></tr></thead>
      <tbody>
        <tr><td><a href="https://models.dev" target="_blank" rel="noopener">models.dev</a></td><td>模型元数据（价格 / 上下文 / 开源 / 发布日期）</td><td>MIT</td></tr>
        <tr><td><a href="https://epoch.ai" target="_blank" rel="noopener">Epoch AI</a></td><td>第三方评测明细</td><td><b>CC-BY 4.0</b></td></tr>
        <tr><td>各厂商官方博客 / GitHub</td><td>公告标题与链接（不抓正文）</td><td>各自所有，仅作引用链接</td></tr>
        <tr><td><a href="https://fonts.google.com/specimen/Press+Start+2P" target="_blank" rel="noopener">Press Start 2P</a></td><td>英文像素字体（Google Fonts 官方分发）</td><td>OFL 1.1</td></tr>
        <tr><td><a href="https://github.com/TakWolf/fusion-pixel-font" target="_blank" rel="noopener">缝合像素字体 Fusion Pixel</a></td><td>中文像素字体（12px 等宽 woff2，随仓库分发）</td><td>OFL-1.1</td></tr>
      </tbody>
    </table>

    <h2>Epoch AI 署名（许可要求）</h2>
    <p>Benchmark data from <b>Epoch AI</b> (<a href="https://epoch.ai" target="_blank" rel="noopener">epoch.ai</a>),
       licensed <b>CC-BY 4.0</b>. 本站以原样转述方式展示其评测运行次数与域内均分，
       未做跨赛制合分，未改变数据含义。</p>

    <h2>明确排除的来源</h2>
    <ul>
      <li><b>Artificial Analysis</b> —— 其条款禁止再分发数据，本站不使用。</li>
      <li><b>LMArena</b> —— 其条款禁止自动化抓取，本站不抓取。</li>
    </ul>

    <h2>本站自身</h2>
    <p>代码与文档 <a href="https://github.com/hedongli1/ai-daily" target="_blank" rel="noopener">MIT</a>。
       站点实现、数据管线、信息架构均为独立编写。设计思路上参考了
       <a href="https://github.com/liyupi/ai-model-world" target="_blank" rel="noopener">liyupi/ai-model-world</a>（同为 MIT）
       公开的「零维护数据管线」思路，但未复用其任何代码、像素素材、字体或文案。</p>
    <p>界面为《我的世界》风格的原创像素主题：方块、边框与配色由 CSS 绘制，生物头像与地形横幅由代码按名字哈希实时生成（SVG，确定性、零素材），
       <b>均未使用 Mojang《Minecraft》的任何官方贴图或素材</b>。像素字体见上表（Press Start 2P / 缝合像素，均为开源许可）。</p>
  </div>`;
}

// ---------- 搜索 ----------
function runSearch(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const terms = needle.split(/\s+/);
  return state.qIdx
    .filter((x) => terms.every((t) => x.hay.includes(t)))
    .slice(0, 40);
}

function renderSearchPanel() {
  const q = $('#search').value;
  const panel = $('#searchpanel');
  if (!q.trim()) {
    panel.hidden = true;
    panel.innerHTML = '';
    return;
  }
  const hits = runSearch(q);
  if (!hits.length) {
    panel.innerHTML = `<div class="inner"><div class="hint">没有匹配「${esc(q)}」的结果。试试模型名、厂商名，或「开源」「推理」这类能力词。</div></div>`;
  } else {
    const models = hits.filter((h) => h.kind === 'model').length;
    const vendors = hits.length - models;
    panel.innerHTML = `<div class="inner">
      <div class="hint">${models} 个模型 · ${vendors} 家厂商</div>
      ${hits
        .map(
          (h) => `<a class="sr" href="#${h.kind === 'model' ? '/models/' + encodeURIComponent(h.id) : '/vendors/' + encodeURIComponent(h.id)}">
        ${pxFace(h.kind + ':' + h.id, 20)}<span>${esc(h.title)}</span><span class="vn">${esc(h.vendor)}</span><span class="mt">${esc(h.meta)}</span>
      </a>`
        )
        .join('')}
    </div>`;
  }
  panel.hidden = false;
}

// ---------- 主题 ----------
function initTheme() {
  const saved = localStorage.getItem('ai-daily-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ai-daily-theme', next);
  });
}

// ---------- 启动 ----------
(async function main() {
  initTheme();
  try {
    await load();
  } catch (err) {
    $('#app').innerHTML = `<div class="empty">数据加载失败：${esc(err.message)}</div>`;
    return;
  }
  render();

  window.addEventListener('hashchange', () => {
    $('#searchpanel').hidden = true;
    render();
  });

  const search = $('#search');
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(renderSearchPanel, 90);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      renderSearchPanel();
      search.blur();
    }
    if (e.key === 'Enter') {
      const first = runSearch(search.value)[0];
      if (first) {
        location.hash = first.kind === 'model' ? `#/models/${encodeURIComponent(first.id)}` : `#/vendors/${encodeURIComponent(first.id)}`;
        search.value = '';
        renderSearchPanel();
      }
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchpanel') && !e.target.closest('#search')) $('#searchpanel').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
    }
  });
})();

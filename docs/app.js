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

const TYPE_LABEL = { new: '新模型', price: '调价', context: '上下文', retired: '下架', news: '公告' };
const TYPE_RANK = { new: 0, price: 1, context: 2, retired: 3, news: 4 };

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
      <div class="t new"><div class="num">${c.new ?? 0}</div><div class="lbl">新模型</div></div>
      <div class="t price"><div class="num">${c.price ?? 0}</div><div class="lbl">调价</div></div>
      <div class="t ctx"><div class="num">${c.context ?? 0}</div><div class="lbl">上下文变更</div></div>
      <div class="t retired"><div class="num">${c.retired ?? 0}</div><div class="lbl">下架</div></div>
      <div class="t news"><div class="num">${c.news ?? 0}</div><div class="lbl">官方公告</div></div>
    </div>`;

  // 事件流：只显示事实事件 + 未挂到任何模型上的公告
  const facts = (ev?.events ?? []).filter((e) => e.type !== 'news');
  const loose = (ev?.events ?? []).filter((e) => e.type === 'news' && !e.attachedTo);
  const merged = [...facts, ...loose].sort(
    (a, b2) => String(b2.date ?? '').localeCompare(String(a.date ?? '')) || (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b2.type] ?? 9)
  );

  const evHtml = merged.length
    ? merged.map(evCard).join('')
    : `<div class="empty">今天没有记录到原厂模型的变动。<br><span style="font-size:12px">这本身也是一个事实 —— AI 圈并没有每天都发生结构性变化。</span></div>`;

  const boardHtml = Object.entries(BOARD_LABEL)
    .filter(([k]) => (b[k] ?? []).length)
    .map(([k, label]) => {
      const x = b[k][0];
      return `<div class="b">
        <div class="k">${label}</div>
        <div class="v"><a href="#/models/${encodeURIComponent(x.n)}">${esc(x.name)}</a></div>
        <div class="m">${esc(x.vn)}</div>
        <div class="w">${esc(x.metric)} ${k === 'cheapest' || k === 'priciest' ? fmtCost(x.val) : fmtCtx(x.val)}</div>
      </div>`;
    })
    .join('');

  const t = s.totals ?? {};
  const prevS = state.data.events;
  const nav = [
    prevS?.baselineDate ? `<a href="#/models">全部 ${t.originModels ?? 0} 个原厂模型 →</a>` : null,
  ].filter(Boolean).join('');

  return `
    ${banner}${degraded}
    ${tally}
    <div class="cols">
      <div>
        <div class="section">
          <h2>今日事件 <span class="cnt">${merged.length} 条</span></h2>
          ${evHtml}
          ${nav ? `<p style="margin-top:14px;font-size:12.5px">${nav}</p>` : ''}
        </div>
      </div>
      <div>
        <div class="section">
          <h2>当前格局</h2>
          <div class="board">${boardHtml || '<div class="empty">数据不足</div>'}</div>
        </div>
        <div class="section">
          <h2>数据规模</h2>
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
  latest: '最新发布', longestCtx: '最长上下文', cheapest: '最低价', priciest: '最高价',
  cnStrongest: '国产最长上下文', openStrongest: '开源最长上下文', mostChannels: '渠道最多',
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
    <div class="head">
      <span class="tag">${TYPE_LABEL[e.type] ?? e.type}</span>
      <span class="date">${esc(e.date ?? '')}</span>
      <span class="vend">${esc(e.vendorName ?? '')}</span>
    </div>
    <div class="body">${body}</div>
    ${evi || pro || ext ? `<div class="links">${evi}${pro}${ext}</div>` : ''}
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
      <td><a class="mn" href="#/models/${encodeURIComponent(m.n)}">${esc(m.name)}</a>${m.open ? '<span class="chip open">开源</span>' : ''}${m.rsn ? '<span class="chip">推理</span>' : ''}</td>
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
      <h2>模型库 <span class="cnt">${list.length} 个原厂模型</span></h2>
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
    <h1>${esc(m.name)}</h1>
    <p class="sub">${esc(m.vn)} · <a href="#/vendors/${encodeURIComponent(m.v)}">查看该厂商全部模型 →</a></p>
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
        <span class="n"><a href="#/models/${encodeURIComponent(m.n)}">${esc(m.name)}</a></span>
        <span class="v">${esc(m.vn)}</span>
        <span class="c">${fmtCtx(m.ctx)}</span>
      </div>`;
    })
    .join('');
  return `<div class="section">
    <h2>发布时间线 <span class="cnt">${list.length} 个原厂模型 · 按发布时间倒序</span></h2>
    <div class="tl">${rows || '<div class="empty">暂无数据</div>'}</div>
  </div>`;
}

// ---------- 厂商 ----------
function viewVendors() {
  const vs = state.data.vendors?.vendors ?? [];
  const cards = vs
    .map(
      (v) => `<a class="vcard" href="#/vendors/${encodeURIComponent(v.id)}">
      <div class="n">${esc(v.name)}</div>
      <div class="s"><b>${v.n}</b> 个模型 · 最低输入价 <b>${fmtCost(v.cheapest)}</b></div>
      <div class="s">最近发布 ${esc(v.latest ?? '—')}</div>
    </a>`
    )
    .join('');
  return `<div class="section">
    <h2>原厂 <span class="cnt">${vs.length} 家 · 登记在 vendor-registry.js</span></h2>
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
      <td><a class="mn" href="#/models/${encodeURIComponent(m.n)}">${esc(m.name)}</a>${m.open ? '<span class="chip open">开源</span>' : ''}</td>
      <td class="num">${fmtDate(m.rel, m.relP)}</td>
      <td class="num">${fmtCtx(m.ctx)}</td>
      <td class="num">${fmtCost(m.in)}</td>
      <td class="num">${fmtCost(m.oc)}</td>
    </tr>`
    )
    .join('');
  return `<div class="section">
    <h2>${esc(v.name)} <span class="cnt">${mine.length} 个模型</span></h2>
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

    <h2>🚨 我们遇到的第一个真问题：渠道刷屏</h2>
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
      <li>快照每天只拍两次（北京时间 08:30 / 22:14），当天更晚发生的变化要等下一个班次。</li>
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
        <span>${esc(h.title)}</span><span class="vn">${esc(h.vendor)}</span><span class="mt">${esc(h.meta)}</span>
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

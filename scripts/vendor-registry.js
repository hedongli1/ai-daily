// scripts/vendor-registry.js
// 原厂注册表 —— 本项目唯一需要人工维护的一张表。
//
// ── 为什么需要它 ────────────────────────────────────────────────
// models.dev 收录了 222 个「厂商」，但其中真正训练并发布自己模型的只有几十家，
// 其余全是渠道：API 网关（OpenRouter / NanoGPT）、云平台（Bedrock / Vertex）、
// 托管服务（Hugging Face / DeepInfra）、订阅套餐（*-coding-plan）。
//
// 一开始我试图用启发式自动区分，连试三个信号都不成立：
//   · 「聚合率」（我的模型被别家收录的比例）—— 方向反了。网关收录 OpenAI 的
//     模型，会把 OpenAI 自己判成网关。
//   · 「派生率」（名字里包含别家模型名的比例）—— 会被同族命名误伤。
//     谷歌的 gemini-2-5-flash-lite 包含 gemini-2-5-flash，被自己家族判成蹭名。
//   · 「目录体量」—— 抓得住 NanoGPT（576 条），抓不住 Amazon Bedrock（165 条，
//     云转售）和 Helicone（90 条，可观测性网关）。
//
// 每修一次就冒出新反例，说明这类判断本质上依赖人类常识，不是统计能解的。
// ai-model-world（同为 MIT）在它的设计文档里给过同一个结论：系统里唯一依赖
// 人类常识的地方是一张查表。这里照做。
//
// ── 维护成本 ────────────────────────────────────────────────────
// 出现新原厂时需要加一行。为了让这件事不需要你盯着，管线每次运行都会打印
// 「未登记但有新模型的厂商」，把缺口变成可见、可操作的清单（见 fetch.js 结尾）。
//
// ── 怎么加 ──────────────────────────────────────────────────────
//   { id: 'newlab', name: 'NewLab' }                     普通原厂
//   { id: 'zai', name: '智谱 AI', canonical: 'zhipuai' } 同公司另一品牌
// id 用 models.dev 里的键（在未登记清单或快照的 vendors 段可查）。

export const REGISTRY = [
  // ── 海外前沿实验室 ──
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'google', name: '谷歌' },
  { id: 'meta', name: 'Meta' },
  { id: 'xai', name: 'xAI' },
  { id: 'mistral', name: 'Mistral' },
  { id: 'cohere', name: 'Cohere' },
  { id: 'ai21', name: 'AI21 Labs' },
  { id: 'microsoft', name: '微软' },
  { id: 'nvidia', name: '英伟达' },
  { id: 'apple', name: 'Apple' },

  // ── 中国大厂 ──
  { id: 'alibaba', name: '阿里云' },
  { id: 'alibaba-cn', name: '阿里云（国内）', canonical: 'alibaba' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'moonshotai', name: '月之暗面' },
  { id: 'moonshotai-cn', name: '月之暗面（国内）', canonical: 'moonshotai' },
  { id: 'zhipuai', name: '智谱 AI' },
  { id: 'zai', name: '智谱 AI', canonical: 'zhipuai' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'minimax-cn', name: 'MiniMax（国内）', canonical: 'minimax' },
  { id: 'xiaomi', name: '小米' },
  { id: 'stepfun', name: '阶跃星辰' },
  { id: 'stepfun-ai', name: '阶跃星辰（国际）', canonical: 'stepfun' },
  { id: 'sensenova', name: '商汤科技' },
  { id: 'volcengine', name: '字节跳动' },
  { id: 'bailing', name: '蚂蚁百灵' },
  { id: 'longcat', name: '美团 LongCat' },
  { id: 'tencent-tokenhub', name: '腾讯混元' },
  { id: 'tencent-coding-plan', name: '腾讯混元', canonical: 'tencent-tokenhub' },
  { id: 'tencent-token-plan', name: '腾讯混元', canonical: 'tencent-tokenhub' },

  // ── 开源与研究者社区 ──
  { id: 'arcee', name: 'Arcee AI' },
  { id: 'poolside', name: 'Poolside' },
  { id: 'morph', name: 'Morph' },
  { id: 'inception', name: 'Inception' },
  { id: 'upstage', name: 'Upstage' },
  { id: 'sakana', name: 'Sakana AI' },
  { id: 'thinkingmachines', name: 'Thinking Machines' },
  { id: 'sarvam', name: 'Sarvam AI' },
  { id: 'vispark', name: 'Vispark' },
  { id: 'cerebras', name: 'Cerebras' },
  { id: 'perplexity', name: 'Perplexity' },
  { id: 'databricks', name: 'Databricks' },
  { id: 'llama', name: 'Meta', canonical: 'meta' },
];

const BY_ID = new Map(REGISTRY.map((e) => [e.id, e]));

/** 是否原厂（只有原厂发布模型才算「今天发生了什么」）。 */
export function isOriginator(vid) {
  return BY_ID.has(vid);
}

/** 归属于哪个规范厂商（同公司多品牌时指向规范 id）。 */
export function canonicalOf(vid) {
  return BY_ID.get(vid)?.canonical ?? vid;
}

/** 规范厂商的展示名；未登记者回退到 models.dev 的名字。 */
export function displayName(vid, fallback) {
  const canon = canonicalOf(vid);
  return BY_ID.get(canon)?.name ?? BY_ID.get(vid)?.name ?? fallback ?? vid;
}

// ── 品牌家族归属表 ──────────────────────────────────────────────
// 解决「同名模型被多家原厂重复收录」时的归属误判。
//
// 起因：models.dev 没有「谁训练了它」这个字段。同一份 GLM-5.2 会同时躺在
// zhipuai(真原厂) / zai(同品牌) / alibaba / nvidia / sensenova / volcengine
// 等条目下——后四家都登记在原厂注册表里（它们确实是原厂），于是「取原厂条目」
// 这一步无法区分真作者和转售方。方块名人堂对同 norm 条目排序时按 vendor id
// 字母序兜底，实测命中 alibaba → GLM-5.2 被标成「阿里云」、Kimi K3 被标成
// 「阿里云」，这就是用户看到的「信息误差」。
//
// 这张表同样是查表，不做统计猜测：品牌前缀 → 真正的原厂 id。同名条目里若某条
// 的原厂等于该家族 owner，则它胜出；没有任何条目命中家族 owner 时，保持原有
// 确定性顺序（不改口径，只修错配）。
//
// 维护：出现新品牌家族时加一行 [原厂, 名称正则]。正则为便携用归一化名匹配
// （见 lib.js 的 normModelName：小写、去除非字母数字）。
export const MODEL_FAMILY = [
  ['openai', /^(gpt|o1|o3|o4|chatgpt|davinci|textembedding|textmoderation|dalle|whisper|sora|tts)/],
  ['anthropic', /^claude/],
  ['google', /^(gemini|gemma|palm|imagen|veo|learnlm)/],
  ['meta', /^(llama|sam|codellama)/],
  ['xai', /^grok/],
  ['mistral', /^(mistral|mixtral|codestral|pixtral|magistral|devstral)/],
  ['cohere', /^(command|aya|embed)/],
  ['microsoft', /^(phi|mai)/],
  ['nvidia', /^nemotron/],
  ['deepseek', /^deepseek/],
  ['zhipuai', /^(glm|chatglm|cogview|cogvideo)/],
  ['alibaba', /^(qwen|tongyi|wan|qvq)/],
  ['moonshotai', /^kimi/],
  ['minimax', /^minimax/],
  ['stepfun', /^step(\d|[-_ ])/],
  ['sensenova', /^sensenova/],
  ['xiaomi', /^mimo/],
  ['thinkingmachines', /^inkling/],
  ['poolside', /^laguna/],
];

/** 归一化模型名所属的品牌家族原厂 id；无法判定时返回 null。 */
export function familyOwner(norm) {
  for (const [owner, re] of MODEL_FAMILY) if (re.test(norm)) return owner;
  return null;
}

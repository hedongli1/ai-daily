#!/usr/bin/env bash
# 一键把 ai-daily 推到 GitHub 并开启 GitHub Pages。
#
#   GH_TOKEN=<你的 token> bash deploy.sh
#
# token 需要的 scope（仅两个，不要用全量的）：
#   public_repo   建仓库 + push 代码
#   workflow      push .github/workflows/*.yml —— 缺这个必然 403
#
# 用法说明：
#   · token 只出现在本次命令的环境变量里，不会写进 .git/config；
#   · 脚本用 https://<token>@github.com/... 的临时 URL 推送，推完即弃；
#   · 完成后请立刻到 https://github.com/settings/tokens 撤销这枚 token。

set -euo pipefail

REPO="${REPO:-ai-daily}"
OWNER="${OWNER:-hedongli1}"
BRANCH="main"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "❌ 请先设置 GH_TOKEN，例如：GH_TOKEN=ghp_xxx bash deploy.sh" >&2
  exit 1
fi

API="https://api.github.com"
AUTH=(-H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

echo "→ 校验 token …"
ME=$(curl -sf "${AUTH[@]}" "$API/user" || { echo "❌ token 无效" >&2; exit 1; })
LOGIN=$(echo "$ME" | python3 -c 'import sys,json;print(json.load(sys.stdin)["login"])')
echo "  ✓ 登录身份：$LOGIN"
SCOPES=$(curl -sI "${AUTH[@]}" "$API/user" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-oauth-scopes"{print $2}')
echo "  · token scope：${SCOPES:-<无 / 细粒度 token>}"

echo "→ 创建仓库 $OWNER/$REPO …"
CODE=$(curl -s -o /tmp/mk.json -w '%{http_code}' -X POST "${AUTH[@]}" \
  -d "{\"name\":\"$REPO\",\"description\":\"AI 日报 · 用模型数据库的每日差分回答「今天 AI 圈发生了什么」\",\"private\":false,\"has_issues\":true,\"has_wiki\":false}" \
  "$API/user/repos")
if [ "$CODE" = "201" ]; then echo "  ✓ 已创建"
elif [ "$CODE" = "422" ]; then echo "  · 仓库已存在，继续"
else echo "  ❌ 创建失败 HTTP $CODE"; cat /tmp/mk.json; exit 1; fi

echo "→ 推送代码 …"
git init -q 2>/dev/null || true
git branch -M "$BRANCH"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$OWNER/$REPO.git"
git -c user.name="hedongli1" -c user.email="hedongli1@users.noreply.github.com" \
    commit -q -m "feat: ai-daily 初始版本

用模型数据库的每日差分回答「今天 AI 圈发生了什么」。

- 数据层：models.dev 全量快照 + 与昨日差分，产出五类事件（新增/调价/上下文变更/下架/公告）
- 渠道过滤：7870 条条目中 92% 来自 181 家渠道，用人工登记的 33 家原厂注册表区分
- 证据层：厂商官方 RSS / GitHub 动态，只取标题链接，按厂商与时间窗挂到事实事件
- 评测层：Epoch AI（CC-BY 4.0，已署名）
- 站点：零依赖静态页，hash 路由，深/浅双主题
- 自检：78 项纯函数断言 + 44 项无头浏览器核验，全绿" 2>/dev/null || echo "  · 无新提交"

# push URL 内联在命令行，不落进 .git/config
git push -q "https://${OWNER}:${GH_TOKEN}@github.com/${OWNER}/${REPO}.git" "$BRANCH" --force
echo "  ✓ 已推送"

echo "→ 开启 GitHub Pages（source: GitHub Actions）…"
CODE=$(curl -s -o /tmp/pg.json -w '%{http_code}' -X POST "${AUTH[@]}" \
  -d '{"build_type":"workflow"}' "$API/repos/$OWNER/$REPO/pages")
if [ "$CODE" = "201" ] || [ "$CODE" = "204" ]; then echo "  ✓ Pages 已开启"
elif [ "$CODE" = "409" ]; then echo "  · Pages 已存在，改为更新配置"
  curl -s -o /tmp/pg.json -w '' -X PUT "${AUTH[@]}" -d '{"build_type":"workflow"}' "$API/repos/$OWNER/$REPO/pages"
  echo "  ✓ Pages 配置已更新"
else echo "  ⚠️ Pages API 返回 HTTP $CODE —— 请手动到 Settings → Pages 把 Source 设为「GitHub Actions」"; cat /tmp/pg.json; fi

echo "→ 触发一次部署 …"
curl -s -o /dev/null -w '' -X POST "${AUTH[@]}" "$API/repos/$OWNER/$REPO/actions/workflows/deploy.yml/dispatches" -d "{\"ref\":\"$BRANCH\"}" || true

cat <<EOF

✅ 完成

   仓库    https://github.com/$OWNER/$REPO
   站点    https://$OWNER.github.io/$REPO/     （首次部署约需 1～2 分钟）

   后续：
   · daily.yml 会在北京时间 08:30 / 22:14 自动跑，把当天数据提交回仓库
   · 想立刻验证管线，到 Actions 页手动 Run workflow 一次

   ⚠️ 请现在去 https://github.com/settings/tokens 撤销刚才这枚 token。
EOF

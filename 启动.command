#!/bin/bash
# ============================================================
#  摄影作品集 · 本地照片浏览器 —— 一键启动
#  双击运行：自动检测环境 → 装依赖 → 起开发服务器 → 打开浏览器
#  终端运行：./启动.command    （可带端口：./启动.command 8080）
# ============================================================

# 切到脚本所在目录，双击时工作目录会是 $HOME，必须显式切换
DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$DIR" || exit 1

PORT="${1:-3000}"

# ---------- 输出样式 ----------
B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[0m'
G=$'\033[32m'; Y=$'\033[33m'; RED=$'\033[31m'; C=$'\033[36m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✔%s %s\n' "$G" "$R" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$R" "$*"; }
die()  { printf '%s✘ %s%s\n' "$RED" "$*" "$R"; say ""; printf '%s按回车关闭窗口…%s' "$DIM" "$R"; read -r _; exit 1; }

say ""
say "${B}${C}  摄影作品集 · 本地照片浏览器${R}"
say "${DIM}  $DIR${R}"
say ""

# ---------- 1. 定位 Node ----------
# 双击启动走的是干净环境（PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin），
# 不会加载 ~/.zshrc，所以 nvm / fnm / Homebrew / WorkBuddy 内置的 node 都「看不见」。
# 这里按常见安装方式逐个找，找到哪个用哪个。
NODE_DIR=""; NODE_SRC=""
try_dir() {           # $1=候选 bin 目录  $2=来源描述
  [ -n "$NODE_DIR" ] && return 0
  [ -x "$1/node" ] || return 1
  NODE_DIR="$1"; NODE_SRC="$2"
}
latest_in() {         # 取目录下版本号最大的子目录名
  ls "$1" 2>/dev/null | grep -E '^v?[0-9]' | sort -V | tail -1
}

if command -v node >/dev/null 2>&1; then
  NODE_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"; NODE_SRC="PATH 中已有"
else
  # nvm
  n="$(latest_in "$HOME/.nvm/versions/node")"
  try_dir "$HOME/.nvm/versions/node/$n/bin" "nvm"
  [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  command -v node >/dev/null 2>&1 && [ -z "$NODE_DIR" ] && { NODE_DIR="$(cd "$(dirname "$(command -v node)")" && pwd)"; NODE_SRC="nvm"; }
  # fnm
  for base in "$HOME/Library/Application Support/fnm/node-versions" "$HOME/.fnm/node-versions" "$HOME/.local/share/fnm/node-versions"; do
    n="$(latest_in "$base")"
    try_dir "$base/$n/installation/bin" "fnm"
  done
  # Homebrew / 官方 pkg / volta / asdf / pnpm
  try_dir /opt/homebrew/bin "Homebrew"
  try_dir /usr/local/bin "官方安装包"
  try_dir "$HOME/.volta/bin" "Volta"
  try_dir "$HOME/.asdf/shims" "asdf"
  try_dir "$HOME/Library/pnpm" "pnpm"
  # WorkBuddy 内置运行时（本机只有它装了 Node 时的兜底）
  WB="$HOME/.workbuddy/binaries/node/versions"
  if [ -d "$WB" ]; then
    n="$(tr -d '[:space:]' < "$WB/current" 2>/dev/null)"
    [ -x "$WB/$n/bin/node" ] || n="$(latest_in "$WB")"
    try_dir "$WB/$n/bin" "WorkBuddy 内置运行时"
  fi
fi

[ -n "$NODE_DIR" ] || die "没找到 Node.js。

  任选一种装法（装完重新双击本文件）：
    1) 官网安装包：https://nodejs.org  （选 LTS，一路下一步）
    2) Homebrew：  brew install node
    3) nvm：       curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash  &&  nvm install --lts"

export PATH="$NODE_DIR:$PATH"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
[ "${NODE_MAJOR:-0}" -ge 18 ] 2>/dev/null || die "Node 版本过低（当前 $(node -v 2>/dev/null)），本项目需要 ≥ 18，请升级后重试。"
ok "Node $(node -v)  /  npm $(npm -v 2>/dev/null)  ${DIM}($NODE_SRC)${R}"
[ "$NODE_SRC" = "WorkBuddy 内置运行时" ] && warn "当前用的是 WorkBuddy 自带运行时，日常开发建议另装独立 Node（brew install node）"

# ---------- 2. 依赖检查 ----------
if [ ! -x node_modules/.bin/vite ]; then
  warn "依赖缺失，开始安装（首次需要几分钟）…"
  if [ -f package-lock.json ]; then npm ci || die "依赖安装失败，请检查网络（可尝试 npm config set registry https://registry.npmmirror.com）。"
  else npm install || die "依赖安装失败，请检查网络后重试。"; fi
  ok "依赖安装完成"
else
  ok "依赖就绪"
fi

# ---------- 3. 端口检查 ----------
# 不用 lsof 判占用：它在部分受限环境 / 沙箱里对「别的会话启动的进程」不可见，
# 会导致误判成空闲、再去 --strictPort 启动而失败。改从「能不能连上」判断，最可靠。
port_busy() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }

# 已经是本项目的开发服务器？用页面标题做指纹，避免误把别的服务当成自己的
is_our_app() {
  curl -s --max-time 2 "http://127.0.0.1:$1/" 2>/dev/null | grep -q '摄影作品集'
}

if is_our_app "$PORT"; then
  # 上一个开发服务器还活着：直接复用，不再重复启动
  ok "端口 $PORT 上已经是本项目在运行，直接打开浏览器"
  open "http://127.0.0.1:$PORT/"
  say ""
  say "${DIM}  如需重启：lsof -ti tcp:$PORT | xargs kill${R}"
  sleep 2; exit 0
fi

if port_busy "$PORT"; then
  HOLDER="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -Fct 2>/dev/null | tr -d '\n')"
  START=0
  for p in $(seq $((PORT + 1)) $((PORT + 20))); do
    if ! port_busy "$p"; then START=$p; break; fi
  done
  [ "$START" -gt 0 ] || die "端口 $PORT 起连续 20 个端口都被占用了，请手动指定：./启动.command 9000"
  warn "端口 $PORT 被其它程序占用${HOLDER:+（$HOLDER）}，改用 $START"
  PORT="$START"
fi

URL="http://127.0.0.1:$PORT/"

# ---------- 4. 启动 ----------
say ""
say "${DIM}  启动中… 按 Ctrl+C 或关闭本窗口即可停止${R}"
say ""

npm run dev -- --port "$PORT" --strictPort &
SERVER_PID=$!

cleanup() {
  # 退出时收掉整棵子进程树，避免端口被残留进程占着
  kill "$SERVER_PID" 2>/dev/null
  pkill -P "$SERVER_PID" 2>/dev/null
  wait "$SERVER_PID" 2>/dev/null
  say ""
  ok "已停止开发服务器"
}
trap cleanup INT TERM EXIT

# 等服务器真的能响应再开浏览器，避免打开一片白屏
for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 1 "$URL"; then
    open "$URL"
    ok "已在浏览器打开 ${C}$URL${R}"
    say "${DIM}  （提示：导入照片目录请用 Chrome / Edge，Safari 不支持目录选择）${R}"
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || die "开发服务器启动失败，请看上方 Vite 报错信息。"
  sleep 1
done

wait "$SERVER_PID"

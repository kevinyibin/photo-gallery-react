#!/bin/bash
# ============================================================
#  上传代码.command —— 一键提交并推送到 GitHub
#
#  用法（双击，或终端里）：
#    ./上传代码.command                         交互式：看改动 → 填说明 → 提交 → 推送
#    ./上传代码.command "fix: 修好筛选面板"       直接指定提交说明
#    ./上传代码.command -t v1.1.0 "feat: xxx"    顺便打版本标签并推送
#    ./上传代码.command -n                      只提交不推送（预览用）
#    ./上传代码.command --no-check              跳过类型检查
#    ./上传代码.command -y                      不确认，直接提交推送
# ============================================================

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$DIR" || exit 1

# ---------- 输出样式 ----------
B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[0m'
G=$'\033[32m'; Y=$'\033[33m'; RED=$'\033[31m'; C=$'\033[36m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✔%s %s\n' "$G" "$R" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$R" "$*"; }
err()  { printf '%s✘ %s%s\n' "$RED" "$*" "$R"; }
# 双击运行时窗口会一闪而过，出错/结束都要停一下
hold() { [ -t 0 ] && { say ""; printf '%s按回车关闭窗口…%s' "$DIM" "$R"; read -r _; }; }
die()  { err "$*"; say ""; hold; exit 1; }

# ---------- 参数 ----------
MSG=""; TAG=""; DRY_RUN=0; SKIP_CHECK=0; ASSUME_YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 || shift ;;
    -t|--tag)     TAG="${2:-}"; shift 2 || shift ;;
    -n|--dry-run|--no-push) DRY_RUN=1; shift ;;
    --no-check)   SKIP_CHECK=1; shift ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    -h|--help)    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            [ -z "$MSG" ] && MSG="$1"; shift ;;
  esac
done

say ""
say "${B}${C}  上传代码 → GitHub${R}"
say "${DIM}  $DIR${R}"
say ""

# ---------- 1. 仓库体检 ----------
git rev-parse --git-dir >/dev/null 2>&1 || die "这个目录不是 git 仓库。请先执行：git init -b main"
[ -f .git/MERGE_HEAD ] && die "仓库正处于合并中途（有未完成的 merge），请先在终端解决冲突：git status"

REMOTE="$(git remote get-url origin 2>/dev/null || true)"
[ -n "$REMOTE" ] || die "还没有配置远端。先执行：
  git remote add origin https://github.com/<用户名>/<仓库名>.git"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
ok "仓库：$(basename "$DIR")   分支：$BRANCH"
ok "远端：$REMOTE"

# ---------- 2. 看改了什么 ----------
git add -A
CHANGED="$(git diff --cached --name-only)"
N_CHANGED=$(printf '%s' "$CHANGED" | grep -c . || true)

if [ "$N_CHANGED" -eq 0 ]; then
  AHEAD="$(git rev-list --count "@{u}..HEAD" 2>/dev/null || echo 0)"
  if [ "$AHEAD" -gt 0 ]; then
    warn "工作区没有新改动，但有 $AHEAD 个本地提交还没推上去"
  else
    ok "工作区是干净的，没有需要上传的改动"
    hold; exit 0
  fi
else
  say ""
  say "${B}本次改动（$N_CHANGED 个文件）：${R}"
  git diff --cached --stat | sed 's/^/  /'
  # 保险：大文件容易被误提交，超过 5MB 先拦一下
  BIG="$(git diff --cached --name-only -z | while IFS= read -r -d '' f; do
           [ -f "$f" ] || continue
           sz=$(wc -c <"$f" 2>/dev/null || echo 0)
           [ "$sz" -gt 5242880 ] && printf '%s (%sMB)\n' "$f" "$((sz / 1048576))"
         done)"
  if [ -n "$BIG" ]; then
    warn "以下文件超过 5MB，确认是否真的要提交进仓库："
    printf '%s\n' "$BIG" | sed 's/^/    /'
    if [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
      printf '继续？[y/N] '; read -r ans; case "$ans" in y|Y) ;; *) die "已取消（文件仍在暂存区，可用 git reset 撤销）" ;; esac
    fi
  fi
fi

# ---------- 3. 提交说明 ----------
if [ "$N_CHANGED" -gt 0 ] && [ -z "$MSG" ]; then
  # 自动生成一个可用的默认值：按顶层改动位置归纳
  SCOPE="$(printf '%s\n' "$CHANGED" | sed 's#/.*##' | sort -u | paste -sd ',' - | sed 's/,/, /g')"
  MSG="chore: 更新 $N_CHANGED 个文件（$SCOPE）"
  if [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
    say ""
    say "${DIM}提交说明建议用前缀：feat / fix / docs / refactor / chore${R}"
    printf '%s提交说明%s [回车用默认：%s]: ' "$B" "$R" "$MSG"
    read -r input
    [ -n "$input" ] && MSG="$input"
  fi
fi

# ---------- 4. 提交前自检 ----------
if [ "$SKIP_CHECK" -eq 1 ]; then
  warn "已跳过类型检查"
elif [ -x node_modules/.bin/tsc ]; then
  say ""
  printf '类型检查中…'
  if node_modules/.bin/tsc --noEmit >/tmp/upload-tsc.log 2>&1; then
    printf '\r%s✔%s 类型检查通过\n' "$G" "$R"
  else
    printf '\r'; err "类型检查没通过："
    sed -n '1,12p' /tmp/upload-tsc.log | sed 's/^/    /'
    if [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
      printf '仍要提交吗？[y/N] '; read -r ans; case "$ans" in y|Y) ;; *) die "已取消（改动仍在暂存区）" ;; esac
    else
      die "已在非交互模式下中止"
    fi
  fi
fi

# ---------- 5. 确认 ----------
if [ "$N_CHANGED" -gt 0 ] && [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
  say ""
  say "  提交说明：${B}$MSG${R}"
  say "  目标分支：$BRANCH $([ "$DRY_RUN" -eq 1 ] && echo '（仅本地提交，不推送）')"
  printf '确认提交并推送？[Y/n] '
  read -r ans
  case "$ans" in n|N) die "已取消（改动仍在暂存区）" ;; esac
fi

# ---------- 6. 提交 ----------
if [ "$N_CHANGED" -gt 0 ]; then
  git commit -q -m "$MSG" || die "提交失败，请检查上面的输出"
  ok "已提交：$(git log -1 --format='%h %s')"
else
  ok "跳过提交（无新改动）"
fi

# ---------- 7. 推送 ----------
push_once() {
  git push "$@" 2>&1
}

do_push() {
  local out rc
  out="$(push_once -u origin "$BRANCH")"; rc=$?
  if [ $rc -eq 0 ]; then printf '%s\n' "$out"; return 0; fi

  # 网络类失败：如果 shell 里有代理变量，就带上代理重试一次
  if printf '%s' "$out" | grep -qiE 'SSL|Could not resolve|Failed to connect|timed out|Connection reset'; then
    if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
      warn "直连失败，改用代理 ${HTTPS_PROXY:-$https_proxy} 重试…"
      out="$(git -c http.proxy="${HTTPS_PROXY:-$https_proxy}" -c https.proxy="${HTTPS_PROXY:-$https_proxy}" push -u origin "$BRANCH" 2>&1)"; rc=$?
      if [ $rc -eq 0 ]; then printf '%s\n' "$out"; return 0; fi
    else
      printf '%s\n' "$out"
      err "连不上 GitHub（网络问题）。可以："
      say "    1) 开代理后重试本脚本"
      say "    2) 或给 git 配一次代理：git config --global http.proxy http://127.0.0.1:<端口>"
      return $rc
    fi
  fi

  # 远端有新提交：先 rebase 再推
  if printf '%s' "$out" | grep -qiE 'rejected|non-fast-forward|fetch first'; then
    warn "远端有你本地没有的提交，先拉取（rebase）再推…"
    if git pull --rebase --autostash origin "$BRANCH"; then
      out="$(push_once -u origin "$BRANCH")"; rc=$?
      printf '%s\n' "$out"
      return $rc
    fi
    git rebase --abort >/dev/null 2>&1
    err "自动 rebase 失败（可能有冲突），请手动处理：git pull --rebase origin $BRANCH"
    return 1
  fi

  printf '%s\n' "$out"
  return $rc
}

if [ "$DRY_RUN" -eq 1 ]; then
  warn "已跳过推送（-n / --no-push）。稍后手动：git push"
else
  say ""
  printf '推送中…'
  if do_push; then
    printf '\r%s✔%s 已推送到 %s\n' "$G" "$R" "${REMOTE#https://github.com/}"
  else
    printf '\r'; err "推送失败，看上面的原因"
    say ""
    say "  改动已经提交在本地（提交不会丢），修好网络/权限后再运行一次本脚本即可"
    say "  想撤回这次提交：git reset --soft HEAD~1"
    hold; exit 1
  fi
fi

# ---------- 8. 可选打标签 ----------
if [ -n "$TAG" ]; then
  if git rev-parse "$TAG" >/dev/null 2>&1; then
    warn "标签 $TAG 已存在，跳过"
  else
    git tag -a "$TAG" -m "${MSG:-$TAG}" && ok "已创建标签 $TAG"
    if [ "$DRY_RUN" -eq 0 ]; then
      if git push origin "$TAG" >/dev/null 2>&1; then ok "标签已推送（去 GitHub Releases 里发布即可）"
      else warn "标签推送失败，稍后：git push origin $TAG"; fi
    fi
  fi
fi

say ""
ok "完成。远端：${REMOTE%.git}"
say "${DIM}  撤销未提交改动：git restore .   撤销刚才的提交：git reset --soft HEAD~1${R}"
hold

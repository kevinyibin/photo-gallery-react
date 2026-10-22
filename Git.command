#!/bin/bash
# ============================================================
#  Git.command —— 日常 Git 操作面板
#
#  不带参数运行（或双击）：根据仓库当前状态列出「此刻可做」的操作，选号执行。
#
#  也可以直接下命令（脚本化/快捷）：
#    ./Git.command push "fix: 修好筛选面板"   提交并推送
#    ./Git.command commit -m "msg"           只提交
#    ./Git.command pushonly                  只推送已有提交
#    ./Git.command pull | sync               拉取 / 拉取后再推
#    ./Git.command status | log              看状态 / 看历史
#    ./Git.command undo | unstage | uncommit 撤销改动 / 取消暂存 / 撤销上次提交
#    ./Git.command revert [hash]             回滚某次已推送提交（生成反向提交）
#    ./Git.command branch [list|new|switch|merge]
#    ./Git.command tag v1.1.0                打标签并推送
#    ./Git.command abort                     中止 rebase / merge / cherry-pick
#    ./Git.command stash [save|pop|list]
#
#  通用开关：-y 不确认 / -n 只提交不推 / --no-check 跳过类型检查 / -i 强制菜单
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
hr()   { printf '%s\n' "${DIM}────────────────────────────────────────${R}"; }

HOLD_AFTER=0; [ -t 0 ] && [ $# -eq 0 ] && HOLD_AFTER=1
hold() { [ "$HOLD_AFTER" -eq 1 ] && { say ""; printf '%s按回车关闭窗口…%s' "$DIM" "$R"; read -r _; }; return 0; }
die()  { err "$*"; say ""; hold; exit 1; }
pause(){ [ -t 0 ] && { say ""; printf '%s回车返回菜单…%s' "$DIM" "$R"; read -r _; }; return 0; }

# 危险操作确认：非交互 / -y 时直接通过
confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  # 非交互（脚本 / 管道 / CI）且没给 -y：一律按「不继续」处理，
  # 绝不能让「无人应答」变成「默认同意」——撤销改动这类操作不可恢复。
  [ -t 0 ] || return 1
  printf '%s%s%s [y/N] ' "$Y" "$1" "$R"
  read -r a
  case "$a" in y|Y) return 0 ;; *) return 1 ;; esac
}

# ---------- 参数 ----------
ASSUME_YES=0; DRY_RUN=0; SKIP_CHECK=0; MSG=""; TAG_ARG=""; FORCE_MENU=0
CMD=""; SUB=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -m|--message) MSG="${2:-}"; shift 2 || shift ;;
    -t|--tag)     TAG_ARG="${2:-}"; shift 2 || shift ;;
    -n|--dry-run|--no-push) DRY_RUN=1; shift ;;
    --no-check)   SKIP_CHECK=1; shift ;;
    -y|--yes)     ASSUME_YES=1; shift ;;
    -i|--menu)    FORCE_MENU=1; shift ;;
    -h|--help)    sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            ARGS+=("$1"); shift ;;
  esac
done

KNOWN="push commit pushonly pull sync status log undo unstage uncommit revert branch tag abort stash"
if [ ${#ARGS[@]} -gt 0 ]; then
  if printf '%s\n' $KNOWN | grep -qx "${ARGS[0]}"; then
    CMD="${ARGS[0]}"; SUB="${ARGS[1]:-}"
    # 命令后面的第一个位置参数可以是提交说明（push / commit / tag）
    if [ "$CMD" = "tag" ] && [ -n "$SUB" ]; then TAG_ARG="$SUB"; SUB="${ARGS[2]:-}"; fi
    if [ -z "$MSG" ] && { [ "$CMD" = "push" ] || [ "$CMD" = "commit" ]; } && [ -n "$SUB" ]; then MSG="$SUB"; fi
  else
    CMD="push"; [ -z "$MSG" ] && MSG="${ARGS[0]}"     # 直接把第一段当提交说明
  fi
fi

# ---------- 仓库体检 ----------
git rev-parse --git-dir >/dev/null 2>&1 || die "这个目录不是 git 仓库。先执行：git init -b main"
REMOTE="$(git remote get-url origin 2>/dev/null || true)"

# ---------- 仓库上下文 ----------
ctx() {
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  UP="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  AHEAD=0; BEHIND=0
  if [ -n "$UP" ]; then
    read -r BEHIND AHEAD < <(git rev-list --left-right --count "$UP...HEAD" 2>/dev/null || echo "0 0")
  fi
  DIRTY=$(git status --porcelain 2>/dev/null | grep -c . || true)
  DIRTY_TRACKED=$(git status --porcelain 2>/dev/null | grep -vc '^??' || true)
  STAGED=$(git diff --cached --name-only 2>/dev/null | grep -c . || true)
  INPROG=""
  [ -f .git/MERGE_HEAD ] && INPROG="merge"
  [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] && INPROG="rebase"
  [ -f .git/CHERRY_PICK_HEAD ] && INPROG="cherry-pick"
  [ -f .git/REVERT_HEAD ] && INPROG="revert"
  [ -f .git/BISECT_LOG ] && INPROG="bisect"
  return 0
}

# ---------- 推送（含代理回退 / rebase 重试） ----------
push_with_retry() {
  local out rc
  out="$(git push -u origin "$BRANCH" 2>&1)"; rc=$?
  [ $rc -eq 0 ] && { printf '%s\n' "$out"; return 0; }

  if printf '%s' "$out" | grep -qiE 'SSL|Could not resolve|Failed to connect|timed out|Connection reset'; then
    if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
      local px="${HTTPS_PROXY:-$https_proxy}"
      warn "直连失败，改用代理 $px 重试…"
      out="$(git -c http.proxy="$px" -c https.proxy="$px" push -u origin "$BRANCH" 2>&1)"; rc=$?
      [ $rc -eq 0 ] && { printf '%s\n' "$out"; return 0; }
    else
      printf '%s\n' "$out"
      err "连不上 GitHub（网络问题）。"
      say "    1) 开代理后重试"
      say "    2) 或配一次 git 代理：git config --global http.proxy http://127.0.0.1:<端口>"
      return $rc
    fi
  fi

  if printf '%s' "$out" | grep -qiE 'rejected|non-fast-forward|fetch first'; then
    warn "远端有你本地没有的提交，先 rebase 再推…"
    if git pull --rebase --autostash origin "$BRANCH"; then
      out="$(git push -u origin "$BRANCH" 2>&1)"; rc=$?
      printf '%s\n' "$out"; return $rc
    fi
    git rebase --abort >/dev/null 2>&1
    err "自动 rebase 失败（可能有冲突），请手动处理：git pull --rebase origin $BRANCH"
    return 1
  fi
  printf '%s\n' "$out"; return $rc
}

# ---------- A. 提交（+ 可选推送） ----------
flow_commit() {
  local push_flag="$1"
  ctx
  [ "$DIRTY" -eq 0 ] && { ok "工作区是干净的，没有需要提交的改动"; return 0; }

  git add -A
  local changed n
  changed="$(git -c core.quotepath=false diff --cached --name-only)"
  n=$(printf '%s' "$changed" | grep -c . || true)
  say ""
  say "${B}本次改动（$n 个文件）：${R}"
  git -c core.quotepath=false diff --cached --stat | sed 's/^/  /'

  # 大文件拦截
  local big
  big="$(git diff --cached --name-only -z | while IFS= read -r -d '' f; do
           [ -f "$f" ] || continue
           sz=$(wc -c <"$f" 2>/dev/null || echo 0)
           [ "$sz" -gt 5242880 ] && printf '%s (%sMB)\n' "$f" "$((sz / 1048576))"
         done)"
  if [ -n "$big" ]; then
    warn "以下文件超过 5MB，确认是否真要提交："
    printf '%s\n' "$big" | sed 's/^/    /'
    confirm "继续？" || { git reset -q; die "已取消（已取消暂存）"; }
  fi

  # 提交说明
  if [ -z "$MSG" ]; then
    local scope
    scope="$(printf '%s\n' "$changed" | sed 's#/.*##' | sort -u | paste -sd ',' - | sed 's/,/, /g')"
    MSG="chore: 更新 $n 个文件（${scope}）"
    if [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
      say ""
      say "${DIM}前缀建议：feat / fix / docs / refactor / chore${R}"
      printf '%s提交说明%s [回车用默认：%s]: ' "$B" "$R" "$MSG"
      read -r input
      [ -n "$input" ] && MSG="$input"
    fi
  fi

  # 类型检查门禁
  if [ "$SKIP_CHECK" -eq 1 ]; then
    warn "已跳过类型检查"
  elif [ -x node_modules/.bin/tsc ]; then
    printf '类型检查中…'
    if node_modules/.bin/tsc --noEmit >/tmp/git-tsc.log 2>&1; then
      printf '\r%s✔%s 类型检查通过\n' "$G" "$R"
    else
      printf '\r'; err "类型检查没通过："
      sed -n '1,12p' /tmp/git-tsc.log | sed 's/^/    /'
      confirm "仍要提交吗？" || die "已取消（改动仍在暂存区）"
    fi
  fi

  # 确认
  if [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
    say ""
    say "  提交说明：${B}$MSG${R}"
    say "  目标分支：$BRANCH"
    printf '确认提交？[Y/n] '; read -r a
    case "$a" in n|N) die "已取消（改动仍在暂存区）" ;; esac
  fi

  git commit -q -m "$MSG" || die "提交失败，看上面的输出"
  ok "已提交：$(git log -1 --format='%h %s')"

  if [ "$push_flag" = "push" ] && [ "$DRY_RUN" -eq 0 ]; then
    say ""; printf '推送中…'
    if push_with_retry; then
      printf '\r%s✔%s 已推送到 %s\n' "$G" "$R" "${REMOTE#https://github.com/}"
    else
      printf '\r'; err "推送失败，改动已安全留在本地，稍后运行本脚本选「只推送」即可"
      return 1
    fi
  elif [ "$push_flag" = "push" ]; then
    warn "已跳过推送（-n），稍后：./Git.command pushonly"
  fi
  return 0
}

# ---------- B. 只推送 ----------
flow_push_only() {
  ctx
  [ -z "$REMOTE" ] && die "还没有配置远端：git remote add origin <仓库地址>"
  if [ "$AHEAD" -eq 0 ]; then ok "本地没有待推送的提交（已与 $UP 同步）"; return 0; fi
  say "待推送：${B}$AHEAD${R} 个提交 → $UP"
  git -c core.quotepath=false log --oneline "$UP..HEAD" | sed 's/^/  /'
  confirm "现在推送？" || { warn "已取消"; return 0; }
  printf '推送中…'
  if push_with_retry; then printf '\r%s✔%s 推送完成\n' "$G" "$R"; else printf '\r'; err "推送失败"; return 1; fi
}

# ---------- C. 拉取 ----------
flow_pull() {
  ctx
  [ -z "$UP" ] && die "当前分支没有上游，先：git push -u origin $BRANCH"
  [ "$DIRTY_TRACKED" -gt 0 ] && warn "本地有 $DIRTY_TRACKED 处已跟踪文件改动，会用 --autostash 自动暂存/恢复"
  say "拉取 $UP …"
  if git pull --rebase --autostash; then
    ok "已拉取（rebase 模式，保持线性历史）"
  else
    git rebase --abort >/dev/null 2>&1 && warn "已中止 rebase，工作区回到拉取前"
    err "拉取时出现冲突，需要手动解决：git pull --rebase，解决后 git rebase --continue"
    return 1
  fi
}

# ---------- D. 同步（拉取 + 推送） ----------
flow_sync() {
  flow_pull || return 1
  ctx
  if [ "$AHEAD" -gt 0 ]; then flow_push_only; else ok "本地已是最新，无需推送"; fi
}

# ---------- E. 状态 / 历史 ----------
flow_status() {
  ctx
  say ""
  say "${B}分支${R}    $BRANCH${UP:+  →  $UP}"
  say "${B}同步${R}    领先 $AHEAD · 落后 $BEHIND"
  say "${B}改动${R}    $DIRTY 处（其中已暂存 ${STAGED}）"
  [ -n "$INPROG" ] && warn "当前处于 $INPROG 过程未结束，先处理：./Git.command abort"
  say ""; hr
  git -c core.quotepath=false status -sb | sed 's/^/  /'
  if [ "$DIRTY" -gt 0 ]; then
    say ""; say "${B}改动统计${R}"
    git -c core.quotepath=false diff --stat | sed 's/^/  /'
    if [ "$STAGED" -gt 0 ]; then say ""; say "${B}已暂存${R}"; git -c core.quotepath=false diff --cached --stat | sed 's/^/  /'; fi
  fi
  say ""; say "${B}最近 5 次提交${R}"
  git -c core.quotepath=false log --oneline -5 --decorate | sed 's/^/  /'
}

flow_log() {
  git -c core.quotepath=false log --oneline --graph --decorate -20 | sed 's/^/  /'
}

# ---------- F. 撤销类 ----------
flow_undo() {
  ctx
  [ "$DIRTY" -eq 0 ] && { ok "没有未提交的改动，无需撤销"; return 0; }
  git -c core.quotepath=false status --porcelain | sed 's/^/  /'
  say ""
  confirm "丢弃以上所有未提交改动？（不可恢复）" || { warn "已取消"; return 0; }
  git reset -q            # 先取消暂存，restore 才对全部文件生效
  git restore .
  local left
  left=$(git status --porcelain | grep -c '^??' || true)
  ok "已丢弃已跟踪文件的改动"
  [ "$left" -gt 0 ] && say "${DIM}  还有 $left 个未跟踪的新文件保留着（脚本不删文件；要删自己 rm）${R}"
}

flow_unstage() {
  ctx
  [ "$STAGED" -eq 0 ] && { ok "暂存区是空的"; return 0; }
  git restore --staged .
  ok "已取消暂存（改动仍在工作区）"
}

flow_uncommit() {
  git rev-parse HEAD >/dev/null 2>&1 || die "还没有任何提交"
  say "将撤销最后一次提交：${B}$(git log -1 --format='%h %s')${R}"
  say "${DIM}改动会保留在工作区（reset --soft），不会丢${R}"
  confirm "继续？" || { warn "已取消"; return 0; }
  git reset --soft HEAD~1
  ok "已撤销上一次提交，改动已回到暂存区"
}

flow_revert() {
  local hash="$1"
  if [ -z "$hash" ]; then
    say "${B}最近 10 次提交${R}"
    git -c core.quotepath=false log --oneline -10 | nl -w2 -s'  ' | sed 's/^/  /'
    printf '输入要回滚的提交 hash（或序号）：'; read -r pick
    if printf '%s' "$pick" | grep -qxE '[0-9]+'; then
      hash="$(git log --format=%H -10 | sed -n "${pick}p")"
    else
      hash="$pick"
    fi
  fi
  [ -n "$hash" ] || { warn "没有选择，已取消"; return 0; }
  git rev-parse "$hash" >/dev/null 2>&1 || die "找不到提交：$hash"
  say "将生成一条反向提交来抵消：${B}$(git log -1 --format='%h %s' "$hash")${R}"
  confirm "继续？" || { warn "已取消"; return 0; }
  if git revert --no-edit "$hash"; then
    ok "已回滚"
    confirm "现在推送到远端？" && { ctx; push_with_retry || return 1; ok "已推送"; }
  else
    git revert --abort >/dev/null 2>&1
    err "回滚时冲突，已中止。手动处理：git revert $hash"
    return 1
  fi
}

# ---------- G. 分支 ----------
flow_branch() {
  local sub="${1:-list}"
  case "$sub" in
    list)
      ctx
      say "${B}本地分支${R}"
      git branch --format='%(HEAD) %(refname:short)' | sed 's/^\* /→ /; s/^  /  /'
      ;;
    new)
      printf '新分支名：'; read -r nb; [ -n "$nb" ] || { warn "已取消"; return 0; }
      git switch -c "$nb" && ok "已创建并切换到 $nb"
      ;;
    switch)
      git branch --format='%(refname:short)' | nl -w2 -s'  ' | sed 's/^/  /'
      printf '切换到哪里（名称或序号）：'; read -r sb
      if printf '%s' "$sb" | grep -qxE '[0-9]+'; then
        sb="$(git branch --format='%(refname:short)' | sed -n "${sb}p")"
      fi
      [ -n "$sb" ] || { warn "已取消"; return 0; }
      git switch "$sb" && ok "已切换到 $sb"
      ;;
    merge)
      say "${B}把这个分支合并到当前分支（${BRANCH}）${R}"
      git branch --format='%(refname:short)' | grep -v "^$BRANCH$" | nl -w2 -s'  ' | sed 's/^/  /'
      printf '选择要合并的分支（名称或序号）：'; read -r mb
      if printf '%s' "$mb" | grep -qxE '[0-9]+'; then
        mb="$(git branch --format='%(refname:short)' | grep -v "^$BRANCH$" | sed -n "${mb}p")"
      fi
      [ -n "$mb" ] || { warn "已取消"; return 0; }
      confirm "把 $mb 合并进 ${BRANCH}？（会产生合并提交）" || { warn "已取消"; return 0; }
      if git merge --no-ff "$mb"; then ok "已合并 $mb"
      else err "合并有冲突，解决后：git add -A && git commit（或 git merge --abort 放弃）"; return 1; fi
      ;;
    *) die "未知子命令：${sub}（可用 list / new / switch / merge）" ;;
  esac
}

# ---------- H. 标签 ----------
make_tag() {
  [ -n "$TAG_ARG" ] || return 0
  if git rev-parse "$TAG_ARG" >/dev/null 2>&1; then warn "标签 $TAG_ARG 已存在，跳过"; return 0; fi
  git tag -a "$TAG_ARG" -m "${MSG:-$TAG_ARG}" && ok "已创建标签 $TAG_ARG"
  if [ "$DRY_RUN" -eq 0 ]; then
    if git push origin "$TAG_ARG" >/dev/null 2>&1; then ok "标签已推送（到 GitHub Releases 里发布即可）"
    else warn "标签推送失败，稍后：git push origin $TAG_ARG"; fi
  fi
}

# ---------- I. 中止进行中的操作 ----------
flow_abort() {
  ctx
  if [ -z "$INPROG" ]; then ok "当前没有进行中的 rebase / merge / cherry-pick"; return 0; fi
  say "检测到未完成的：${B}$INPROG${R}"
  confirm "中止它并回到操作前？" || { warn "已取消"; return 0; }
  case "$INPROG" in
    merge) git merge --abort ;;
    rebase) git rebase --abort ;;
    cherry-pick) git cherry-pick --abort ;;
    revert) git revert --abort ;;
    bisect) git bisect reset ;;
  esac
  ok "已中止 $INPROG"
}

# ---------- J. 暂存工作区 ----------
flow_stash() {
  local sub="${1:-menu}"
  case "$sub" in
    save)
      confirm "把当前改动收进 stash（工作区变干净）？" || return 0
      git stash push -u -m "手动暂存 $(date '+%m-%d %H:%M')" && ok "已暂存"
      ;;
    pop)
      git stash list | sed 's/^/  /'
      confirm "恢复最近一次 stash？" || return 0
      git stash pop && ok "已恢复"
      ;;
    list) git stash list | sed 's/^/  /' ;;
    menu|*)
      git stash list | sed 's/^/  /'
      say "  1) 保存当前改动到 stash"
      say "  2) 恢复最近一次 stash"
      printf '选择：'; read -r c
      case "$c" in 1) flow_stash save ;; 2) flow_stash pop ;; *) warn "已取消" ;; esac
      ;;
  esac
}

# ============================================================
#  菜单（只在 TTY 下出现；按当前状态决定显示哪些项）
# ============================================================
render_menu() {
  ctx
  local items=() labels=()

  add() { items+=("$1"); labels+=("$2"); }

  say ""
  say "${B}${C}  Git 操作面板${R}  ${DIM}$(basename "$DIR")${R}"
  say "${DIM}  分支 $BRANCH${UP:+ → $UP} · 领先 $AHEAD · 落后 $BEHIND · 改动 $DIRTY 处${R}"
  if [ -n "$INPROG" ]; then warn "有一个未完成的 $INPROG 过程"; fi
  hr

  # 有改动 → 提交类
  if [ "$DIRTY" -gt 0 ]; then
    add commit_push "提交并推送（最常用）"
    add commit_only "只提交，不推送"
    add unstage    "取消暂存（保留改动）"
    add undo       "丢弃所有未提交改动（危险）"
  fi
  # 领先 → 推送
  [ "$AHEAD" -gt 0 ] && add push_only "只推送（$AHEAD 个提交待推）"
  # 落后 → 拉取
  [ "$BEHIND" -gt 0 ] && add pull "拉取远端更新（$BEHIND 个提交）"
  # 任何时候都能看
  add status "查看状态与差异"
  add log    "查看提交历史"
  # 有待合并关系时
  [ "$AHEAD" -gt 0 ] && [ "$BEHIND" -gt 0 ] && add sync "先拉后推（同步）"
  # 有历史才能撤提交
  git rev-parse HEAD >/dev/null 2>&1 && add uncommit "撤销上一次提交（保留改动）"
  git rev-parse HEAD >/dev/null 2>&1 && add revert "回滚某次已推送的提交"
  # 未完成过程 → 中止
  [ -n "$INPROG" ] && add abort "中止 $INPROG"
  # 常规
  add branch "分支：查看 / 新建 / 切换 / 合并"
  add tag    "打版本标签并推送"
  add stash  "暂存工作区 / 恢复暂存"
  add pull   "拉取远端更新"
  add sync   "先拉后推（同步）"

  # 去重（按 key）
  local seen=" " i=0 key
  local out_labels=() out_keys=()
  for key in "${items[@]}"; do
    if printf '%s' "$seen" | grep -q " $key "; then i=$((i+1)); continue; fi
    seen="$seen$key "
    out_keys+=("$key"); out_labels+=("${labels[$i]}")
    i=$((i+1))
  done

  i=1
  for key in "${out_keys[@]}"; do
    printf '  %s%2d%s  %s\n' "$C" "$i" "$R" "${out_labels[$((i-1))]}"
    i=$((i+1))
  done
  printf '  %sq%s   退出\n' "$C" "$R"
  hr

  MENU_KEYS=("${out_keys[@]}")
}

menu_action() {
  case "$1" in
    commit_push) flow_commit push ;;
    commit_only) flow_commit none ;;
    push_only)   flow_push_only ;;
    pull)        flow_pull ;;
    sync)        flow_sync ;;
    status)      flow_status ;;
    log)         flow_log ;;
    undo)        flow_undo ;;
    unstage)     flow_unstage ;;
    uncommit)    flow_uncommit ;;
    revert)      flow_revert "" ;;
    branch)      flow_branch list; say ""; printf '  n. 新建  s. 切换  m. 合并  回车跳过：'; read -r bc
                 case "$bc" in n|N) flow_branch new ;; s|S) flow_branch switch ;; m|M) flow_branch merge ;; esac ;;
    tag)         printf '标签名（如 v1.1.0）：'; read -r t; [ -n "$t" ] && { TAG_ARG="$t"; make_tag; } ;;
    abort)       flow_abort ;;
    stash)       flow_stash menu ;;
    *)           warn "未知操作" ;;
  esac
  return 0
}

run_menu() {
  while true; do
    render_menu
    printf '%s请选择%s（数字 / q 退出）：' "$B" "$R"
    read -r sel || { say ""; return 0; }
    case "$sel" in
      q|Q|"") say ""; ok "已退出"; return 0 ;;
      *[!0-9]*) warn "请输入数字" ; pause ; continue ;;
    esac
    local idx=$((sel - 1))
    if [ "$idx" -lt 0 ] || [ "$idx" -ge "${#MENU_KEYS[@]}" ]; then warn "序号超出范围"; pause; continue; fi
    say ""
    menu_action "${MENU_KEYS[$idx]}"
    pause
    MSG=""; TAG_ARG=""; DRY_RUN=0
  done
}

# ============================================================
#  入口
# ============================================================
if [ "$FORCE_MENU" -eq 1 ]; then
  run_menu; exit 0
fi

if [ -z "$CMD" ]; then
  if [ -t 0 ]; then run_menu; exit 0; fi
  CMD="status"     # 非交互且没给命令：打印状态就退出，绝不挂住
fi

say ""
say "${B}${C}  Git${R}  ${DIM}$DIR${R}"

case "$CMD" in
  push)
    flow_commit push; rc=$?
    [ $rc -eq 0 ] && make_tag
    ;;
  commit)  flow_commit none ;;
  pushonly) flow_push_only ;;
  pull)    flow_pull ;;
  sync)    flow_sync ;;
  status)  flow_status ;;
  log)     flow_log ;;
  undo)    flow_undo ;;
  unstage) flow_unstage ;;
  uncommit) flow_uncommit ;;
  revert)  flow_revert "$SUB" ;;
  branch)  flow_branch "${SUB:-list}" ;;
  tag)     [ -n "$TAG_ARG" ] || die "用法：./Git.command tag v1.1.0"; make_tag ;;
  abort)   flow_abort ;;
  stash)   flow_stash "${SUB:-menu}" ;;
  *)       die "未知命令：${CMD}（-h 看用法）" ;;
esac
rc=$?
[ $rc -ne 0 ] && { say ""; say "${DIM}  提示：改动都在本地，修好问题后再跑一次即可${R}"; }
hold
exit $rc

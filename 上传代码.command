#!/bin/bash
# 兼容旧名字：所有 Git 操作都在 Git.command 里（含交互菜单），这里只做转发。
# 保留它是因为你可能已经习惯双击这个名字；删掉也不影响使用。
exec "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)/Git.command" "$@"

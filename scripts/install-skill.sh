#!/bin/sh
# 安装 fans-vela-daily-register 技能：先落到通用目录 ~/.agents/skills，再给本机已装的 AI 工具软链。
# OpenCode 原生读取通用目录；Cursor / Codex / Hermes 各读自己的 skills 目录，需要软链。
# 本地（开发者）：sh scripts/install-skill.sh
set -eu

NAME=fans-vela-daily-register
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
SRC="$ROOT/.agents/skills/$NAME"
AGENTS_SKILLS="$HOME/.agents/skills"
DEST="$AGENTS_SKILLS/$NAME"

if [ ! -f "$SRC/SKILL.md" ]; then
  printf 'error: %s 不存在，请在仓库内运行\n' "$SRC/SKILL.md" >&2
  exit 1
fi

mkdir -p "$AGENTS_SKILLS"

# 目标已有不同内容时先备份，避免覆盖用户手改过的技能。
if [ -f "$DEST/SKILL.md" ] && ! diff -q "$SRC/SKILL.md" "$DEST/SKILL.md" >/dev/null 2>&1; then
  backup="$DEST.bak-$(date +%Y%m%d%H%M%S)"
  mv "$DEST" "$backup"
  printf '目标技能内容不同，已备份到 %s\n' "$backup"
fi

printf '==> 安装技能到 %s\n' "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
rm -f "$DEST/.DS_Store"

link_if_host() {
  host_root=$1
  skills_dir=$2
  label=$3
  if [ ! -d "$host_root" ]; then
    printf '  跳过 %s（未安装，无 %s）\n' "$label" "$host_root"
    return 0
  fi
  mkdir -p "$skills_dir"
  link="$skills_dir/$NAME"
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    rm -rf "$link"
  fi
  ln -sfn "$DEST" "$link"
  printf '  软链 %s\n' "$link"
}

link_if_host "$HOME/.cursor" "$HOME/.cursor/skills" "Cursor"
link_if_host "$HOME/.codex" "$HOME/.codex/skills" "Codex"
link_if_host "$HOME/.hermes" "$HOME/.hermes/skills" "Hermes"

printf '==> 自检\n'
test -f "$DEST/SKILL.md"
printf '安装完成。\n'
printf '技能：%s\n' "$DEST/SKILL.md"
printf 'OpenCode 直接读取 ~/.agents/skills，无需软链；WorkBuddy 用 npm run pack:release 生成的 ZIP 导入。\n'

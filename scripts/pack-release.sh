#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
project_root=$(pwd -P)
release_dir=${1:-release}
skill_name=fans-vela-daily-register

if ! command -v zip >/dev/null 2>&1; then
  printf '%s\n' '打包技能需要 zip，请先安装。' >&2
  exit 1
fi

mkdir -p "$release_dir"
release_dir=$(cd "$release_dir" && pwd -P)
temp_dir=$(mktemp -d "$release_dir/.pack.XXXXXX")
trap 'rm -rf "$temp_dir"' EXIT

version=$(node -p 'require("./package.json").version')
skill_archive="$skill_name-$version.zip"
(
  cd "$project_root/.agents/skills"
  zip -q -r -X "$temp_dir/$skill_archive" "$skill_name" -x '*/.DS_Store' '*/__MACOSX/*'
)
npm pack --pack-destination "$temp_dir"
mv "$temp_dir"/*.tgz "$temp_dir/$skill_archive" "$release_dir/"
printf '发布包已生成于 %s\n' "$release_dir"

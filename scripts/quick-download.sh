#!/bin/bash

# 快速下载 - 无需确认，直接下载
# 用法: ./scripts/quick-download.sh [课程前缀] [限制数量]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

PREFIX="${1:-COMP}"
LIMIT="${2:-}"

# 加载 .env 文件（如果存在）
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

# 检查凭证
if [[ -z "$HKU_USERNAME" || -z "$HKU_PASSWORD" ]]; then
    echo "错误: 缺少 HKU_USERNAME 或 HKU_PASSWORD"
    echo "请设置环境变量或创建 .env 文件"
    exit 1
fi

ARGS="--prefix $PREFIX"
[[ -n "$LIMIT" ]] && ARGS="$ARGS --limit $LIMIT"

echo "🚀 快速下载模式: $PREFIX"
[[ -n "$LIMIT" ]] && echo "📊 限制数量: $LIMIT"
echo ""

node "$SCRIPT_DIR/download-exambase-pastpapers.mjs" $ARGS

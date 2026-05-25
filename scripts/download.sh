#!/bin/bash

# 快速下载 HKU Past Papers 脚本
# 用法: ./scripts/download.sh [课程前缀] [选项]

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认配置
PREFIX="${1:-COMP}"
LIMIT="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 加载 .env 文件（如果存在）
if [[ -f "$PROJECT_ROOT/.env" ]]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# 检查环境变量
if [[ -z "$HKU_USERNAME" || -z "$HKU_PASSWORD" ]]; then
    echo -e "${RED}错误: 缺少环境变量 HKU_USERNAME 或 HKU_PASSWORD${NC}"
    echo ""
    echo "请设置环境变量:"
    echo "  export HKU_USERNAME=你的UID"
    echo "  export HKU_PASSWORD=你的密码"
    echo ""
    echo "或者创建 .env 文件:"
    echo "  cp scripts/env.example .env"
    echo "  # 编辑 .env 文件填入你的凭证"
    exit 1
fi

# 检查是否有保存的会话
if [[ -f "$PROJECT_ROOT/.exambase-session.json" ]]; then
    echo -e "${GREEN}✓ 发现已保存的登录会话${NC}"
fi

# 构建命令参数
ARGS="--prefix $PREFIX"

if [[ -n "$LIMIT" ]]; then
    ARGS="$ARGS --limit $LIMIT"
fi

# 显示信息
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  HKU Past Paper 批量下载工具${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "课程前缀: ${GREEN}$PREFIX${NC}"
[[ -n "$LIMIT" ]] && echo -e "限制数量: ${GREEN}$LIMIT${NC}"
echo -e "保存目录: ${GREEN}$PROJECT_ROOT/downloads/${NC}"
echo ""

# 先执行 dry-run 确认课程
echo -e "${YELLOW}正在发现课程...${NC}"
echo ""

node "$SCRIPT_DIR/download-exambase-pastpapers.mjs" $ARGS --dry-run 2>/dev/null || true

echo ""
read -p "是否开始下载? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${GREEN}开始下载...${NC}"
    echo ""
    node "$SCRIPT_DIR/download-exambase-pastpapers.mjs" $ARGS
else
    echo -e "${YELLOW}已取消下载${NC}"
    exit 0
fi

#!/bin/bash
# 手动同步插件 SDK 到独立仓库

set -e

# 配置
PLUGIN_SDK_REPO="git@github.com:chuzouX/phira-mp-nodejsver-plugin.git"
PLUGIN_SDK_DIR="/tmp/phira-plugin-sdk-sync"

echo "🔄 开始同步插件 SDK..."

# 1. 克隆或更新插件 SDK 仓库
if [ -d "$PLUGIN_SDK_DIR" ]; then
  echo "📂 更新现有仓库..."
  cd "$PLUGIN_SDK_DIR"
  git pull origin main
else
  echo "📥 克隆插件 SDK 仓库..."
  git clone "$PLUGIN_SDK_REPO" "$PLUGIN_SDK_DIR"
  cd "$PLUGIN_SDK_DIR"
fi

# 2. 复制更新的文件
echo "📋 复制文件..."

# 回到主仓库目录
MAIN_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 复制类型定义
cp "$MAIN_REPO_DIR/plugin-api.d.ts" ./

# 复制示例插件
if [ -d "$MAIN_REPO_DIR/plugins/example" ]; then
  mkdir -p ./example
  cp "$MAIN_REPO_DIR/plugins/example/plugin.yaml" ./example/ 2>/dev/null || true
  cp "$MAIN_REPO_DIR/plugins/example/res/main.ts" ./example/index.ts 2>/dev/null || true
  cp "$MAIN_REPO_DIR/plugins/example/res/main.js" ./example/index.js 2>/dev/null || true
fi

# 复制插件文档
if [ -f "$MAIN_REPO_DIR/Plugins.md" ]; then
  cp "$MAIN_REPO_DIR/Plugins.md" ./
fi

# 3. 检查是否有更改
if git diff --quiet; then
  echo "✅ 没有更改需要同步"
  exit 0
fi

# 4. 提交并推送
echo "💾 提交更改..."
git add .
git commit -m "chore: sync from main repo

Automated sync of:
- plugin-api.d.ts
- example plugin
- documentation

Synced at: $(date '+%Y-%m-%d %H:%M:%S')"

echo "📤 推送到远程..."
git push origin main

echo "✅ 同步完成！"

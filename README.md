# Phira Multiplayer Server (Node.js)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

高性能、可扩展的 Phira 节奏游戏多人联机服务器（Node.js/TypeScript 实现）。

## 📚 文档

- [中文文档](docs/README-CN.md)
- [English Documentation](docs/README.md)
- [插件开发指南](docs/Plugins.md)

## ✨ 特性

- 🚀 **高性能** - TCP/WebSocket 双协议支持
- 🔌 **插件系统** - 强大的插件架构，易于扩展
- 🌐 **联邦网络** - 去中心化多服互联
- 📊 **Web 面板** - 完整的管理界面
- 🛡️ **安全机制** - IP 封禁、黑名单、验证码

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 配置服务器参数

# 启动开发服务器
npm run dev

# 或生产环境
npm start
```

## 📖 目录结构

```
phira-mp-server/
├── src/              # 源代码
├── plugins/          # 插件目录
├── config/           # 运行时配置
├── test/             # 测试文件
├── docs/             # 文档
└── scripts/          # 工具脚本
```

## 🔧 命令

```bash
npm run dev          # 开发模式（自动重启）
npm start            # 生产模式
npm test             # 运行测试
npm run build        # 编译 TypeScript
npm run lint         # 代码检查
```

## 📄 许可证

[MIT License](LICENSE)

# 项目目录结构

```
phira-mp-server/
├── src/                    # 源代码
│   ├── app.ts             # 应用入口
│   ├── index.ts           # 启动文件
│   ├── common/            # 通用工具
│   ├── config/            # 配置管理
│   ├── logging/           # 日志系统
│   ├── network/           # 网络层（TCP/HTTP）
│   ├── domain/            # 业务逻辑
│   │   ├── auth/         # 认证
│   │   ├── rooms/        # 房间管理
│   │   ├── protocol/     # 协议处理
│   │   └── plugins/      # 插件核心
│   └── federation/        # 联邦网络
│
├── plugins/               # 插件系统
│   ├── example/          # 示例插件
│   │   ├── plugin.yaml   # 元数据
│   │   └── res/          # 资源
│   │       └── main.ts   # 入口
│   ├── web-dashboard/    # Web 管理面板
│   │   ├── plugin.yaml
│   │   └── res/
│   │       ├── main.ts
│   │       └── public/   # 静态资源
│   ├── websocket/        # WebSocket 支持
│   └── tsconfig.json     # 插件编译配置
│
├── config/                # 运行时配置
│   ├── example/
│   │   └── config.yaml
│   └── web-dashboard/
│       ├── config.yaml           # 实际配置（不提交）
│       └── config.yaml.example   # 配置模板
│
├── test/                  # 测试文件
│   ├── *.test.ts         # 单元测试
│   └── integration.test.ts
│
├── docs/                  # 文档
│   ├── README.md         # 英文文档
│   ├── README-CN.md      # 中文文档
│   └── Plugins.md        # 插件开发指南
│
├── scripts/              # 工具脚本
│   └── generate_secret.py
│
├── data/                 # 运行时数据（不提交）
│   └── bans.json
│
├── logs/                 # 日志文件（不提交）
├── dist/                 # 编译输出（不提交）
├── outputs/              # 打包输出（不提交）
│
├── .env                  # 环境配置（不提交）
├── .env.example          # 环境配置模板
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript 配置
├── jest.config.js        # 测试配置
├── plugin-api.d.ts       # 插件类型定义
└── README.md             # 项目简介
```

## 核心目录说明

### `src/` - 源代码
服务器核心代码，使用 TypeScript 编写。

### `plugins/` - 插件系统
所有插件的源代码和资源文件。插件使用元数据文件 `plugin.yaml` 描述。

### `config/` - 运行时配置
插件的配置文件，不包含在 git 中（敏感信息）。

### `docs/` - 文档
所有项目文档和开发指南。

### `scripts/` - 工具脚本
开发和运维工具脚本。

## 配置文件

- `.env` - 服务器环境配置（不提交）
- `config/*/config.yaml` - 插件配置（不提交）
- `*.example` - 配置模板（提交到 git）

## 编译产物

- `dist/` - TypeScript 编译输出
- `plugins/*/res/**/*.js` - 插件编译输出
- `outputs/` - 可执行文件打包输出

所有编译产物都不提交到 git。

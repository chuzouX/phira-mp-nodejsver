## [0.6.1] — 2026-07-20

### 🔌 联邦插件化

联邦网络从核心代码剥离为独立插件 `plugins/federation/`：
- 联邦配置由 `.env` 迁移至 `config/federation/config.yaml`
- 联邦 HTTP 路由（handshake、health、peers、rooms、proxy 等 9 个端点）由插件自行注册
- 新增 `addVirtualSession` / `removeVirtualSession` 通用虚拟会话 API
- 新增 `registerFederationManager` / `federationManager` 懒获取
- 修复联邦代理路由缺失导致跨服加入房间失败的 bug

### ⚡ 性能优化

- **`userRoomIndex`** — `getRoomByUserId` 从 O(n) 全房间扫描改为 O(1) Map 索引查找
- **`removePlayerFromAllRooms`** — O(n) → O(1)
- **缓存联邦开关** — `broadcastMessage` 热路径省去 property chain 访问
- **精简 respond** — 每次响应省去枚举反向查找和 session 查询
- **localhost 跳过连接限制** — 本地压测不再受 50/IP 限制

### 📐 代码重构

- **ProtocolHandler** 拆分（85KB → 35KB）：按职责提取 auth / room / game / chat / input 6 个 handler
- **ConsoleInterface** 拆分（38KB → 14KB）：按命令类型提取 room / ban / admin / plugins 4 个 handler
- **PluginManager** 拆分（38KB → 29KB）：提取 `PluginApiFactory.ts`
- **ESLint v9 迁移**：`.eslintrc.cjs` → `eslint.config.js`

### 🧹 垃圾清理

删除死代码：`src/common/UrlUtils.ts`、`src/federation/`、`DashboardSupport.ts`、`scripts/sync-plugin-sdk.sh`、`env` 导出、`parseStringList`、`ProtocolOptions`/`LoggingOptions` 接口

### 🔧 压测工具

新增 `tools/stress-test/` 压力测试工具包：
- TCP 二进制协议客户端，支持 PROXY v2
- 帧队列响应匹配，解决合帧乱序
- 4 种场景：connection / room / chat / mixed
- 多线程并发（`src/multi.ts` + `child_process.fork`）
- 虚拟 token 认证绕过（`stress_` 前缀，生产环境禁用）

### 🛡️ 安全

- 虚拟 token 仅在 `NODE_ENV !== 'production'` 时生效
- 生产环境下 `stress_` token 走正常认证流程，安全无影响

### 📖 文档

- 重写根 README.md 为完整英文文档，含性能数据
- 更新 `docs/Plugins.md`：新增 federation / titles / tournament 插件说明
- 更新 `docs/README-CN.md`：联邦改为插件配置

### 📊 基准测试

| 指标 | 数值 |
|------|------|
| 零错误最大并发 | 5,000 连接+认证 |
| 极限并发 | 10,000 TCP 连接 |
| 连接 TPS | 620 |
| 房间操作 TPS | 290（零错误） |

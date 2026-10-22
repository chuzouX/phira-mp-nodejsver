## [Unreleased]

- 修复 `npm run package:all` 被 `pkg-fetch` 内置 Node 22.23.2 阻断：切换至 Enhanced SEA，固定下载官方 Node 22.23.4 并校验下载校验和，保留安全版本检查。
- Windows、Linux 和 macOS 的输出文件名不变；Linux 静态版暂不支持，执行 `package:linux-static` 会给出明确说明，不回退到旧运行时。

## [0.7.0] — 2026-10-22

### 安全修复

- 针对 [CVE-2026-111497 Brotli 解码器越界写漏洞](https://developer.aliyun.com/article/1773852)，将运行环境要求提升为 Node.js **22.23.4+、24.22.1+ 或 26.12.1+**（限对应主版本分支），启动时拒绝旧版、预发布版及未经核验的运行时。
- HTTP JSON 与表单请求体关闭自动解压，压缩请求返回 HTTP 415，避免请求体解析器直接调用 Brotli 解码器。此措施是纵深防御，不能替代运行时升级；上游响应和插件仍可能使用原生解压。
- 可执行文件打包目标由 Node 18 迁移至 Node 22，同时校验打包工具实际选择的内置 Node 补丁版本，防止用新版本号重新分发旧漏洞运行时。
- CI 验证基线更新为上述三个已修复版本，新增运行时版本边界及 Brotli 请求体拦截测试。

本次发布仅提供源码，不包含单文件可执行程序。已核验打包器 6.23.0 仍选择 Node 22.23.2，因此禁止生成并分发该旧运行时。

### 升级说明

- 先升级 Node.js，再安装依赖、重新构建并重启服务。旧版运行时会被启动检查拒绝。
- HTTP API 客户端需发送未压缩的 JSON 或表单请求体；压缩请求体不再受支持。
- 独立可执行文件必须重新构建；仅修改系统 Node.js 不会修复旧可执行文件内置的运行时。打包器不具备安全运行时时将停止打包，不应绕过检查。
- Web Dashboard / WebSocket 属于独立插件仓库，插件的安全修复须通过对应插件更新分发。

参考：[Node.js 2026 年 10 月官方安全公告](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)。

## [0.6.3] — 2026-10-13

### 🛡️ 安全审计漏洞修复 (Security Hardening)

依据白盒安全审计报告，全面修复 V-01 至 V-10 共 10 项安全问题：

- **V-01 虚拟 Token 绕过与提权防护**:
  - `NODE_ENV === 'production'` 启动时强置虚拟认证关闭（`STRESS_VIRTUAL_AUTH = false`）。
  - 开发压测环境下虚拟 Token 本地直接生成负数区间用户 ID，跳过 Phira 远程网络调用，特权检查强制要求 `userId > 0`。
  - 未开启虚拟认证时直接快速拒绝 `stress_` 前缀连接并记录可疑活动。
- **V-02 `X-Admin-Secret` 垂直越权修复**:
  - 限制 `X-Admin-Secret` 仅代表 Admin 级外部鉴权，禁止访问 Owner 专属端点（直接返回 HTTP 403 Forbidden）。
- **V-03 CORS 统一治理**:
  - 移除 HTTP 宿主全局通配跨域头，按需对只读端点设置 `Access-Control-Allow-Origin: *`。
  - Web 面板仅针对配置白名单 `allowedOrigins` 严格比对并下发跨域凭据响应头。
- **V-04 弱密钥动态安全回退**:
  - 增加弱密钥与默认示例密钥检测，回退至强随机运行时密钥并输出控制台告警。
- **V-05 房间黑/白名单类型收敛与逻辑加固**:
  - 严格校验 `userIds` 为正整数数组，非法类型直接返回 HTTP 400；`RoomManager` 防御式去重与整数清洗。
- **V-06 ULEB128 解码边界与 CPU DoS 防护**:
  - `BinaryReader.uleb()` 增加 `shift > 63n` 上限拦截，阻断超长畸形数据包导致的 CPU 放大攻击；增加缓冲区剩余长度预检。
- **V-07 AES Admin Token 时间戳验证与防重放**:
  - 支持 `${timestamp}_${nonce}_${secret}_xy521` 格式与 5 分钟有效窗口校验；内存缓存 Nonce 阻断重放攻击；向下兼容旧版并打印废弃告警。
- **V-08 聊天消息长度限制**:
  - `handleChat` 限制单条消息最大 2048 字符，超长消息快速拦截。
- **V-09 控制台密码策略加固**:
  - `server-control` 识别默认哈希与未配置状态，强行阻断面板登录认证（HTTP 503）。
- **V-10 联邦路由规范注册与生命周期包装**:
  - `PluginManager` 维护 `initializingPlugins` 状态集，支持插件 `init()` 阶段正常握手，并将联邦路由规范注册纳入生命周期监管。

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

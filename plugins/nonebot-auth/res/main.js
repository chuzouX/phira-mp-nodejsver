"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
/**
 * NoneBot Auth Plugin
 *
 * 提供基于密钥的管理员鉴权，适用于：
 * - 外部脚本自动化操作
 * - 机器人/Bot 访问
 * - CI/CD 流程集成
 * - 无浏览器环境的 API 调用
 *
 * ## 依赖说明
 * - 依赖 web-dashboard 插件（需要 HTTP 服务器和路由注册能力）
 * - web-dashboard 提供基础的 Web UI 和 Session 鉴权
 * - 本插件提供独立的 Secret 鉴权机制
 *
 * ## 使用方法
 * 1. 在 .env 中设置 ADMIN_SECRET（强随机字符串）
 * 2. 客户端发送请求时，在 X-Admin-Secret 请求头中携带加密后的密钥
 * 3. 加密算法：SHA-256(ADMIN_SECRET + timestamp)，其中 timestamp 为当前时间戳（秒）
 *
 * ## 请求示例
 * ```bash
 * SECRET="your-admin-secret"
 * TIMESTAMP=$(date +%s)
 * HASH=$(echo -n "${SECRET}${TIMESTAMP}" | sha256sum | cut -d' ' -f1)
 *
 * curl -H "X-Admin-Secret: ${HASH}" \
 *      -H "X-Admin-Timestamp: ${TIMESTAMP}" \
 *      http://localhost:8080/api/admin/status
 * ```
 *
 * ## 安全特性
 * - 时间戳验证（防重放攻击，5分钟有效期）
 * - SHA-256 哈希加密
 * - 独立于 Session 的鉴权机制
 * - 可配置的哈希算法
 */
const pluginModule = {
    name: 'nonebot-auth',
    init(api) {
        const app = api.getExpressApp();
        if (!app) {
            api.logger.warn('[NoneBotAuth] HTTP 服务未启用，跳过插件加载');
            return;
        }
        // 读取配置
        const pluginConfig = api.readPluginConfig() ?? {};
        const adminSecret = pluginConfig.adminSecret || process.env.ADMIN_SECRET;
        const hashAlgorithm = pluginConfig.secretHashAlgorithm || 'sha256';
        const enableLogging = pluginConfig.enableLogging ?? true;
        if (!adminSecret) {
            api.logger.warn('[NoneBotAuth] ADMIN_SECRET 未配置，插件功能将不可用');
            api.logger.warn('[NoneBotAuth] 请在 config/nonebot-auth/config.yaml 中修改配置');
            return;
        }
        // 中间件：验证 Admin Secret
        const verifyAdminSecret = (req, res, next) => {
            const secretHeader = req.headers['x-admin-secret'];
            const timestampHeader = req.headers['x-admin-timestamp'];
            if (!secretHeader || !timestampHeader) {
                return res.status(401).json({
                    error: 'Unauthorized: Missing X-Admin-Secret or X-Admin-Timestamp header',
                    hint: 'Use X-Admin-Secret: SHA256(ADMIN_SECRET + timestamp) and X-Admin-Timestamp: <unix_timestamp>'
                });
            }
            // 验证时间戳（防重放攻击）
            const timestamp = parseInt(timestampHeader, 10);
            const now = Math.floor(Date.now() / 1000);
            const timeDiff = Math.abs(now - timestamp);
            if (timeDiff > 300) { // 5分钟有效期
                return res.status(401).json({
                    error: 'Unauthorized: Timestamp expired',
                    hint: 'Request must be sent within 5 minutes'
                });
            }
            // 验证密钥
            const expectedHash = crypto_1.default
                .createHash(hashAlgorithm)
                .update(adminSecret + timestamp)
                .digest('hex');
            if (secretHeader !== expectedHash) {
                if (enableLogging) {
                    api.logger.warn(`[NoneBotAuth] 无效的密钥尝试，IP: ${req.ip}`);
                }
                return res.status(401).json({ error: 'Unauthorized: Invalid secret' });
            }
            if (enableLogging) {
                api.logger.info(`[NoneBotAuth] 密钥验证成功，IP: ${req.ip}`);
            }
            // 验证成功，继续处理
            next();
        };
        // 注册中间件到全局（可选，也可以只在特定路由使用）
        // app.use('/api/admin/*', verifyAdminSecret);
        // 示例：注册一个需要 Admin Secret 的测试路由
        app.get('/api/nonebot/test', verifyAdminSecret, (req, res) => {
            res.json({
                success: true,
                message: 'Admin Secret authentication successful',
                timestamp: Math.floor(Date.now() / 1000)
            });
        });
        // 示例：获取服务器状态（需要 Admin Secret）
        app.get('/api/nonebot/status', verifyAdminSecret, (req, res) => {
            const rooms = api.roomManager.listRooms();
            const players = api.protocolHandler.getAllSessions();
            res.json({
                success: true,
                data: {
                    serverName: api.config.serverName,
                    roomCount: rooms.length,
                    playerCount: players.length,
                    timestamp: Math.floor(Date.now() / 1000)
                }
            });
        });
        // 导出中间件供其他插件使用
        api.adminSecretAuthMiddleware = verifyAdminSecret;
        api.logger.info('[NoneBotAuth] 插件已加载，Admin Secret 鉴权已启用');
        api.logger.info(`[NoneBotAuth] 哈希算法: ${hashAlgorithm.toUpperCase()}`);
        api.logger.info('[NoneBotAuth] 可用端点: /api/nonebot/test, /api/nonebot/status');
    },
    destroy() {
        // 清理资源（如果需要）
    }
};
exports.default = pluginModule;

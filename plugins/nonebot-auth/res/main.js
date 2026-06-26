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
        const authMode = pluginConfig.authMode || 'both'; // 默认支持两种认证方式
        if (!adminSecret) {
            api.logger.warn('[NoneBotAuth] ADMIN_SECRET 未配置，插件功能将不可用');
            api.logger.warn('[NoneBotAuth] 请在 config/nonebot-auth/config.yaml 中修改配置');
            return;
        }
        // AES-256-CBC 解密函数（兼容 nonebot 插件）
        function decryptAesCbcToken(encryptedHex, secret) {
            try {
                const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
                if (encryptedBuffer.length < 17)
                    return null; // 至少 16 字节 IV + 1 字节数据
                const iv = encryptedBuffer.subarray(0, 16);
                const ciphertext = encryptedBuffer.subarray(16);
                const key = crypto_1.default.createHash('sha256').update(secret).digest();
                const decipher = crypto_1.default.createDecipheriv('aes-256-cbc', key, iv);
                let decrypted = decipher.update(ciphertext);
                decrypted = Buffer.concat([decrypted, decipher.final()]);
                return decrypted.toString('utf-8');
            }
            catch {
                return null;
            }
        }
        // 验证 AES-256-CBC token（兼容 nonebot 插件）
        function verifyAesCbcToken(token, secret) {
            const decrypted = decryptAesCbcToken(token, secret);
            if (!decrypted)
                return false;
            // 解密后的格式：{date}_{secret}_xy521
            const dateStr = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
            const expectedPlain = `${dateStr}_${secret}_xy521`;
            return decrypted === expectedPlain;
        }
        // 中间件：验证 Admin Secret（支持多种认证方式）
        const verifyAdminSecret = (req, res, next) => {
            const secretHeader = req.headers['x-admin-secret'];
            if (!secretHeader) {
                return res.status(401).json({
                    error: 'Unauthorized: Missing X-Admin-Secret header',
                    hint: 'Use X-Admin-Secret: <token>'
                });
            }
            let authenticated = false;
            // 方式1：AES-256-CBC 认证（nonebot 插件使用）
            if (authMode === 'aes-cbc' || authMode === 'both') {
                if (verifyAesCbcToken(secretHeader, adminSecret)) {
                    authenticated = true;
                    if (enableLogging) {
                        api.logger.info(`[NoneBotAuth] AES-CBC 密钥验证成功，IP: ${req.ip}`);
                    }
                }
            }
            // 方式2：SHA-256 哈希认证（传统方式）
            if (!authenticated && (authMode === 'sha256' || authMode === 'both')) {
                const timestampHeader = req.headers['x-admin-timestamp'];
                if (timestampHeader) {
                    const timestamp = parseInt(timestampHeader, 10);
                    const now = Math.floor(Date.now() / 1000);
                    const timeDiff = Math.abs(now - timestamp);
                    if (timeDiff <= 300) { // 5分钟有效期
                        const expectedHash = crypto_1.default
                            .createHash(hashAlgorithm)
                            .update(adminSecret + timestamp)
                            .digest('hex');
                        if (secretHeader === expectedHash) {
                            authenticated = true;
                            if (enableLogging) {
                                api.logger.info(`[NoneBotAuth] SHA-256 密钥验证成功，IP: ${req.ip}`);
                            }
                        }
                    }
                    else if (enableLogging) {
                        api.logger.warn(`[NoneBotAuth] 时间戳过期，IP: ${req.ip}`);
                    }
                }
            }
            if (!authenticated) {
                if (enableLogging) {
                    api.logger.warn(`[NoneBotAuth] 无效的密钥尝试，IP: ${req.ip}`);
                }
                return res.status(401).json({ error: 'Unauthorized: Invalid secret' });
            }
            // 验证成功，继续处理
            next();
        };
        // 导出中间件和认证函数供其他插件使用
        api.adminSecretAuthMiddleware = verifyAdminSecret;
        api.verifyAesCbcToken = verifyAesCbcToken;
        api.logger.info('[NoneBotAuth] 插件已加载，Admin Secret 鉴权已启用');
        api.logger.info(`[NoneBotAuth] 哈希算法: ${hashAlgorithm.toUpperCase()}`);
        api.logger.info(`[NoneBotAuth] 认证模式: ${authMode}`);
        api.logger.info('[NoneBotAuth] 中间件已导出，其他插件可使用 api.adminSecretAuthMiddleware');
    },
    destroy() {
        // 清理资源（如果需要）
    }
};
exports.default = pluginModule;

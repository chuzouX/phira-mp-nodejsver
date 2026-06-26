"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_session_1 = __importDefault(require("express-session"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const crypto_1 = __importDefault(require("crypto"));
// 读取服务端版本号（兼容源码开发和二进制分发）
const version = (() => {
    try {
        return require('../../package.json').version;
    }
    catch {
        return 'unknown';
    }
})();
class WebDashboardPlugin {
    constructor(config, logger, roomManager, protocolHandler, banManager, api, federationManager) {
        this.config = config;
        this.logger = logger;
        this.roomManager = roomManager;
        this.protocolHandler = protocolHandler;
        this.banManager = banManager;
        this.api = api;
        this.federationManager = federationManager;
        this.loginAttempts = new Map();
        this.blacklistedIps = new Map();
        this.blacklistFile = path_1.default.join(process.cwd(), 'data', 'login_blacklist.json');
        this.runtimeIconFile = path_1.default.join(process.cwd(), 'icon.png');
        this.bundledDefaultIconFile = path_1.default.join(__dirname, '../../icon.png');
        this.rateLimits = new Map();
        this.cachedStatus = null;
        this.statusCacheTime = 0;
        this.lastFederationRoomCount = -1;
        this.userSessions = new Map();
        const app = this.api.getExpressApp();
        if (!app) {
            throw new Error('web-dashboard requires express app');
        }
        this.app = app;
        this.app.set('trust proxy', this.config.trustProxyHops);
        this.sessionParser = (0, express_session_1.default)({
            secret: this.config.sessionSecret ?? 'a-very-insecure-secret-change-it',
            resave: false,
            saveUninitialized: true,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            }
        });
        this.setupMiddleware();
        this.setupRoutes();
        this.setupFederationRoutes();
        this.loadBlacklist();
        this.cleanupInterval = setInterval(() => {
            this.cleanupLoginAttemptsAndRateLimits();
        }, 60 * 60 * 1000);
        logger.info('[WebDashboard] 插件已初始化');
    }
    cleanupLoginAttemptsAndRateLimits() {
        const now = Date.now();
        for (const [ip, attempt] of this.loginAttempts.entries()) {
            if (now - attempt.lastAttempt > 15 * 60 * 1000) {
                this.loginAttempts.delete(ip);
            }
        }
        for (const [ip, limit] of this.rateLimits.entries()) {
            if (now - limit.lastReset > 60 * 1000) {
                this.rateLimits.delete(ip);
            }
        }
    }
    rateLimitMiddleware(req, res, next) {
        const ip = this.getRealIp(req);
        const now = Date.now();
        const limit = this.rateLimits.get(ip) || { count: 0, lastReset: now };
        if (now - limit.lastReset > 60000) {
            limit.count = 0;
            limit.lastReset = now;
        }
        limit.count++;
        this.rateLimits.set(ip, limit);
        if (limit.count > 60) {
            res.status(429).json({ error: 'Too many requests. Please slow down.' });
            return;
        }
        next();
    }
    loadBlacklist() {
        if (fs_1.default.existsSync(this.blacklistFile)) {
            try {
                const data = fs_1.default.readFileSync(this.blacklistFile, 'utf8');
                const entries = JSON.parse(data);
                if (typeof entries === 'object' && !Array.isArray(entries)) {
                    Object.entries(entries).forEach(([ip, expiresAt]) => {
                        this.blacklistedIps.set(ip, Number(expiresAt));
                    });
                }
                else if (Array.isArray(entries)) {
                    entries.forEach(ip => this.blacklistedIps.set(ip, Date.now() + 365 * 24 * 3600 * 1000));
                }
                this.cleanupBlacklist();
                this.logger.info(`[WebDashboard] 已从文件加载 ${this.blacklistedIps.size} 个登录黑名单 IP。`);
            }
            catch (e) {
                this.logger.error(`[WebDashboard] 加载登录黑名单文件失败: ${e}`);
            }
        }
    }
    saveBlacklist() {
        try {
            const dir = path_1.default.dirname(this.blacklistFile);
            if (!fs_1.default.existsSync(dir)) {
                fs_1.default.mkdirSync(dir, { recursive: true });
            }
            const data = Object.fromEntries(this.blacklistedIps);
            fs_1.default.writeFileSync(this.blacklistFile, JSON.stringify(data, null, 2));
        }
        catch (e) {
            this.logger.error(`[WebDashboard] 保存登录黑名单失败: ${e}`);
        }
    }
    cleanupBlacklist() {
        const now = Date.now();
        let changed = false;
        for (const [ip, expiresAt] of this.blacklistedIps.entries()) {
            if (expiresAt < now) {
                this.blacklistedIps.delete(ip);
                changed = true;
            }
        }
        if (changed)
            this.saveBlacklist();
    }
    getRealIp(req) {
        const ip = req.ip;
        const isLocal = !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        if (isLocal) {
            const xRealIp = req.headers['x-real-ip'];
            if (xRealIp && typeof xRealIp === 'string') {
                return xRealIp.trim();
            }
        }
        return ip || req.socket.remoteAddress || 'unknown';
    }
    isBlacklisted(ip) {
        const expiresAt = this.blacklistedIps.get(ip);
        if (!expiresAt)
            return false;
        if (expiresAt < Date.now()) {
            this.blacklistedIps.delete(ip);
            this.saveBlacklist();
            return false;
        }
        return true;
    }
    logToBlacklist(ip, username) {
        const duration = this.config.loginBlacklistDuration ?? 600;
        const expiresAt = Date.now() + duration * 1000;
        this.blacklistedIps.set(ip, expiresAt);
        this.saveBlacklist();
        const durationStr = duration >= 3600 ? `${(duration / 3600).toFixed(1)}小时` : `${Math.floor(duration / 60)}分钟`;
        this.logger.ban(`[WebDashboard] IP ${ip} 因多次登录失败（尝试用户名: ${username}）被自动加入登录黑名单。时长: ${durationStr}`);
    }
    async verifyCaptcha(req, ip) {
        const provider = this.config.captchaProvider;
        if (provider === 'none') {
            return { success: true };
        }
        if (provider === 'geetest') {
            const { lot_number, captcha_output, pass_token, gen_time } = req.body;
            if (!lot_number || !captcha_output || !pass_token || !gen_time) {
                return { success: false, message: 'Missing Geetest parameters.' };
            }
            if (!this.config.geetestId || !this.config.geetestKey) {
                this.logger.error('[WebDashboard] Geetest ID or Key missing in configuration');
                return { success: false, message: 'Captcha configuration error.' };
            }
            try {
                const sign_token = crypto_1.default.createHmac('sha256', this.config.geetestKey)
                    .update(lot_number, 'utf8')
                    .digest('hex');
                const query = new URLSearchParams({
                    captcha_id: this.config.geetestId,
                    lot_number,
                    captcha_output,
                    pass_token,
                    gen_time,
                    sign_token,
                }).toString();
                const verifyUrl = `http://gcaptcha4.geetest.com/validate?${query}`;
                const response = await fetch(verifyUrl, {
                    method: 'POST',
                    redirect: 'error'
                });
                const result = await response.json();
                if (result.result === 'success') {
                    this.logger.info(`[WebDashboard] IP ${ip} 的 Geetest 验证成功`);
                    return { success: true };
                }
                else {
                    this.logger.warn(`[WebDashboard] IP ${ip} 的 Geetest 验证失败: ${result.reason}`);
                    return { success: false, message: result.reason || 'Geetest verification failed.' };
                }
            }
            catch (error) {
                this.logger.error(`[WebDashboard] Geetest 验证错误: ${String(error)}`);
                return { success: true };
            }
        }
        return { success: true };
    }
    setupMiddleware() {
        this.app.use(express_1.default.urlencoded({ extended: true }));
        this.app.use(express_1.default.json());
        this.app.use((0, cookie_parser_1.default)());
        if (this.config.sessionSecret === 'a-very-insecure-secret-change-it') {
            this.logger.warn('[WebDashboard] 安全警告：正在使用默认的 Session Secret。请在 config/web-dashboard/config.yaml 中设置 sessionSecret。');
        }
        this.app.use(this.sessionParser);
        this.app.use((_req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-admin-token');
            next();
        });
    }
    // AES-256-CBC 解密函数（兼容 nonebot 插件）
    decryptAesCbcToken(encryptedHex, secret) {
        try {
            const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
            if (encryptedBuffer.length < 17)
                return null;
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
    // 验证 AES-256-CBC token
    verifyAesCbcToken(token, secret) {
        const decrypted = this.decryptAesCbcToken(token, secret);
        if (!decrypted)
            return false;
        const dateStr = new Date().toISOString().substring(0, 10);
        const expectedPlain = `${dateStr}_${secret}_xy521`;
        return decrypted === expectedPlain;
    }
    verifyUserRole(minRole) {
        return (req, res, next) => {
            let token = undefined;
            let isNoneBotAuth = false;
            // 检查 X-Admin-Secret 头（nonebot 插件使用）
            const adminSecretHeader = req.headers['x-admin-secret'];
            if (adminSecretHeader) {
                // 使用环境变量或默认配置中的 adminSecret
                const adminSecret = process.env.ADMIN_SECRET;
                if (adminSecret && this.verifyAesCbcToken(adminSecretHeader, adminSecret)) {
                    isNoneBotAuth = true;
                    // AES-CBC 认证成功，检查是否是管理员
                    // nonebot 插件的用户已经是 SUPERUSER，所以直接放行
                    this.logger.info(`[WebDashboard] NoneBot AES-CBC 认证成功，IP: ${this.getRealIp(req)}`);
                    next();
                    return;
                }
            }
            // 原有的 token 认证逻辑
            if (req.cookies && req.cookies['access_token']) {
                token = req.cookies['access_token'];
            }
            if (!token) {
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }
            }
            if (!token) {
                res.status(401).json({ error: 'Unauthorized: Missing token' });
                return;
            }
            const session = this.userSessions.get(token);
            if (!session || Date.now() > session.expiresAt) {
                if (session)
                    this.userSessions.delete(token);
                res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
                return;
            }
            if (minRole === 'Owner' && !session.isOwner) {
                this.logger.warn(`[WebDashboard] Owner access denied for user ${session.userId} (${session.username})`);
                res.status(403).json({ error: 'Forbidden: Owner access required' });
                return;
            }
            if (minRole === 'Admin' && !session.isAdmin && !session.isOwner) {
                this.logger.warn(`[WebDashboard] Admin access denied for user ${session.userId} (${session.username})`);
                res.status(403).json({ error: 'Forbidden: Admin access required' });
                return;
            }
            next();
        };
    }
    setupRoutes() {
        // Global IP Ban Check
        this.app.use((req, res, next) => {
            const ip = this.getRealIp(req);
            const banInfo = this.banManager.isIpBanned(ip);
            if (banInfo) {
                this.logger.warn(`[WebDashboard] 拦截到封禁 IP ${ip} 的 Web 访问。原因: ${banInfo.reason}`);
                res.status(403).send(`您的 IP 已被封禁。原因: ${banInfo.reason}`);
                return;
            }
            next();
        });
        const publicPath = path_1.default.join(__dirname, 'public');
        // Custom HTML routes WITH config injection (MUST be before express.static)
        this.app.get(['/admin', '/admin.html'], (_req, res) => {
            return res.redirect('/login');
        });
        this.app.get(['/', '/index.html'], (_req, res) => {
            this.serveHtmlWithConfig(res, path_1.default.join(publicPath, 'index.html'));
        });
        this.app.get(['/room', '/room.html'], (_req, res) => {
            this.serveHtmlWithConfig(res, path_1.default.join(publicPath, 'room.html'));
        });
        this.app.get(['/players', '/players.html'], (req, res) => {
            // 检查用户是否有管理员权限
            let token = undefined;
            if (req.cookies && req.cookies['access_token']) {
                token = req.cookies['access_token'];
            }
            if (!token) {
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }
            }
            if (!token) {
                return res.redirect('/');
            }
            const session = this.userSessions.get(token);
            if (!session || Date.now() > session.expiresAt) {
                return res.redirect('/');
            }
            if (!session.isAdmin && !session.isOwner) {
                return res.redirect('/');
            }
            // 管理员可以访问 players 页面
            this.serveHtmlWithConfig(res, path_1.default.join(publicPath, 'players.html'));
        });
        this.app.get(['/manage', '/manage.html'], (_req, res) => {
            this.serveHtmlWithConfig(res, path_1.default.join(publicPath, 'manage.html'));
        });
        this.app.get(['/login', '/login.html'], (_req, res) => {
            this.serveHtmlWithConfig(res, path_1.default.join(publicPath, 'login.html'));
        });
        this.app.get(['/info', '/info.html'], (_req, res) => {
            this.serveHtmlWithConfig(res, path_1.default.join(publicPath, 'info.html'));
        });
        this.app.get('/icon.png', (_req, res) => {
            if (fs_1.default.existsSync(this.runtimeIconFile)) {
                return res.sendFile(this.runtimeIconFile);
            }
            return res.sendFile(this.bundledDefaultIconFile);
        });
        this.app.use(express_1.default.static(publicPath));
        this.logger.info(`[WebDashboard] 正在从 ${publicPath} 提供静态文件`);
        // Rest of the routes from original HttpServer...
        this.app.get('/logout', (req, res) => {
            res.clearCookie('access_token');
            let token = undefined;
            if (req.cookies && req.cookies['access_token']) {
                token = req.cookies['access_token'];
            }
            if (token) {
                this.userSessions.delete(token);
            }
            return req.session.destroy((err) => {
                if (err) {
                    this.logger.error(`[WebDashboard] 销毁 Session 失败: ${err}`);
                }
                return res.redirect('/');
            });
        });
        this.app.get('/check-auth', (req, res) => {
            let token = undefined;
            if (req.cookies && req.cookies['access_token']) {
                token = req.cookies['access_token'];
            }
            if (!token) {
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }
            }
            if (!token)
                return res.json({ isAdmin: false, isOwner: false, userId: null });
            const session = this.userSessions.get(token);
            if (!session || Date.now() > session.expiresAt) {
                return res.json({ isAdmin: false, isOwner: false, userId: null });
            }
            return res.json({ isAdmin: session.isAdmin, isOwner: session.isOwner, userId: session.userId });
        });
        this.app.get('/check-session', (req, res) => {
            let token = undefined;
            if (req.cookies && req.cookies['access_token']) {
                token = req.cookies['access_token'];
            }
            if (!token) {
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }
            }
            if (!token) {
                return res.json({ valid: false });
            }
            const session = this.userSessions.get(token);
            if (!session) {
                return res.json({ valid: false });
            }
            if (Date.now() > session.expiresAt) {
                this.userSessions.delete(token);
                return res.json({ valid: false });
            }
            return res.json({
                valid: true,
                userId: session.userId,
                username: session.username,
                isAdmin: session.isAdmin,
                isOwner: session.isOwner,
                expiresAt: session.expiresAt,
            });
        });
        // Public config endpoint
        this.app.get('/api/public-config', (_req, res) => {
            res.json({
                captchaProvider: this.config.captchaProvider,
                serverName: this.config.serverName,
                displayIp: this.config.displayIp
            });
        });
        // User login API
        this.app.post('/api/user-login', async (req, res) => {
            const { email, password } = req.body;
            if (!email || !password)
                return res.status(400).json({ success: false, error: 'Missing email or password' });
            try {
                const response = await fetch('https://phira.5wyxi.com/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await response.json();
                if (response.ok && data.token) {
                    res.cookie('access_token', data.token, {
                        httpOnly: false,
                        maxAge: 30 * 24 * 60 * 60 * 1000,
                        sameSite: 'lax'
                    });
                    try {
                        const userResponse = await fetch('https://phira.5wyxi.com/me', {
                            headers: { 'Authorization': `Bearer ${data.token}` }
                        });
                        if (userResponse.ok) {
                            const userData = await userResponse.json();
                            const userId = Number(userData.id);
                            const isAdmin = this.config.adminPhiraId.includes(userId);
                            const isOwner = this.config.ownerPhiraId.includes(userId);
                            this.userSessions.set(data.token, {
                                userId,
                                username: userData.name,
                                expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
                                isAdmin,
                                isOwner
                            });
                            return res.json({ success: true, user: { ...userData, isAdmin, isOwner } });
                        }
                    }
                    catch (e) {
                        this.logger.warn(`[WebDashboard] Failed to fetch user info after login: ${e}`);
                    }
                    const userId = Number(data.id);
                    const isAdmin = this.config.adminPhiraId.includes(userId);
                    const isOwner = this.config.ownerPhiraId.includes(userId);
                    this.userSessions.set(data.token, {
                        userId,
                        username: data.name,
                        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
                        isAdmin,
                        isOwner
                    });
                    return res.json({ success: true, user: { id: data.id, ...data, isAdmin, isOwner } });
                }
                else {
                    return res.status(401).json({ success: false, error: data.error || 'Invalid credentials' });
                }
            }
            catch (e) {
                this.logger.error(`[WebDashboard] Phira login proxy error: ${e}`);
                return res.status(500).json({ success: false, error: 'Internal server error' });
            }
        });
        // Admin APIs
        this.app.get('/api/all-players', this.verifyUserRole('Admin').bind(this), this.rateLimitMiddleware.bind(this), (_req, res) => {
            const allPlayers = this.protocolHandler.getAllSessions().map(p => ({
                ...p,
                isAdmin: this.config.adminPhiraId.includes(p.id),
                isOwner: this.config.ownerPhiraId.includes(p.id),
                ip: p.ip,
            }));
            return res.json(allPlayers);
        });
        this.app.post('/api/admin/server-message', this.verifyUserRole('Admin').bind(this), (req, res) => {
            const { roomId, content } = req.body;
            if (!roomId || !content) {
                return res.status(400).json({ error: 'Missing roomId or content' });
            }
            this.protocolHandler.sendServerMessage(roomId, "【系统】" + content);
            return res.json({ success: true });
        });
        this.app.post('/api/admin/broadcast', this.verifyUserRole('Admin').bind(this), (req, res) => {
            const { content, target } = req.body;
            if (!content) {
                return res.status(400).json({ error: 'Missing content' });
            }
            const targetIds = (target && target.startsWith('#'))
                ? target.substring(1).split(',').map((id) => id.trim())
                : null;
            const rooms = this.roomManager.listRooms();
            let sentCount = 0;
            rooms.forEach(room => {
                if (!targetIds || targetIds.includes(room.id)) {
                    this.protocolHandler.sendServerMessage(room.id, "【全服播报】" + content);
                    sentCount++;
                }
            });
            return res.json({ success: true, roomCount: sentCount });
        });
        this.app.post('/api/admin/kick-player', this.verifyUserRole('Admin').bind(this), (req, res) => {
            const { userId } = req.body;
            if (!userId) {
                return res.status(400).json({ error: 'Missing userId' });
            }
            const success = this.protocolHandler.kickPlayer(Number(userId));
            return res.json({ success });
        });
        // Ban Management APIs
        this.app.get('/api/admin/bans', this.verifyUserRole('Admin').bind(this), (_req, res) => {
            return res.json(this.banManager.getAllBans());
        });
        this.app.post('/api/admin/ban', this.verifyUserRole('Admin').bind(this), (req, res) => {
            const { type, target, duration, reason } = req.body;
            if (!type || !target) {
                return res.status(400).json({ error: 'Missing type or target' });
            }
            const session = this.userSessions.get(req.cookies['access_token'] || req.header('Authorization')?.substring(7));
            const adminName = session ? `${session.username} (${session.userId})` : 'Unknown Admin';
            const finalReason = reason && String(reason).trim() !== '' ? String(reason) : 'No reason provided';
            if (type === 'id') {
                const userId = Number(target);
                this.banManager.banId(userId, duration ? Number(duration) : null, finalReason, adminName);
                this.protocolHandler.kickPlayer(userId);
            }
            else if (type === 'ip') {
                const ip = String(target);
                this.banManager.banIp(ip, duration ? Number(duration) : null, finalReason, adminName);
                this.protocolHandler.kickIp(ip);
            }
            else {
                return res.status(400).json({ error: 'Invalid ban type' });
            }
            return res.json({ success: true });
        });
        this.app.post('/api/admin/unban', this.verifyUserRole('Admin').bind(this), (req, res) => {
            const { type, target } = req.body;
            if (!type || !target) {
                return res.status(400).json({ error: 'Missing type or target' });
            }
            const session = this.userSessions.get(req.cookies['access_token'] || req.header('Authorization')?.substring(7));
            const adminName = session ? `${session.username} (${session.userId})` : 'Unknown Admin';
            let success = false;
            if (type === 'id') {
                success = this.banManager.unbanId(Number(target), adminName);
            }
            else if (type === 'ip') {
                success = this.banManager.unbanIp(String(target), adminName);
            }
            return res.json({ success });
        });
        // Login Blacklist APIs
        this.app.get('/api/admin/login-blacklist', this.verifyUserRole('Admin').bind(this), (_req, res) => {
            const list = Array.from(this.blacklistedIps.entries()).map(([ip, expiresAt]) => ({
                ip,
                expiresAt
            }));
            return res.json({ blacklistedIps: list });
        });
        this.app.post('/api/admin/blacklist-ip', this.verifyUserRole('Admin').bind(this), (req, res) => {
            const { ip, duration } = req.body;
            if (!ip) {
                return res.status(400).json({ error: 'Missing ip' });
            }
            const session = this.userSessions.get(req.cookies['access_token'] || req.header('Authorization')?.substring(7));
            const adminName = session ? `${session.username} (${session.userId})` : 'Unknown Admin';
            const finalDuration = duration ? Number(duration) : (this.config.loginBlacklistDuration ?? 600);
            const expiresAt = Date.now() + finalDuration * 1000;
            this.blacklistedIps.set(String(ip), expiresAt);
            this.saveBlacklist();
            const durationStr = finalDuration >= 3600 ? `${(finalDuration / 3600).toFixed(1)}小时` : `${Math.floor(finalDuration / 60)}分钟`;
            this.logger.ban(`[WebDashboard] IP ${ip} 被管理员 ${adminName} 手动加入登录黑名单。时长: ${durationStr}`);
            return res.json({ success: true });
        });
        this.app.post('/api/admin/unblacklist-ip', this.verifyUserRole('Admin').bind(this), (req, res) => {
            const { ip } = req.body;
            if (!ip) {
                return res.status(400).json({ error: 'Missing ip' });
            }
            const session = this.userSessions.get(req.cookies['access_token'] || req.header('Authorization')?.substring(7));
            const adminName = session ? `${session.username} (${session.userId})` : 'Unknown Admin';
            const success = this.blacklistedIps.delete(String(ip));
            if (success) {
                this.saveBlacklist();
                this.logger.ban(`[WebDashboard] IP ${ip} 被管理员 ${adminName} 从登录黑名单中移除。`);
            }
            return res.json({ success });
        });
        // Owner Exclusive APIs
        this.app.get('/api/owner/system-info', this.verifyUserRole('Owner').bind(this), (_req, res) => {
            const used = process.memoryUsage();
            return res.json({
                uptime: process.uptime(),
                memory: {
                    rss: Math.round(used.rss / 1024 / 1024 * 100) / 100,
                    heapTotal: Math.round(used.heapTotal / 1024 / 1024 * 100) / 100,
                    heapUsed: Math.round(used.heapUsed / 1024 / 1024 * 100) / 100,
                },
                platform: process.platform,
                nodeVersion: process.version,
                pid: process.pid
            });
        });
        this.app.get('/api/version', (_req, res) => {
            return res.json({ version });
        });
        // === Public Status API ===
        this.app.get('/api/status', this.rateLimitMiddleware.bind(this), (req, res) => {
            let token = undefined;
            if (req.cookies && req.cookies['access_token']) {
                token = req.cookies['access_token'];
            }
            if (!token) {
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    token = authHeader.substring(7);
                }
            }
            const session = token ? this.userSessions.get(token) : undefined;
            const isAdmin = session?.isAdmin || session?.isOwner || false;
            if (!isAdmin && Date.now() - this.statusCacheTime < 1000 && this.cachedStatus) {
                return res.json(this.cachedStatus);
            }
            const rooms = this.roomManager.listRooms()
                .filter(room => {
                if (isAdmin)
                    return true;
                if (this.config.enablePubWeb) {
                    return room.id.startsWith(this.config.pubPrefix);
                }
                if (this.config.enablePriWeb) {
                    return !room.id.startsWith(this.config.priPrefix);
                }
                return true;
            })
                .map(room => {
                const players = Array.from(room.players.values()).map(p => ({
                    id: p.user.id,
                    name: p.user.name,
                }));
                return {
                    id: room.id,
                    name: room.name,
                    playerCount: room.players.size,
                    maxPlayers: room.maxPlayers,
                    state: {
                        ...room.state,
                        chartId: room.state.chartId ?? room.selectedChart?.id ?? null,
                        chartName: room.selectedChart?.name ?? null,
                    },
                    locked: room.locked,
                    cycle: room.cycle,
                    players: players,
                };
            });
            const response = {
                serverName: this.config.serverName,
                onlinePlayers: this.protocolHandler.getSessionCount(),
                roomCount: rooms.length,
                rooms: rooms,
                federation: this.federationManager ? {
                    enabled: true,
                    nodeId: this.federationManager.getNodeId(),
                    remoteRooms: this.federationManager.getRemoteRooms().map((r) => ({
                        id: r.id,
                        name: r.name,
                        nodeId: r.nodeId,
                        nodeName: r.nodeName,
                        playerCount: r.playerCount,
                        maxPlayers: r.maxPlayers,
                        state: r.state,
                        locked: r.locked,
                        cycle: r.cycle,
                        players: r.players,
                    })),
                    nodes: this.federationManager.getOnlineNodes().map((n) => ({
                        id: n.id,
                        serverName: n.serverName,
                        status: n.status,
                    })),
                } : { enabled: false },
            };
            if (!isAdmin) {
                this.cachedStatus = response;
                this.statusCacheTime = Date.now();
            }
            return res.json(response);
        });
    }
    serveHtmlWithConfig(res, htmlPath) {
        try {
            if (!fs_1.default.existsSync(htmlPath)) {
                res.status(404).send('Page not found');
                return;
            }
            let html = fs_1.default.readFileSync(htmlPath, 'utf8');
            const serverConfig = JSON.stringify({
                serverName: this.config.serverName,
                displayIp: this.config.displayIp,
                captchaProvider: this.config.captchaProvider,
                geetestId: this.config.geetestId || '',
            });
            html = html.replace('</head>', `
    <script>
      window.SERVER_CONFIG = ${serverConfig};
    </script>
  </head>`);
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        }
        catch (e) {
            this.logger.error(`[WebDashboard] 提供 HTML 失败 ${htmlPath}: ${e}`);
            res.status(500).send('Internal server error');
        }
    }
    setupFederationRoutes() {
        if (!this.federationManager) {
            this.logger.debug('[WebDashboard] 联邦管理器未提供，跳过联邦路由注册');
            return;
        }
        const fm = this.federationManager;
        const authFederation = (req, res, next) => {
            const secret = req.header('X-Federation-Secret');
            const expectedSecret = fm.getConfig().secret;
            if (!secret || !expectedSecret || secret !== expectedSecret) {
                res.status(403).json({ error: 'Invalid federation secret' });
                return;
            }
            next();
        };
        // Federation APIs
        this.app.post('/api/federation/handshake', authFederation, (req, res) => {
            const { nodeId, nodeUrl, serverName, instanceId, isReverse } = req.body;
            if (!nodeId || !nodeUrl) {
                return res.status(400).json({ error: 'Missing nodeId or nodeUrl' });
            }
            this.logger.info(`[WebDashboard] [联邦HTTP] 收到握手请求: 来自 ${serverName} (ID: ${nodeId}, 实例: ${instanceId}, URL: ${nodeUrl}, 反向: ${!!isReverse})`);
            const result = fm.handleIncomingHandshake({
                nodeId,
                nodeUrl,
                serverName: serverName || 'Unknown',
                instanceId,
                isReverse: !!isReverse
            });
            this.logger.info(`[WebDashboard] [联邦HTTP] 握手响应已发送给 ${serverName}`);
            return res.json(result);
        });
        this.app.get('/api/federation/health', authFederation, (_req, res) => {
            return res.json({
                nodeId: fm.getNodeId(),
                instanceId: fm.getInstanceId(),
                serverName: fm.getConfig().serverName,
                status: 'online',
                timestamp: Date.now(),
                peers: fm.getNodes().filter(n => n.status === 'online').map(n => ({
                    id: n.id,
                    url: n.url,
                    instanceId: n.instanceId,
                    serverName: n.serverName,
                })),
            });
        });
        this.app.get('/api/federation/peers', authFederation, (_req, res) => {
            return res.json({
                peers: fm.getNodes().map(n => ({
                    id: n.id,
                    url: n.url,
                    serverName: n.serverName,
                    status: n.status,
                    lastSeen: n.lastSeen,
                })),
            });
        });
        this.app.get('/api/federation/rooms', authFederation, (_req, res) => {
            const rooms = fm.getLocalRoomsForFederation();
            if (rooms.length !== this.lastFederationRoomCount) {
                this.logger.info(`[WebDashboard] [联邦HTTP] 房间查询: 本地房间数 ${this.lastFederationRoomCount === -1 ? '初始化' : this.lastFederationRoomCount} → ${rooms.length}`);
                this.lastFederationRoomCount = rooms.length;
            }
            return res.json({ rooms });
        });
    }
    async start() {
        this.logger.mark(`[WebDashboard] 路由与静态资源已挂载到插件宿主`);
    }
    async stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.logger.info('[WebDashboard] Web Dashboard 插件已停止');
    }
}
let instance;
const pluginModule = {
    name: 'web-dashboard',
    async init(api) {
        const { config, logger, roomManager, protocolHandler, banManager, federationManager } = api;
        const pluginConfig = api.readPluginConfig() ?? {};
        instance = new WebDashboardPlugin({
            ...config,
            displayIp: pluginConfig.displayIp ?? config.displayIp,
            sessionSecret: pluginConfig.sessionSecret ?? config.sessionSecret,
            loginBlacklistDuration: pluginConfig.loginBlacklistDuration ?? config.loginBlacklistDuration,
            captchaProvider: pluginConfig.captchaProvider ?? config.captchaProvider,
            geetestId: pluginConfig.geetestId ?? config.geetestId,
            geetestKey: pluginConfig.geetestKey ?? config.geetestKey,
            allowedOrigins: pluginConfig.allowedOrigins ?? config.allowedOrigins,
            enablePubWeb: pluginConfig.enablePubWeb ?? config.enablePubWeb,
            pubPrefix: pluginConfig.pubPrefix ?? config.pubPrefix,
            enablePriWeb: pluginConfig.enablePriWeb ?? config.enablePriWeb,
            priPrefix: pluginConfig.priPrefix ?? config.priPrefix,
        }, logger, roomManager, protocolHandler, banManager, api, federationManager);
        try {
            await instance.start();
            logger.info('[WebDashboard] Web Dashboard 插件启动成功');
        }
        catch (error) {
            logger.error(`[WebDashboard] 启动失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    },
    async destroy() {
        await instance?.stop();
        instance = undefined;
    }
};
exports.default = pluginModule;

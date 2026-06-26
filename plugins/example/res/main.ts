/**
 * 示例插件 — 展示插件系统核心 API 的用法
 *
 * 目录结构:
 *   plugins/example/index.ts   ← 插件入口（必须导出 PluginModule）
 *   config/example/config.yaml ← 插件专属配置（可选，由 readPluginConfig 读取）
 */

import type { PluginModule, PluginApi } from 'phira-plugin-api';

// 插件自身的配置类型（对应 config/example/config.yaml）
interface ExamplePluginConfig {
  greeting?: string;
}

// 用于在 destroy 时取消事件监听
const unsubscribers: Array<() => void> = [];

const pluginModule: PluginModule = {
  // name 可选，缺省时使用目录名
  name: 'example',

  /**
   * 插件初始化入口
   * PluginManager 会在服务器启动后按目录名字母序依次调用
   */
  async init(api: PluginApi) {
    // ========== 1. 读取插件配置 ==========
    const cfg = api.readPluginConfig<ExamplePluginConfig>() ?? {};
    const greeting = cfg.greeting ?? '你好';
    api.logger.info(`[示例插件] 已加载，问候语: "${greeting}"`);

    // ========== 2. 监听事件 ==========
    unsubscribers.push(
      api.events.on('player:auth:success', ({ user }) => {
        api.logger.info(`[示例插件] ${greeting}, ${user.name}!`);
      }),
    );

    unsubscribers.push(
      api.events.on('room:create', ({ room, user }) => {
        api.logger.info(`[示例插件] ${user.name} 创建了房间 ${room.name}`);
      }),
    );

    unsubscribers.push(
      api.events.on('chat:message', ({ room, userId, content }) => {
        api.logger.debug(`[示例插件] 房间 ${room.name} 中用户 ${userId} 说: ${content}`);
      }),
    );

    // ========== 3. 注册 HTTP 路由 ==========
    // 需要 ENABLE_WEB_SERVER=true 才会生效
    api.registerRoute('get', '/api/example/hello', (_req, res) => {
      res.json({
        message: greeting,
        onlinePlayers: api.protocolHandler.getSessionCount(),
        roomCount: api.roomManager.listRooms().length,
      });
    });

    // ========== 4. 注册控制台命令 ==========
    // 在服务器控制台输入 /hello [名字] 即可触发
    api.registerCommand('hello', (name?: string) => {
      api.logger.info(`[示例插件] ${greeting}, ${name ?? '世界'}!`);
    });

    // ========== 5. 写入配置示例（首次运行时生成默认配置）==========
    if (!cfg.greeting) {
      api.writePluginConfig({ greeting } satisfies ExamplePluginConfig);
      api.logger.info(`[示例插件] 已生成默认配置到 ${api.getPluginConfigDir()}/config.yaml`);
    }
  },

  /**
   * 插件销毁 — 服务器关闭或插件被卸载时调用
   * 应在此释放所有资源（取消监听、清除定时器等）
   */
  destroy() {
    unsubscribers.forEach(unsub => unsub());
    unsubscribers.length = 0;
  },
};

export default pluginModule;

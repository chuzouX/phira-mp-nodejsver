#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function generateUUID() {
  return crypto.randomUUID();
}

async function createPlugin() {
  console.log('\n🎨 Phira MP Server - 插件创建工具\n');
  console.log('此工具将帮助你创建一个新的插件模板\n');

  // 收集插件信息
  const id = await question('插件 ID (英文，kebab-case): ');
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    console.error('❌ 插件 ID 无效！必须是小写字母、数字和连字符的组合');
    rl.close();
    process.exit(1);
  }

  const pluginDir = path.join(process.cwd(), 'plugins', id);
  if (fs.existsSync(pluginDir)) {
    console.error(`❌ 插件目录已存在: ${pluginDir}`);
    rl.close();
    process.exit(1);
  }

  const name = await question('插件名称 (中文或英文): ') || id;
  const description = await question('插件描述: ') || '一个新的插件';
  const author = await question('作者: ') || 'Phira NodejsVer MP Server Team - chuzouX';

  // 选择语言
  const languageChoice = await question('选择开发语言 (1=TypeScript, 2=JavaScript) [默认: 1]: ') || '1';
  const useTypeScript = languageChoice === '1' || languageChoice.toLowerCase() === 'typescript' || languageChoice.toLowerCase() === 'ts';

  const hasDependencies = await question('是否依赖其他插件？ (y/n): ');

  let dependencies = [];
  if (hasDependencies.toLowerCase() === 'y') {
    console.log('\n可用的插件 UUID:');
    console.log('  - websocket: c8d4e5f6-9a2b-4c7d-8e1f-3a9b6c5d7e2a (WebSocket Support)');
    console.log('  - web-dashboard: b9e2f5a8-7c3d-4f1e-9a6b-2d8c4e5f7a1b (Web Dashboard)');
    console.log('  - nonebot-auth: d5a7b8c9-3e4f-4d1a-9b2c-6e8f7a9d5b3c (NoneBot Auth)');
    console.log('\n格式: uuid: <uuid>');
    console.log('      name: <插件名称>\n');
    const depsInput = await question('依赖的插件 UUID (多个用逗号分隔，或输入完整格式): ');
    if (depsInput) {
      dependencies = depsInput.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  const uuid = generateUUID();

  console.log(`\n✅ 插件 UUID 已生成: ${uuid}`);
  console.log(`✅ 开发语言: ${useTypeScript ? 'TypeScript' : 'JavaScript'}`);
  console.log('\n正在创建插件文件...\n');

  // 创建目录结构
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'res'), { recursive: true });

  // 创建 plugin.yaml
  const pluginYaml = `# ${name} Plugin Metadata
id: ${id}
uuid: ${uuid}
name: ${name}
version: 1.0.0
description: ${description}
author: ${author}
license: MIT
main: main.js
dependencies: ${dependencies.length > 0 ? '\n  - ' + dependencies.join('\n  - ') : '[]'}
serverVersion: ">=0.4.0"
tags:
  - custom
`;

  fs.writeFileSync(path.join(pluginDir, 'plugin.yaml'), pluginYaml);

  // 根据选择创建不同的主文件
  if (useTypeScript) {
    // 创建 main.ts (TypeScript)
    const mainTs = `import type { PluginApi, PluginModule } from 'phira-plugin-api';

/**
 * ${name}
 *
 * ${description}
 */
const pluginModule: PluginModule = {
  name: '${id}',

  async init(api: PluginApi) {
    api.logger.info('[${name}] 插件已加载');

    // TODO: 在这里添加你的插件逻辑

    // 示例：注册一个控制台命令
    // api.registerCommand('mycommand', (arg1, arg2) => {
    //   api.logger.info(\`执行命令: \${arg1}, \${arg2}\`);
    // });

    // 示例：注册一个 HTTP 路由
    // api.registerRoute('get', '/api/${id}/test', (req, res) => {
    //   res.json({ success: true, message: 'Hello from ${name}!' });
    // });

    // 示例：监听服务器事件
    // api.events.on('player:auth:success', ({ user }) => {
    //   api.logger.info(\`玩家登录: \${user.name}\`);
    // });

    // 示例：读取插件配置
    // const config = api.readPluginConfig<{ myOption: string }>();
    // if (config?.myOption) {
    //   api.logger.info(\`配置项: \${config.myOption}\`);
    // }
  },

  async destroy() {
    // 清理资源
    console.log('[${name}] 插件已卸载');
  }
};

export default pluginModule;
`;
    fs.writeFileSync(path.join(pluginDir, 'res', 'main.ts'), mainTs);
  } else {
    // 创建 main.js (JavaScript)
    const mainJs = `/**
 * ${name}
 *
 * ${description}
 */

const pluginModule = {
  name: '${id}',

  async init(api) {
    api.logger.info('[${name}] 插件已加载');

    // TODO: 在这里添加你的插件逻辑

    // 示例：注册一个控制台命令
    // api.registerCommand('mycommand', (arg1, arg2) => {
    //   api.logger.info(\`执行命令: \${arg1}, \${arg2}\`);
    // });

    // 示例：注册一个 HTTP 路由
    // api.registerRoute('get', '/api/${id}/test', (req, res) => {
    //   res.json({ success: true, message: 'Hello from ${name}!' });
    // });

    // 示例：监听服务器事件
    // api.events.on('player:auth:success', ({ user }) => {
    //   api.logger.info(\`玩家登录: \${user.name}\`);
    // });

    // 示例：读取插件配置
    // const config = api.readPluginConfig();
    // if (config?.myOption) {
    //   api.logger.info(\`配置项: \${config.myOption}\`);
    // }
  },

  async destroy() {
    // 清理资源
    console.log('[${name}] 插件已卸载');
  }
};

module.exports = pluginModule;
`;
    fs.writeFileSync(path.join(pluginDir, 'res', 'main.js'), mainJs);
  }

  // 创建 README.md
  const readme = `# ${name}

${description}

## 插件信息

- **ID**: ${id}
- **UUID**: ${uuid}
- **版本**: 1.0.0
- **作者**: ${author}
- **开发语言**: ${useTypeScript ? 'TypeScript' : 'JavaScript'}

## 依赖

${dependencies.length > 0 ? dependencies.map(dep => `- \`${dep}\``).join('\n') : '无依赖'}

## 功能

TODO: 描述你的插件功能

## 配置

插件配置文件位于 \`config/${id}/config.yaml\`

\`\`\`yaml
# 示例配置
# myOption: "value"
\`\`\`

## 使用方法

TODO: 添加使用说明

## 开发

${useTypeScript ? `\`\`\`bash
# 编译插件
npm run build:plugins

# 或者只编译单个插件
npx tsc plugins/${id}/res/main.ts --outDir plugins/${id}/res
\`\`\`` : `\`\`\`bash
# JavaScript 插件无需编译，直接修改 main.js 即可

# 重载插件
在服务器控制台输入: /plugins reload ${id}
\`\`\``}
`;

  fs.writeFileSync(path.join(pluginDir, 'README.md'), readme);

  // 创建配置目录
  const configDir = path.join(process.cwd(), 'config', id);
  fs.mkdirSync(configDir, { recursive: true });

  const configYaml = `# ${name} 插件配置

# 示例配置项
# myOption: "value"
`;

  fs.writeFileSync(path.join(configDir, 'config.yaml'), configYaml);

  console.log('✅ 插件创建完成！\n');
  console.log('📁 插件目录:', pluginDir);
  console.log('📝 配置目录:', configDir);
  console.log(`📄 主文件: plugins/${id}/res/main.${useTypeScript ? 'ts' : 'js'}`);
  console.log('\n📋 下一步:');
  console.log(`  1. 编辑 plugins/${id}/res/main.${useTypeScript ? 'ts' : 'js'} 实现你的插件逻辑`);
  if (useTypeScript) {
    console.log('  2. 运行 npm run build:plugins 编译插件');
    console.log('  3. 重启服务器以加载新插件');
  } else {
    console.log('  2. 重启服务器或运行 /plugins reload 以加载新插件');
  }
  console.log('');

  rl.close();
}

createPlugin().catch(err => {
  console.error('❌ 创建插件失败:', err);
  rl.close();
  process.exit(1);
});

# 部署指南

## 环境变量配置

生产环境需要设置以下环境变量：

### 可选变量
- `PORT` - 服务器端口（默认：12346）
- `HOST` - 监听地址（默认：0.0.0.0）
- `TCP_ENABLED` - 是否启用 TCP（默认：true）
- `LOG_LEVEL` - 日志级别（默认：info）
- `NODE_ENV` - 运行环境（production/development）
- `PHIRA_API_URL` - Phira API 地址（默认：https://phira.5wyxi.com）

## 环境变量加载策略

### 开发环境
- 自动从 `.env` 文件加载配置
- 显示 "✅ 开发环境：已从 .env 加载配置" 日志
- 如果 `.env` 文件不存在，会显示错误信息但继续运行

### 生产环境
- 仅使用系统环境变量
- 不加载 `.env` 文件
- 显示 "✅ 生产环境：使用系统环境变量" 日志
- 符合 12-factor app 原则

## Docker 部署

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package.json package-lock.json ./
RUN npm ci --only=production

# 复制编译后的代码
COPY dist ./dist

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=12346
ENV PHIRA_API_URL=https://phira.5wyxi.com

# 启动命令
CMD ["node", "dist/index.js"]
```

## PM2 部署

```json
{
  "apps": [{
    "name": "phira-mp",
    "script": "dist/index.js",
    "env_production": {
      "NODE_ENV": "production",
      "PORT": 12346,
      "HOST": "0.0.0.0",
      "TCP_ENABLED": "true",
      "LOG_LEVEL": "info",
      "PHIRA_API_URL": "https://phira.5wyxi.com"
    }
  }]
}
```

启动：
```bash
pm2 start ecosystem.config.json --env production
```

## systemd 部署

创建服务文件 `/etc/systemd/system/phira-mp.service`：

```ini
[Unit]
Description=Phira Multiplayer Server
After=network.target

[Service]
Type=simple
User=phira
WorkingDirectory=/opt/phira-mp
Environment=NODE_ENV=production
Environment=PORT=12346
Environment=HOST=0.0.0.0
Environment=TCP_ENABLED=true
Environment=LOG_LEVEL=info
Environment=PHIRA_API_URL=https://phira.5wyxi.com
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务：
```bash
sudo systemctl enable phira-mp
sudo systemctl start phira-mp
```

## 环境变量优化说明

### 移除 dotenv 广告
- 降级到 dotenv@16.0.3 版本，移除了广告信息
- 生产环境不加载 dotenv，完全避免广告输出

### 优化加载策略
- 开发环境：使用 .env 文件，便于本地开发
- 生产环境：使用系统环境变量，符合最佳实践
- 清晰的环境提示日志，便于调试

### 类型安全
- 使用 TypeScript 类型定义确保配置类型安全
- 提供默认值和类型转换函数
- 支持必需环境变量验证（可扩展）
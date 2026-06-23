# NoneBot Auth Plugin

基于密钥的管理员鉴权插件，适用于外部脚本或机器人访问。

## 功能特性

- ✅ **独立鉴权机制** - 不依赖 Session/Cookie，适合无浏览器环境
- ✅ **安全加密** - 使用 SHA-256/SHA-512 哈希加密
- ✅ **防重放攻击** - 时间戳验证（5分钟有效期）
- ✅ **灵活配置** - 支持 .env 和插件配置文件
- ✅ **易于集成** - 简单的 HTTP 头认证

## 依赖说明

本插件依赖 **web-dashboard** 插件：
- **web-dashboard** (UUID: `b9e2f5a8-7c3d-4f1e-9a6b-2d8c4e5f7a1b`)
  - 提供 HTTP 服务器和 Express App
  - 提供路由注册能力

插件加载顺序：
1. websocket (无依赖)
2. web-dashboard (依赖 websocket)
3. **nonebot-auth** (依赖 web-dashboard)

## 配置方法

### 1. 设置管理员密钥

在 `.env` 文件中添加：

```bash
ADMIN_SECRET=your-super-secret-admin-key-here
```

**或者**在 `config/nonebot-auth/config.yaml` 中设置：

```yaml
adminSecret: "your-super-secret-admin-key-here"
secretHashAlgorithm: sha256
enableLogging: true
```

### 2. 生成安全密钥

```bash
# Linux/Mac
openssl rand -hex 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Python
python3 scripts/generate_secret.py
```

## 使用方法

### Bash/curl 示例

```bash
#!/bin/bash

# 配置
ADMIN_SECRET="your-admin-secret"
BASE_URL="http://localhost:8080"

# 生成时间戳
TIMESTAMP=$(date +%s)

# 计算哈希：SHA256(ADMIN_SECRET + timestamp)
HASH=$(echo -n "${ADMIN_SECRET}${TIMESTAMP}" | sha256sum | cut -d' ' -f1)

# 发送请求
curl -H "X-Admin-Secret: ${HASH}" \
     -H "X-Admin-Timestamp: ${TIMESTAMP}" \
     "${BASE_URL}/api/nonebot/status"
```

### Python 示例

```python
import hashlib
import time
import requests

ADMIN_SECRET = "your-admin-secret"
BASE_URL = "http://localhost:8080"

def make_admin_request(endpoint):
    timestamp = str(int(time.time()))
    hash_input = ADMIN_SECRET + timestamp
    secret_hash = hashlib.sha256(hash_input.encode()).hexdigest()
    
    headers = {
        'X-Admin-Secret': secret_hash,
        'X-Admin-Timestamp': timestamp
    }
    
    response = requests.get(f"{BASE_URL}{endpoint}", headers=headers)
    return response.json()

# 使用示例
result = make_admin_request('/api/nonebot/status')
print(result)
```

### Node.js 示例

```javascript
const crypto = require('crypto');
const axios = require('axios');

const ADMIN_SECRET = 'your-admin-secret';
const BASE_URL = 'http://localhost:8080';

async function makeAdminRequest(endpoint) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hash = crypto
    .createHash('sha256')
    .update(ADMIN_SECRET + timestamp)
    .digest('hex');
  
  const response = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: {
      'X-Admin-Secret': hash,
      'X-Admin-Timestamp': timestamp
    }
  });
  
  return response.data;
}

// 使用示例
makeAdminRequest('/api/nonebot/status')
  .then(data => console.log(data))
  .catch(err => console.error(err));
```

## API 端点

本插件提供以下端点（需要 Admin Secret 鉴权）：

### GET /api/nonebot/test

测试 Admin Secret 鉴权是否正常工作。

**响应示例：**
```json
{
  "success": true,
  "message": "Admin Secret authentication successful",
  "timestamp": 1719187200
}
```

### GET /api/nonebot/status

获取服务器状态信息。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "serverName": "My Phira Server",
    "roomCount": 5,
    "playerCount": 12,
    "timestamp": 1719187200
  }
}
```

## 安全建议

1. ✅ **使用强密钥** - 至少 32 字节的随机字符串
2. ✅ **定期轮换** - 建议每 90 天更换一次密钥
3. ✅ **HTTPS 传输** - 生产环境必须使用 HTTPS
4. ✅ **IP 白名单** - 配合防火墙限制访问来源
5. ✅ **监控日志** - 定期检查鉴权失败记录

## 错误响应

### 401 Unauthorized - 缺少请求头

```json
{
  "error": "Unauthorized: Missing X-Admin-Secret or X-Admin-Timestamp header",
  "hint": "Use X-Admin-Secret: SHA256(ADMIN_SECRET + timestamp) and X-Admin-Timestamp: <unix_timestamp>"
}
```

### 401 Unauthorized - 时间戳过期

```json
{
  "error": "Unauthorized: Timestamp expired",
  "hint": "Request must be sent within 5 minutes"
}
```

### 401 Unauthorized - 密钥无效

```json
{
  "error": "Unauthorized: Invalid secret"
}
```

## 与 Web Dashboard 的区别

| 特性 | Web Dashboard | NoneBot Auth |
|------|---------------|-------------------|
| 鉴权方式 | Session/Cookie | HTTP Header |
| 适用场景 | 浏览器 Web UI | 脚本/Bot/API |
| 需要登录 | 是（Phira 账号） | 否（直接使用密钥） |
| 会话管理 | 有（超时自动登出） | 无（每次验证） |
| 依赖关系 | 依赖 websocket | 依赖 web-dashboard |

## 故障排除

### 插件未加载

**原因：** ADMIN_SECRET 未配置

**解决：** 在 .env 中添加 `ADMIN_SECRET=your-secret-here`

### 401 Unauthorized

**原因：** 哈希计算错误或时间戳不同步

**解决：**
1. 确认 ADMIN_SECRET 与服务器配置一致
2. 检查客户端和服务器时间是否同步
3. 确认哈希算法为 SHA-256
4. 确认格式为：`SHA256(SECRET + timestamp)`，无空格

### 时间戳过期

**原因：** 客户端与服务器时间差超过 5 分钟

**解决：** 同步系统时间（使用 NTP）

## 开发者信息

- **插件 ID**: nonebot-auth
- **UUID**: d5a7b8c9-3e4f-4d1a-9b2c-6e8f7a9d5b3c
- **版本**: 1.0.0
- **依赖**: web-dashboard (b9e2f5a8-7c3d-4f1e-9a6b-2d8c4e5f7a1b)

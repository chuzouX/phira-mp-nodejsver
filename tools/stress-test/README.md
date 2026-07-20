# Phira MP Stress Test

服务器压力测试工具包，支持 TCP 协议层面的多场景压测。

## 快速开始

```bash
cd tools/stress-test
npm install

# 连接压测：1000 并发，60 秒
npx ts-node src/index.ts --scenario connection --connections 1000 --duration 60

# 房间压测：500 客户端，每秒 20 次操作
npx ts-node src/index.ts --scenario room --connections 500 --rate 20

# 混合负载：模拟 200 个真实玩家，持续 2 分钟
npx ts-node src/index.ts --scenario mixed --connections 200 --duration 120

# 完整参数
npx ts-node src/index.ts \
  --host 127.0.0.1 \
  --port 12346 \
  --scenario mixed \
  --connections 200 \
  --duration 60 \
  --rate 10 \
  --ramp-up 5 \
  --token 0123456789abcdefghij
```

## 场景

| 场景 | 说明 |
|------|------|
| `connection` | 连接+鉴权压测 |
| `room` | 创建/加入/离开房间 |
| `chat` | 高频聊天消息 |
| `mixed` | 混合负载（模拟真实玩家） |

## 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--host` | 127.0.0.1 | 服务器地址 |
| `--port` | 12346 | TCP 端口 |
| `--scenario` | connection | 压测场景 |
| `--connections` | 100 | 并发连接数 |
| `--duration` | 30 | 持续时间(秒) |
| `--rate` | 10 | 每秒操作速率 |
| `--ramp-up` | 5 | 爬坡时间(秒) |
| `--token` | 随机（虚拟） | 鉴权 token（以 `stress_` 开头自动绕过 Phira API 认证） |

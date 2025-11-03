# Playing状态重连迁移修复

## 问题描述

在玩家游戏进行中（Playing状态）重连时存在严重问题：
- 同一用户建立新连接时，服务端会强制关闭旧连接
- 强制关闭Playing状态的旧连接会触发断线逻辑，将玩家从房间完全移除
- 导致正在游戏的玩家因网络抖动或超时重连时被错误踢出房间
- 引发房间状态异常和"死房间"问题

## 修复方案

### 1. 改进handleAuthenticate中的多连接处理
- 检测到多连接时，检查玩家是否在Playing状态的房间中
- 如果是Playing状态，执行优雅的连接迁移而非强制移除：
  - 只更新玩家的connectionId
  - 保留玩家的游戏状态（isFinished、score、accuracy等）
  - 不要从房间移除玩家
  - 关闭旧连接但不触发完整的断线逻辑

### 2. 在RoomManager中新增migrateConnection方法
- 只更新连接ID，保留所有游戏状态
- 添加详细的日志记录
- 处理边界情况（不存在的用户/房间）

### 3. 新增getPlayerByConnectionId辅助方法
- 支持通过连接ID查找玩家和房间信息
- 用于重连迁移逻辑中的状态检查

### 4. 增强日志和错误追踪
- 在handlePlayed中添加详细的Played消息处理日志
- 记录每个阶段的时间戳，便于定位超时问题
- 区分客户端主动Abort和超时导致的Abort
- 添加重连场景的专门日志标签（如 `[重连迁移]`）

## 实现细节

### ProtocolHandler改动
1. **handleAuthenticate方法改进**：
   ```typescript
   if (existingConnectionId && existingConnectionId !== connectionId) {
     const existingRoom = this.roomManager.getRoomByUserId(userInfo.id);
     const isPlaying = existingRoom?.state.type === 'Playing';
     
     if (isPlaying) {
       // Playing状态：执行优雅的连接迁移
       this.roomManager.migrateConnection(userInfo.id, existingConnectionId, connectionId);
       // 清理旧连接但不触发房间逻辑
     } else {
       // 其他状态：正常踢出旧连接
       this.handleDisconnection(existingConnectionId);
     }
   }
   ```

### RoomManager新增方法
1. **migrateConnection方法**：
   ```typescript
   migrateConnection(userId: number, oldConnectionId: string, newConnectionId: string): void {
     const room = this.getRoomByUserId(userId);
     const player = room?.players.get(userId);
     
     if (player) {
       // 保存当前游戏状态
       const preservedState = {
         isFinished: player.isFinished,
         score: player.score,
         isReady: player.isReady,
       };
       
       // 更新连接ID，保留所有游戏状态
       player.connectionId = newConnectionId;
       player.isConnected = true;
       player.disconnectTime = undefined;
     }
   }
   ```

2. **getPlayerByConnectionId方法**：
   ```typescript
   getPlayerByConnectionId(connectionId: string): { player: PlayerInfo; room: Room } | null {
     for (const room of this.rooms.values()) {
       for (const player of room.players.values()) {
         if (player.connectionId === connectionId) {
           return { player, room };
         }
       }
     }
     return null;
   }
   ```

## 验证标准

修复后满足：
1. ✅ 玩家在Playing状态重连不会被踢出房间
2. ✅ 玩家的游戏进度（isFinished、score）在重连后保留
3. ✅ 游戏结束逻辑不会被错误触发
4. ✅ 日志清晰区分"重连迁移"和"真正断线"
5. ✅ 其他状态下的多连接处理保持原有行为

## 测试覆盖

新增测试文件：`src/__tests__/reconnect-migration.test.ts`

测试用例：
1. ✅ Playing状态下的连接迁移验证
2. ✅ 非Playing状态下的正常踢出验证
3. ✅ migrateConnection边界情况处理
4. ✅ getPlayerByConnectionId功能验证

## 日志示例

重连迁移成功时的日志：
```
[重连迁移] Playing状态下的连接迁移 {
  userId: 12345,
  oldConnectionId: "conn-1",
  newConnectionId: "conn-2",
  roomId: "test-room"
}

[重连迁移] 连接已迁移 {
  userId: 12345,
  roomId: "test-room",
  oldConnectionId: "conn-1",
  newConnectionId: "conn-2",
  preservedState: {
    isFinished: false,
    score: null,
    isReady: false
  }
}
```

## 兼容性

- ✅ 向后兼容：非Playing状态的行为保持不变
- ✅ API兼容：没有修改外部接口
- ✅ 性能影响：最小，只在重连时执行额外检查
- ✅ 内存使用：无额外内存开销
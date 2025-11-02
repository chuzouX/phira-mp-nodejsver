# Protocol Mapping: Rust phira-mp vs Node.js Implementation

## Source Reference
- **Rust Repository**: https://github.com/TeamFlos/phira-mp
- **Primary Files**:
  - `phira-mp-common/src/command.rs` - Command definitions
  - `phira-mp-common/src/bin.rs` - Binary serialization
  - `phira-mp-common/src/lib.rs` - Stream and constants
  - `phira-mp-server/src/session.rs` - Message processing logic

---

## 1. Heartbeat Constants

| Rust Constant | Value | Node.js Status |
|--------------|-------|----------------|
| `HEARTBEAT_INTERVAL` | 3 seconds | ❌ Not implemented |
| `HEARTBEAT_TIMEOUT` | 2 seconds | ❌ Not implemented |
| `HEARTBEAT_DISCONNECT_TIMEOUT` | 10 seconds | ❌ Not implemented |

**Rust Implementation** (lib.rs:17-19, session.rs:284-300):
- Client sends `Ping`, server responds with `Pong` immediately
- Server monitors last received message time
- If no message received for 10 seconds, connection is terminated

**Required Fix**:
- Monitor last received time per connection
- Disconnect after 10 seconds of inactivity

---

## 2. ClientCommand Enum

All fields and types match correctly ✅

| Rust Variant | Rust Fields | Node.js Type | Status |
|-------------|-------------|--------------|--------|
| `Ping` | - | `Ping` | ✅ Correct |
| `Authenticate` | `token: Varchar<32>` | `token: string` | ✅ Correct |
| `Chat` | `message: Varchar<200>` | `message: string` | ✅ Correct |
| `Touches` | `frames: Arc<Vec<TouchFrame>>` | - | ⚠️ Not parsed |
| `Judges` | `judges: Arc<Vec<JudgeEvent>>` | - | ⚠️ Not parsed |
| `CreateRoom` | `id: RoomId` | `id: string` | ✅ Correct |
| `JoinRoom` | `id: RoomId, monitor: bool` | `id: string, monitor: boolean` | ✅ Correct |
| `LeaveRoom` | - | - | ✅ Correct |
| `LockRoom` | `lock: bool` | `lock: boolean` | ✅ Correct |
| `CycleRoom` | `cycle: bool` | `cycle: boolean` | ✅ Correct |
| `SelectChart` | `id: i32` | `id: number` | ✅ Correct |
| `RequestStart` | - | - | ✅ Correct |
| `Ready` | - | - | ✅ Correct |
| `CancelReady` | - | - | ✅ Correct |
| `Played` | `id: i32` | `id: number` | ✅ Correct |
| `Abort` | - | - | ✅ Correct |

---

## 3. ServerCommand Enum

**CRITICAL ISSUE**: Response format is completely wrong!

### Rust Format (command.rs:276-308)
```rust
pub enum ServerCommand {
    Pong,
    Authenticate(SResult<(UserInfo, Option<ClientRoomState>)>),  // Result<T, String>
    Chat(SResult<()>),
    // ... all responses use Result<T, String> format
    CreateRoom(SResult<()>),
    SelectChart(SResult<()>),
    // ...
}
```

Where `SResult<T>` = `Result<T, String>` and binary format is:
- **Success**: `true` (1 byte) + value bytes
- **Error**: `false` (0 byte) + error string

### Current Node.js Format (WRONG)
```typescript
{
  type: ServerCommandType.Authenticate;
  success: boolean;
  error?: string;
  user?: UserInfo;
  room?: ClientRoomState;
}
```

### Required Node.js Format
```typescript
{
  type: ServerCommandType.Authenticate;
  result: { ok: true; value: [UserInfo, ClientRoomState | null] } 
    | { ok: false; error: string };
}
```

---

## 4. Message Enum

**CRITICAL ISSUE**: Message is incorrectly implemented!

### Rust Format (command.rs:181-234)
```rust
#[derive(Clone, Debug, BinaryData)]
pub enum Message {
    Chat { user: i32, content: String },
    CreateRoom { user: i32 },
    JoinRoom { user: i32, name: String },
    LeaveRoom { user: i32, name: String },
    NewHost { user: i32 },
    SelectChart { user: i32, name: String, id: i32 },
    GameStart { user: i32 },
    Ready { user: i32 },
    CancelReady { user: i32 },
    CancelGame { user: i32 },
    StartPlaying,
    Played { user: i32, score: i32, accuracy: f32, full_combo: bool },
    GameEnd,
    Abort { user: i32 },
    LockRoom { lock: bool },
    CycleRoom { cycle: bool },
}
```

ServerCommand uses: `Message(Message)` variant

### Current Node.js (WRONG)
```typescript
{ type: ServerCommandType.Message; message: string }
```

### Required Fix
Create proper Message enum with all variants and use it in ServerCommand.

---

## 5. JoinRoomResponse

### Rust Format (command.rs:268-273)
```rust
pub struct JoinRoomResponse {
    pub state: RoomState,
    pub users: Vec<UserInfo>,
    pub live: bool,
}
```

**Note**: This is different from `ClientRoomState`! JoinRoom returns simpler response.

### Current Node.js
Returns full `ClientRoomState` which is incorrect.

---

## 6. SelectChart Implementation

**Source**: session.rs:559-592

### Rust Logic
1. Check user is in room (SelectChart state)
2. Check user is host
3. **Server fetches chart from API**: `GET https://phira.5wyxi.com/chart/{id}`
4. Send `Message::SelectChart { user, name, id }` to all room members
5. Update room chart state
6. Return `ServerCommand::SelectChart(Ok(()))` to sender

### Current Node.js
- Incorrectly expects client to send chart data
- Wrong response format

### Required Fix
- Accept only chart ID
- Fetch chart from Phira API
- Broadcast Message::SelectChart
- Return Result<()>

---

## 7. Binary Serialization

### Verified Correct ✅
- Little-endian encoding
- ULEB128 for variable-length integers
- String format: ULEB length + UTF-8 bytes
- Option format: bool (Some=true/None=false) + value
- Result format: bool (Ok=true/Err=false) + value/error

---

## 8. Critical Fixes Required

### Priority 1: Fix ServerCommand Response Format
- [ ] Change all responses from `success: boolean` to `Result<T, String>` format
- [ ] Update binary serialization to match Rust

### Priority 2: Fix Message Enum
- [ ] Create proper Message enum with all variants
- [ ] Update ServerCommand.Message to use enum

### Priority 3: Fix SelectChart
- [ ] Remove chart data from client command
- [ ] Implement server-side chart fetching
- [ ] Send proper Message::SelectChart broadcast

### Priority 4: Fix Heartbeat
- [ ] Implement 10-second timeout monitoring
- [ ] Track last received time per connection

### Priority 5: Fix JoinRoomResponse
- [ ] Use simpler JoinRoomResponse instead of ClientRoomState

---

## 9. Message Processing Flow

### Rust Pattern (session.rs:376-712)
```rust
match cmd {
    ClientCommand::SelectChart { id } => {
        let res: Result<()> = async move {
            get_room!(room, InternalRoomState::SelectChart);
            room.check_host(&user).await?;
            // fetch chart...
            room.send(Message::SelectChart { user, name, id }).await;
            // ...
            Ok(())
        }.await;
        Some(ServerCommand::SelectChart(err_to_str(res)))
    }
}
```

Every command:
1. Returns `Option<ServerCommand>` (None if no response needed)
2. Uses `Result<T>` for error handling
3. Broadcasts events via `Message` enum
4. Returns status via `ServerCommand` with Result

### Required Node.js Pattern
Must match this exactly!

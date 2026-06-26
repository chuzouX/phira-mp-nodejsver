
const roomList = document.getElementById('room-list');
const connectionStatus = document.getElementById('connection-status');
const totalPlayersDiv = document.getElementById('total-players');
let socket;
let isAdmin = false;
let currentTotalPlayers = 0;
let currentUserId = null; // 当前登录用户的 ID

async function checkAdminStatus() {
    try {
        const response = await fetch('/check-auth');
        const data = await response.json();
        isAdmin = data.isAdmin;
        currentUserId = data.userId || null;
    } catch (error) {
        console.error('Failed to check admin status:', error);
        isAdmin = false;
        currentUserId = null;
    }
    updateTotalPlayers(currentTotalPlayers); // Update display after checking auth
}

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established');
        connectionStatus.textContent = I18n.t('common.connected');
        connectionStatus.className = 'connection-status connected';
        checkAdminStatus(); // Check admin status once connected
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'roomList') {
                console.log('Received room list update:', message.payload);
                renderRooms(message.payload);
            } else if (message.type === 'serverStats') {
                console.log('Received server stats:', message.payload);
                updateTotalPlayers(message.payload.totalPlayers);
            } else if (message.type === 'room:announcement') {
                console.log('Received room announcement:', message.payload);
                handleRoomAnnouncement(message.payload);
            }
        } catch (error) {
            console.error('Error parsing room data:', error);
        }
    };

    socket.onclose = () => {
        console.log('WebSocket connection closed. Reconnecting in 3 seconds...');
        connectionStatus.textContent = I18n.t('common.disconnected');
        connectionStatus.className = 'connection-status disconnected';
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function updateTotalPlayers(count) {
    currentTotalPlayers = count;
    const content = `<strong>${I18n.t('common.total_players')}:</strong> ${count}`;
    if (isAdmin) {
        totalPlayersDiv.innerHTML = `<a href="/players.html">${content}</a><a href="/logout" class="logout-icon" title="Logout">&#10145;&#65039;</a>`;
    } else {
        totalPlayersDiv.innerHTML = content;
    }
}

function handleRoomAnnouncement(payload) {
    // 检查是否是目标用户（如果有指定）
    if (payload.targetUserId && payload.targetUserId !== currentUserId) {
        return;
    }

    // 显示房间播报通知
    const announcementDiv = document.getElementById('room-announcement');
    if (announcementDiv) {
        announcementDiv.textContent = payload.message;
        announcementDiv.style.display = 'block';

        // 10秒后自动隐藏
        setTimeout(() => {
            announcementDiv.style.display = 'none';
        }, 10000);
    } else {
        // 如果没有专门的元素，使用 alert 或创建临时元素
        console.log('Room announcement:', payload.message);
    }
}

function renderRooms(rooms) {
    roomList.innerHTML = '';
    let totalPlayers = 0;

    if (rooms.length === 0) {
        roomList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🏠</div>
                <div class="empty-state-text">${I18n.t('index.no_rooms')}</div>
            </div>
        `;
    } else {
        rooms.forEach(room => {
            totalPlayers += room.playerCount;
            const roomCard = document.createElement('div');
            roomCard.className = 'room-card' + (room.isRemote ? ' room-card-remote' : '');

            const lockIcon = room.locked ? '&#128274;' : '&#128275;';
            const lockStatusClass = room.locked ? 'locked-status' : 'unlocked-status';
            const roomMode = room.cycle ? I18n.t('room.mode_cycle') : I18n.t('room.mode_normal');

            const serverTag = room.isRemote 
                ? `<span class="room-server-tag room-server-remote" title="${I18n.t('index.remote_room')}">🌐 ${room.serverName || I18n.t('common.unknown')}</span>` 
                : (rooms.some(r => r.isRemote) ? `<span class="room-server-tag room-server-local">📍 ${room.serverName || I18n.t('index.local_server')}</span>` : '');

            roomCard.innerHTML = `
                <h2>${I18n.t('room.room_no')}#${room.id}${serverTag}</h2>
                <div class="room-info">
                    <p>${I18n.t('room.mode')}: <span class="room-mode-tag">${roomMode}</span></p>
                    <p>${I18n.t('room.host')}: <span style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${room.ownerName} (ID: ${room.ownerId})">${room.ownerName} (ID: ${room.ownerId})</span></p>
                    <p>${I18n.t('room.players')}: <span>${room.playerCount} / ${room.maxPlayers}</span></p>
                    <p>${I18n.t('room.status')}: <span>${room.state.type}</span></p>
                    <p>${I18n.t('room.locked')}: <span class="${lockStatusClass}">${lockIcon}</span></p>
                </div>
            `;
            
            const link = document.createElement('a');
            link.href = `room.html?id=${room.id}${room.isRemote ? '&remote=1&node=' + encodeURIComponent(room.nodeId || '') : ''}`;
            link.style.textDecoration = 'none';
            link.style.color = 'inherit';
            link.appendChild(roomCard);

            roomList.appendChild(link);
        });
    }
}

// Initial connection
if (I18n.isReady) {
    connectWebSocket();
} else {
    document.addEventListener('i18nReady', connectWebSocket);
}

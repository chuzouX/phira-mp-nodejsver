
const roomList = document.getElementById('room-list');
const connectionStatus = document.getElementById('connection-status');
const totalPlayersDiv = document.getElementById('total-players');
let socket;
let isAdmin = false;
let currentTotalPlayers = 0;

async function checkAdminStatus() {
    try {
        const response = await fetch('/check-auth');
        const data = await response.json();
        isAdmin = data.isAdmin;
    } catch (error) {
        console.error('Failed to check admin status:', error);
        isAdmin = false;
    }
    updateTotalPlayers(currentTotalPlayers); // Update display after checking auth
}

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established');
        connectionStatus.textContent = 'Connected';
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
            }
        } catch (error) {
            console.error('Error parsing room data:', error);
        }
    };

    socket.onclose = () => {
        console.log('WebSocket connection closed. Reconnecting in 3 seconds...');
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'connection-status disconnected';
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function updateTotalPlayers(count) {
    currentTotalPlayers = count;
    const content = `<strong>Total Players Online:</strong> ${count}`;
    if (isAdmin) {
        totalPlayersDiv.innerHTML = `<a href="/players.html">${content}</a><a href="/logout" class="logout-icon" title="Logout">&#10145;&#65039;</a>`;
    } else {
        totalPlayersDiv.innerHTML = content;
    }
}

function renderRooms(rooms) {
    roomList.innerHTML = '';
    let totalPlayers = 0;

    if (rooms.length === 0) {
        roomList.innerHTML = '<p>No active rooms.</p>';
    } else {
        rooms.forEach(room => {
            totalPlayers += room.playerCount;
            const roomCard = document.createElement('div');
            roomCard.className = 'room-card';

            const lockIcon = room.locked ? '&#128274;' : '&#128275;';
            const lockStatusClass = room.locked ? 'locked-status' : 'unlocked-status';
            const roomMode = room.cycle ? '循环模式' : '普通模式';

            roomCard.innerHTML = `
                <h2>房间号#${room.id}</h2>
                <div class="room-info">
                    <p>Mode: <span style="font-weight:bold; color:#3498db;">${roomMode}</span></p>
                    <p>Host: <span>${room.ownerName} (ID: ${room.ownerId})</span></p>
                    <p>Players: <span>${room.playerCount} / ${room.maxPlayers}</span></p>
                    <p>Status: <span>${room.state.type}</span></p>
                    <p>Locked: <span class="${lockStatusClass}">${lockIcon}</span></p>
                </div>
            `;
            
            const link = document.createElement('a');
            link.href = `room.html?id=${room.id}`;
            link.style.textDecoration = 'none';
            link.style.color = 'inherit';
            link.appendChild(roomCard);

            roomList.appendChild(link);
        });
    }
}

// Initial connection
connectWebSocket();

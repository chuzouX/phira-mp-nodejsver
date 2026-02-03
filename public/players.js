
document.addEventListener('DOMContentLoaded', () => {
    const playerListDiv = document.getElementById('all-players-list');
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
        updateTotalPlayers(currentTotalPlayers);
    }

    function updateTotalPlayers(count) {
        currentTotalPlayers = count;
        totalPlayersDiv.innerHTML = `<strong>Total Players Online:</strong> ${count}`;
    }

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;
        const connectionStatus = document.getElementById('connection-status');

        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connection established');
            if (connectionStatus) {
                connectionStatus.textContent = 'Connected';
                connectionStatus.className = 'connection-status connected';
            }
            checkAdminStatus();
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'serverStats') {
                    updateTotalPlayers(message.payload.totalPlayers);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        socket.onclose = () => {
            console.log('WebSocket connection closed. Reconnecting in 3 seconds...');
            if (connectionStatus) {
                connectionStatus.textContent = 'Disconnected';
                connectionStatus.className = 'connection-status disconnected';
            }
            setTimeout(connectWebSocket, 3000);
        };
    }

    async function fetchAllPlayers() {
        try {
            const response = await fetch('/api/all-players');
            if (response.status === 403) {
                playerListDiv.innerHTML = '<p>Access Denied. You must be an admin to view this page. <a href="/admin">Login</a></p>';
                return;
            }
            if (!response.ok) {
                throw new Error(`Failed to fetch players: ${response.statusText}`);
            }
            const players = await response.json();
            renderPlayers(players);
        } catch (error) {
            console.error('Error fetching all players:', error);
            playerListDiv.innerHTML = `<p>Error loading players: ${error.message}</p>`;
        }
    }

    function renderPlayers(players) {
        if (!players || players.length === 0) {
            playerListDiv.innerHTML = '<p>No players are currently online.</p>';
            return;
        }

        // Filter out bots (ID -1) and Sort
        const sortedPlayers = players
            .filter(p => p.id !== -1)
            .sort((a, b) => {
                // Priority: Server Owner > Admin > Regular
                const getWeight = (p) => {
                    if (p.isOwner) return 2;
                    if (p.isAdmin) return 1;
                    return 0;
                };

                const weightA = getWeight(a);
                const weightB = getWeight(b);

                return weightB - weightA; // Descending weight
            });

        const playerListHtml = sortedPlayers.map(p => {
            const locationHtml = p.roomId 
                ? `In Room: <a href="room.html?id=${p.roomId}">${p.roomName}</a>`
                : 'In Lobby';
            
            let userIcon = '&#128100;'; // Regular Person
            let nameClass = 'player-name';

            if (p.isOwner) {
                userIcon = '&#127775;'; // Glowing Star
                nameClass += ' server-owner';
            } else if (p.isAdmin) {
                userIcon = '&#128110;'; // Police Officer
                nameClass += ' admin';
            }
            
            return `
            <li class="player-item">
                <div class="player-info-left">
                    <span class="player-icon"></span>
                    <a class="${nameClass}" href="https://phira.moe/user/${p.id}" target="_blank">${userIcon} ${p.name} (ID: ${p.id})</a>
                </div>
                <span>${locationHtml}</span>
            </li>
            `;
        }).join('');

        playerListDiv.innerHTML = `
            <h3>All Online Players (${players.length})</h3>
            <ul class="player-list">
                ${playerListHtml}
            </ul>
        `;
    }

    fetchAllPlayers();
    connectWebSocket();
});

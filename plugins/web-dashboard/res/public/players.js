
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
        if (!totalPlayersDiv) return;
        const content = `<strong>${I18n.t('common.total_players')}:</strong> ${count}`;
        
        // Always link to home in players.html as it replaces the back button
        const homeLink = `<a href="/">${content}</a>`;
        
        if (isAdmin) {
            totalPlayersDiv.innerHTML = `${homeLink}<a href="/logout" class="logout-icon" title="Logout">&#10145;&#65039;</a>`;
        } else {
            totalPlayersDiv.innerHTML = homeLink;
        }
    }

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;
        const connectionStatus = document.getElementById('connection-status');

        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connection established');
            if (connectionStatus) {
                connectionStatus.textContent = I18n.t('common.connected');
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
                connectionStatus.textContent = I18n.t('common.disconnected');
                connectionStatus.className = 'connection-status disconnected';
            }
            setTimeout(connectWebSocket, 3000);
        };
    }

    async function fetchAllPlayers() {
        try {
            const response = await fetch('/api/all-players');
            if (response.status === 403) {
                playerListDiv.innerHTML = `<p>Access Denied. You must be an admin to view this page. <a href="/admin" data-i18n="admin.login">Login</a></p>`;
                I18n.applyTranslations(); // Re-apply for the new link
                return;
            }
            if (!response.ok) {
                throw new Error(`Failed to fetch players: ${response.statusText}`);
            }
            const players = await response.json();
            renderPlayers(players);
        } catch (error) {
            console.error('Error fetching all players:', error);
            playerListDiv.innerHTML = `<p>${I18n.t('common.error')} loading players: ${error.message}</p>`;
        }
    }

    function renderPlayers(players) {
    if (players.length === 0) {
        playerListDiv.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <div class="empty-state-text">${I18n.t('players.no_players')}</div>
            </div>
        `;
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
                ? `${I18n.t('players.in_room')}: <a href="room.html?id=${p.roomId}" class="room-go-btn">${p.roomName || p.roomId}</a>`
                : `<span class="lobby-tag">${I18n.t('players.in_lobby')}</span>`;
            
            let userIcon = '&#128100;'; // Regular Person
            let nameClass = 'player-name';

            if (p.isOwner) {
                userIcon = '&#127775;'; // Glowing Star
                nameClass += ' server-owner';
            } else if (p.isAdmin) {
                userIcon = '&#128110;'; // Police Officer
                nameClass += ' admin';
            } else {
                nameClass += ' name-member';
            }
            
            const adminActionsHtml = isAdmin ? `
                <div class="player-admin-actions">
                    <button class="kick-btn" onclick="banPlayer('id', ${p.id})">${I18n.t('players.ban')} ID</button>
                    <button class="kick-btn action-orange" onclick="banPlayer('ip', '${p.ip}')">${I18n.t('players.ban')} IP</button>
                </div>
            ` : '';

            return `
            <li class="player-item">
                <div class="player-info-left">
                    <span class="player-icon">${userIcon}</span>
                    <a class="${nameClass}" href="https://phira.moe/user/${p.id}" target="_blank">${p.name} (ID: ${p.id})</a>
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                    ${locationHtml}
                    ${adminActionsHtml}
                </div>
            </li>
            `;
        }).join('');

        playerListDiv.innerHTML = `
            <h3>${I18n.t('players.all_players')} (${players.length})</h3>
            <ul class="player-list">
                ${playerListHtml}
            </ul>
        `;
    }

    window.banPlayer = async (type, target) => {
        const reason = prompt(I18n.t('ban.reason_placeholder'));
        if (!reason) return;
        const duration = prompt(I18n.t('ban.duration_placeholder'));
        
        try {
            const res = await fetch('/api/admin/ban', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, target, duration: duration || null, reason })
            });
            const data = await res.json();
            if (data.success) {
                alert(I18n.t('room.admin.success'));
                location.reload();
            }
        } catch (e) { alert('Ban failed'); }
    };

    if (I18n.isReady) {
        fetchAllPlayers();
        connectWebSocket();
    } else {
        document.addEventListener('i18nReady', () => {
            fetchAllPlayers();
            connectWebSocket();
        });
    }
});

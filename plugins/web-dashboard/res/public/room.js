document.addEventListener('DOMContentLoaded', () => {
    const roomName = document.getElementById('room-name');
    const roomDetails = document.getElementById('room-details');
    const connectionStatus = document.getElementById('connection-status');
    const totalPlayersDiv = document.getElementById('total-players');
    
    // Global error handler to catch rendering issues
    window.onerror = function(msg, url, line) {
        if (roomName) roomName.textContent = 'Error: ' + msg + ' (Line: ' + line + ')';
        return false;
    };

    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('id');
    let socket;
    let isAdmin = false;
    let currentTotalPlayers = 0;
    
    let lastDetails = null;
    let currentOtherRooms = [];
    let lastMessageCount = -1;
    let announcementTimeout = null;
    const defaultAvatar = (window.SERVER_CONFIG && window.SERVER_CONFIG.defaultAvatar) || 'https://phira.5wyxi.com/files/6ad662de-b505-4725-a7ef-72d65f32b404';

    function showAnnouncement(m) {
        try {
            const popup = document.getElementById('announcement-popup');
            if (!popup) return;

            if (announcementTimeout) {
                clearTimeout(announcementTimeout);
                announcementTimeout = null;
            }

            let content = '';
            const uName = m.userName || I18n.t('common.unknown');
            switch (m.type) {
                case 'Chat': content = `${uName}: ${m.content}`; break;
                case 'JoinRoom': content = I18n.t('room.events.join', { user: m.name || uName }); break;
                case 'LeaveRoom': content = I18n.t('room.events.leave', { user: m.name || uName }); break;
                case 'CreateRoom': content = I18n.t('room.events.create', { user: uName }); break;
                case 'NewHost': content = I18n.t('room.events.new_host', { user: uName }); break;
                case 'SelectChart': content = I18n.t('room.events.select_chart', { name: m.name, id: m.id }); break;
                case 'GameStart': content = I18n.t('room.events.game_start'); break;
                case 'Ready': content = I18n.t('room.events.ready', { user: uName }); break;
                case 'CancelReady': content = I18n.t('room.events.cancel_ready', { user: uName }); break;
                case 'StartPlaying': content = I18n.t('room.events.start_playing'); break;
                case 'Played':
                    content = I18n.t('room.events.played', { 
                        user: uName, 
                        score: (m.score || 0).toLocaleString(), 
                        acc: ((m.accuracy || 0) * 100).toFixed(2) 
                    });
                    break;
                case 'Abort': content = I18n.t('room.events.abort', { user: uName }); break;
                case 'GameEnd': content = I18n.t('room.events.game_end'); break;
                case 'LockRoom': content = I18n.t('room.events.lock_room', { status: m.lock ? I18n.t('room.events.lock') : I18n.t('room.events.unlock') }); break;
                case 'CycleRoom': content = I18n.t('room.events.cycle_room', { status: m.cycle ? I18n.t('room.events.on') : I18n.t('room.events.off') }); break;
                default: content = `${m.type} event`;
            }

            popup.textContent = content;
            popup.classList.add('show');
            popup.style.opacity = '1';

            announcementTimeout = setTimeout(() => {
                popup.style.opacity = '0';
                setTimeout(() => { popup.classList.remove('show'); }, 300);
                announcementTimeout = null;
            }, 3000);
        } catch (e) { console.error('Announcement Error:', e); }
    }

    window.refreshOtherRooms = () => {
        if (!currentOtherRooms || currentOtherRooms.length === 0) return;
        for (let i = currentOtherRooms.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [currentOtherRooms[i], currentOtherRooms[j]] = [currentOtherRooms[j], currentOtherRooms[i]];
        }
        if (lastDetails) renderRoomDetails(lastDetails);
    };

    // Admin Actions
    window.sendAdminServerMessage = async () => {
        const content = prompt(I18n.currentLang === 'zh' ? '请输入发送的消息：' : 'Enter message:');
        if (!content || !content.trim()) return;
        try {
            await fetch('/api/admin/server-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, content })
            });
        } catch (e) { alert('Failed'); }
    };

    window.kickPlayerByAdmin = async () => {
        const id = prompt(I18n.currentLang === 'zh' ? '请输入玩家ID：' : 'Enter Player ID:');
        if (!id) return;
        try {
            await fetch('/api/admin/kick-player', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: parseInt(id) })
            });
        } catch (e) { alert('Failed'); }
    };

    window.forceStartByAdmin = async () => {
        if (!confirm(I18n.currentLang === 'zh' ? '确定要强制开启游戏？' : 'Force start game?')) return;
        try {
            await fetch('/api/admin/force-start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
        } catch (e) { alert('Failed'); }
    };

    window.toggleRoomLockByAdmin = async () => {
        try {
            await fetch('/api/admin/toggle-lock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
        } catch (e) { alert('Failed'); }
    };

    window.setMaxPlayersByAdmin = async () => {
        const count = prompt(I18n.currentLang === 'zh' ? '请输入最大人数：' : 'Enter max players:');
        if (!count) return;
        try {
            await fetch('/api/admin/set-max-players', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, maxPlayers: parseInt(count) })
            });
        } catch (e) { alert('Failed'); }
    };

    window.closeRoomByAdmin = async () => {
        if (!confirm(I18n.currentLang === 'zh' ? '确定关闭房间？' : 'Close room?')) return;
        try {
            await fetch('/api/admin/close-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
            window.location.href = '/';
        } catch (e) { alert('Failed'); }
    };

    window.toggleRoomModeByAdmin = async () => {
        try {
            await fetch('/api/admin/toggle-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
        } catch (e) { alert('Failed'); }
    };

    window.manageBlacklistByAdmin = async () => {
        try {
            const res = await fetch(`/api/admin/room-blacklist?roomId=${roomId}`);
            const data = await res.json();
            const input = prompt('Blacklist (ID,ID):', (data.blacklist || []).join(','));
            if (input === null) return;
            const userIds = input.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            await fetch('/api/admin/set-room-blacklist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, userIds })
            });
        } catch (e) { alert('Failed'); }
    };

    window.manageWhitelistByAdmin = async () => {
        try {
            const res = await fetch(`/api/admin/room-whitelist?roomId=${roomId}`);
            const data = await res.json();
            const input = prompt('Whitelist (ID,ID):', (data.whitelist || []).join(','));
            if (input === null) return;
            const userIds = input.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            await fetch('/api/admin/set-room-whitelist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, userIds })
            });
        } catch (e) { alert('Failed'); }
    };

    async function checkAdminStatus() {
        try {
            const response = await fetch('/check-auth');
            const data = await response.json();
            isAdmin = !!data.isAdmin;
        } catch (error) { isAdmin = false; }
        updateTotalPlayers(currentTotalPlayers);
        if (lastDetails) renderRoomDetails(lastDetails);
    }

    function updateTotalPlayers(count) {
        currentTotalPlayers = count;
        if (!totalPlayersDiv) return;
        const content = `<strong>${I18n.t('common.total_players')}:</strong> ${count}`;
        if (isAdmin) {
            totalPlayersDiv.innerHTML = `<a href="/players.html">${content}</a><a href="/logout" class="logout-icon" title="Logout">&#10145;&#65039;</a>`;
        } else {
            totalPlayersDiv.innerHTML = content;
        }
    }

    function connectWebSocket() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            socket = new WebSocket(`${protocol}//${window.location.host}`);

            socket.onopen = () => {
                if (connectionStatus) {
                    connectionStatus.textContent = I18n.t('common.connected');
                    connectionStatus.className = 'connection-status connected';
                }
                checkAdminStatus();
                socket.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId } }));
            };

            socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'roomDetails') renderRoomDetails(message.payload);
                    else if (message.type === 'serverStats') updateTotalPlayers(message.payload.totalPlayers);
                    else if (message.type === 'roomList') socket.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId } }));
                } catch (error) { console.error('WS Message Error:', error); }
            };

            socket.onclose = () => {
                if (connectionStatus) {
                    connectionStatus.textContent = I18n.t('common.disconnected');
                    connectionStatus.className = 'connection-status disconnected';
                }
                setTimeout(connectWebSocket, 3000);
            };

            socket.onerror = (err) => {
                console.error('WS Socket Error:', err);
            };
        } catch (e) { console.error('WS Connection Error:', e); }
    }

    function renderRoomDetails(details) {
        try {
            if (!details) {
                roomName.textContent = `${I18n.t('common.error')}: Room "${roomId}" not found`;
                roomDetails.innerHTML = '';
                return;
            }

            // Announcement logic
            if (details.messages) {
                const currentCount = details.messages.length;
                if (lastMessageCount !== -1 && currentCount > lastMessageCount) {
                    for (let i = lastMessageCount; i < currentCount; i++) {
                        showAnnouncement(details.messages[i]);
                    }
                }
                lastMessageCount = currentCount;
            }

            lastDetails = details;
            
            // Sync Other Rooms
            if (details.otherRooms) {
                const newIds = new Set(details.otherRooms.map(r => r.id));
                const currentIds = new Set(currentOtherRooms.map(r => r.id));
                let needsUpdate = newIds.size !== currentIds.size;
                if (!needsUpdate) for (let id of newIds) if (!currentIds.has(id)) needsUpdate = true;
                
                if (needsUpdate || currentOtherRooms.length === 0) {
                    currentOtherRooms = [...details.otherRooms];
                    for (let i = currentOtherRooms.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [currentOtherRooms[i], currentOtherRooms[j]] = [currentOtherRooms[j], currentOtherRooms[i]];
                    }
                } else {
                    currentOtherRooms = currentOtherRooms.map(cr => details.otherRooms.find(r => r.id === cr.id) || cr);
                }
            }

            roomName.textContent = `${I18n.t('room.room_no')}#${details.id || roomId}`;
            const lockIcon = details.locked ? '&#128274;' : '&#128275;';
            const lockStatusClass = details.locked ? 'locked-status' : 'unlocked-status';
            const roomMode = details.cycle ? I18n.t('room.mode_cycle') : I18n.t('room.mode_normal');

            // Chart Stars Calculation
            const ratingVal = details.selectedChart?.rating ?? 0;
            const ratingNum = ratingVal * 5;
            const ratingDisplay = ratingNum.toFixed(2);
            const wholeStars = Math.floor(ratingNum);
            const firstDecimal = Math.floor((ratingNum - wholeStars) * 10);

            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                if (i <= wholeStars) starsHtml += '<span class="star-filled">&#9733;</span>';
                else if (i === wholeStars + 1) {
                    if (firstDecimal > 7) starsHtml += '<span class="star-filled">&#9733;</span>';
                    else if (firstDecimal >= 3) starsHtml += '<span class="star-half">&#9733;</span>';
                    else starsHtml += '<span class="star-empty">&#9733;</span>';
                } else starsHtml += '<span class="star-empty">&#9733;</span>';
            }

            const chartInfoHtml = `
                <div class="chart-container">
                    ${details.selectedChart?.illustration ? `
                        <div class="chart-illustration">
                            <img src="${details.selectedChart.illustration}" alt="Illustration">
                        </div>` : `<div class="chart-illustration" style="background:var(--muted-bg); height:200px; display:flex; align-items:center; justify-content:center; color:var(--text-muted); border-radius:8px;">${I18n.t('room.no_illustration')}</div>`}
                    <div class="chart-details-box">
                        <h4>${I18n.t('room.chart_info')}</h4>
                        <p><strong>Name:</strong> <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;" title="${details.selectedChart?.name || ''}">${details.selectedChart?.name || I18n.t('room.not_selected')}</span></p>
                        <p><strong>${I18n.t('room.id')}:</strong> ${details.selectedChart?.id || 'N/A'}</p>
                        <p><strong>${I18n.t('room.level')}:</strong> ${details.selectedChart?.level || 'N/A'}</p>
                        <p><strong>${I18n.t('room.difficulty')}:</strong> ${details.selectedChart?.difficulty || 'N/A'}</p>
                        <p><strong>${I18n.t('room.charter')}:</strong> <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;" title="${details.selectedChart?.charter || ''}">${details.selectedChart?.charter || 'N/A'}</span></p>
                        <p><strong>${I18n.t('room.composer')}:</strong> <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;" title="${details.selectedChart?.composer || ''}">${details.selectedChart?.composer || 'N/A'}</span></p>
                        <p><strong>${I18n.t('room.rating')}:</strong> <span>${starsHtml} <span style="font-size:0.9em; color:var(--text-muted);">(${ratingDisplay} / 5.00)</span></span></p>
                    </div>
                </div>
            `;

            // Host Info
            const host = (details.players || []).find(p => p.id === details.ownerId);
            const hostHtml = `
                <div class="detail-card">
                    <h3>${I18n.t('room.host_info')}</h3>
                    <div class="uploader-info">
                        <a href="https://phira.moe/user/${details.ownerId}" target="_blank" style="text-decoration:none; color:inherit;">
                            <img src="${host?.avatar || defaultAvatar}" class="uploader-avatar">
                            <div class="uploader-text">
                                <p class="uploader-name">${host?.name || I18n.t('common.unknown')}</p>
                                <p class="uploader-rks">RKS: ${(host?.rks ?? 0).toFixed(2)}</p>
                                <p class="uploader-bio">${host?.bio || I18n.t('room.host_no_bio')}</p>
                                <p class="uploader-id">ID: ${details.ownerId}</p>
                                <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 8px; font-weight:700;">${I18n.t('room.room_host_tag')}</p>
                            </div>
                        </a>
                    </div>
                </div>
            `;

            // Player List
            const sortedPlayers = [...(details.players || [])].sort((a,b) => (a.id===details.ownerId?-1:b.id===details.ownerId?1:a.id===-1?1:b.id===-1?-1:0));
            const playersHtml = sortedPlayers.map(p => {
                const isOwner = p.id === details.ownerId;
                const isServer = p.id === -1;
                const statusClass = isServer ? 'status-bot' : (p.isReady ? 'status-ready' : 'status-not-ready');
                const nameClass = isServer ? 'name-bot' : (isOwner ? 'name-owner' : 'name-member');
                const prefixClass = isServer ? 'prefix-bot' : (isOwner ? 'prefix-owner' : 'prefix-player');
                const prefixText = isServer ? '[Bot]' : (isOwner ? '[Owner]' : '[Player]');
                return `
                    <li class="player-item">
                        <div class="player-info-left">
                            <img src="${p.avatar || defaultAvatar}" class="player-avatar-small">
                            <a class="player-name ${nameClass}" href="${isServer ? '#' : `https://phira.moe/user/${p.id}`}" target="_blank"><span class="name-prefix ${prefixClass}">${prefixText}</span>${p.name || I18n.t('common.unknown')}</a>
                        </div>
                        <span class="player-status ${statusClass}">${isServer ? 'Bot' : (p.isReady ? 'Ready' : 'Not Ready')}</span>
                    </li>
                `;
            }).join('');

            // Results - Always shown
            const scores = (details.players || []).filter(p => p.score).sort((a,b) => (b.score?.score || 0) - (a.score?.score || 0));
            const resultsTableBody = scores.length > 0 
                ? scores.map((p, i) => `
                    <tr>
                        <td class="rank-${i+1}">#${i+1}</td>
                        <td style="text-align:left; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name || I18n.t('common.unknown')}</td>
                        <td class="score-val">${(p.score?.score || 0).toLocaleString()}</td>
                        <td>${((p.score?.accuracy || 0)*100).toFixed(2)}%</td>
                        <td style="font-weight: 700; color: var(--primary-color);">${p.score?.maxCombo || 0}</td>
                        <td style="font-size: 0.85em; color: var(--text-muted); min-width: 80px;">
                            ${p.score?.perfect || 0} / ${p.score?.good || 0} / ${p.score?.bad || 0} / ${p.score?.miss || 0}
                        </td>
                    </tr>`).join('')
                : `<tr><td colspan="6" style="padding: 40px; color: var(--text-muted); font-style: italic;">${I18n.t('room.no_results')}</td></tr>`;

            const resultsHtml = `
                <div class="detail-card" id="card-game-results">
                    <h3>${I18n.t('room.game_results')}</h3>
                    <div class="results-scroll">
                        <table class="results-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th style="text-align:left">${I18n.t('room.player')}</th>
                                    <th>${I18n.t('room.score')}</th>
                                    <th>Acc</th>
                                    <th>Combo</th>
                                    <th>P/G/B/M</th>
                                </tr>
                            </thead>
                            <tbody>${resultsTableBody}</tbody>
                        </table>
                    </div>
                </div>
            `;

            // Messages
            const messagesHtml = (details.messages || []).map(m => {
                let text = '';
                const uName = m.userName || I18n.t('common.unknown');
                switch(m.type) {
                    case 'Chat': text = `<span class="msg-user">${uName}:</span><span class="msg-chat">${m.content}</span>`; break;
                    case 'CreateRoom': text = `<span class="msg-system">${I18n.t('room.events.create', { user: uName })}</span>`; break;
                    case 'JoinRoom': text = `<span class="msg-system">${I18n.t('room.events.join', { user: m.name || uName })}</span>`; break;
                    case 'LeaveRoom': text = `<span class="msg-system">${I18n.t('room.events.leave', { user: m.name || uName })}</span>`; break;
                    case 'NewHost': text = `<span class="msg-system">${I18n.t('room.events.new_host', { user: uName })}</span>`; break;
                    case 'SelectChart': text = `<span class="msg-system">${I18n.t('room.events.select_chart', { name: m.name, id: m.id })}</span>`; break;
                    case 'GameStart': text = `<span class="msg-system">${I18n.t('room.events.game_start')}</span>`; break;
                    case 'Ready': text = `<span class="msg-ready">${I18n.t('room.events.ready', { user: uName })}</span>`; break;
                    case 'CancelReady': text = `<span class="msg-system">${I18n.t('room.events.cancel_ready', { user: uName })}</span>`; break;
                    case 'CancelGame': text = `<span class="msg-system">${I18n.t('room.events.cancel_game', { user: uName })}</span>`; break;
                    case 'StartPlaying': text = `<span class="msg-playing">${I18n.t('room.events.start_playing')}</span>`; break;
                    case 'Played': text = `<span class="msg-system">${I18n.t('room.events.played', { user: uName, score: (m.score||0).toLocaleString(), acc: ((m.accuracy||0)*100).toFixed(2) })}</span>`; break;
                    case 'GameEnd': text = `<span class="msg-system">${I18n.t('room.events.game_end')}</span>`; break;
                    case 'Abort': text = `<span class="msg-system">${I18n.t('room.events.abort', { user: uName })}</span>`; break;
                    case 'LockRoom': text = `<span class="msg-system">${I18n.t('room.events.lock_room', { status: m.lock ? I18n.t('room.events.lock') : I18n.t('room.events.unlock') })}</span>`; break;
                    case 'CycleRoom': text = `<span class="msg-system">${I18n.t('room.events.cycle_room', { status: m.cycle ? I18n.t('room.events.on') : I18n.t('room.events.off') })}</span>`; break;
                    default: text = `<span class="msg-system">${m.type} event</span>`;
                }
                return `<div class="message-item">${text}</div>`;
            }).join('');

            const chatContentHtml = messagesHtml || `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); opacity:0.6;">
                    <div style="font-size:2rem; margin-bottom:10px;">💬</div>
                    <div style="font-size:0.8rem;">${I18n.t('room.no_messages')}</div>
                </div>
            `;

            // Admin
            let adminHtml = '';
            if (isAdmin) {
                adminHtml = `
                    <div class="detail-card admin-panel-card" id="card-admin-panel">
                        <h3>${I18n.t('room.admin_panel')}</h3>
                        <div class="admin-category"><div class="admin-buttons-grid">
                            <button class="admin-btn action-primary" onclick="window.sendAdminServerMessage()">${I18n.t('room.admin.message')}</button>
                            <button class="admin-btn action-primary" onclick="window.forceStartByAdmin()">${I18n.t('room.admin.start')}</button>
                            <button class="admin-btn action-danger" onclick="window.closeRoomByAdmin()">${I18n.t('room.admin.close')}</button>
                            <button class="admin-btn" onclick="window.setMaxPlayersByAdmin()">${I18n.t('room.admin.size')}</button>
                            <button class="admin-btn" onclick="window.toggleRoomModeByAdmin()">${I18n.t('room.admin.mode')}</button>
                            <button class="admin-btn" onclick="window.toggleRoomLockByAdmin()">${I18n.t('room.admin.lock')}</button>
                            <button class="admin-btn action-warning" onclick="window.kickPlayerByAdmin()">${I18n.t('room.admin.kick')}</button>
                            <button class="admin-btn" onclick="window.manageBlacklistByAdmin()">${I18n.t('room.admin.blacklist')}</button>
                            <button class="admin-btn" onclick="window.manageWhitelistByAdmin()">${I18n.t('room.admin.whitelist')}</button>
                        </div></div>
                    </div>
                `;
            }

            const otherRoomsContent = (currentOtherRooms || []).length > 0 
                ? currentOtherRooms.slice(0,5).map(r => {
                    const serverBadge = r.isRemote ? `<span class="other-room-server-badge remote">🌐 ${r.serverName || ''}</span>` : '';
                    return `<a href="room.html?id=${r.id}${r.isRemote ? '&remote=1' : ''}" class="other-room-item${r.isRemote ? ' other-room-remote' : ''}"><span class="other-room-name">${r.name || 'Room'}${serverBadge}</span><span class="other-room-count">${r.playerCount}/${r.maxPlayers}</span></a>`;
                }).join('')
                : `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:0.85rem; font-style:italic;">${I18n.t('room.no_other_rooms')}</div>`;

            roomDetails.innerHTML = `
                <div class="left-sidebar">
                    <div class="detail-card" id="card-room-info">
                        <h3>${I18n.t('room.room_info')}</h3>
                        <p><strong>ID:</strong> ${details.id || 'N/A'}</p>
                        <p><strong>${I18n.t('room.mode')}:</strong> <span class="room-mode-tag">${roomMode}</span></p>
                        <p><strong>${I18n.t('room.host')}:</strong> <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;" title="${host?.name || ''}">${host?.name || I18n.t('common.unknown')}</span></p>
                        <p><strong>${I18n.t('room.players')}:</strong> ${details.playerCount || 0} / ${details.maxPlayers || 0}</p>
                        <p><strong>${I18n.t('room.status')}:</strong> ${details.state?.type || 'Unknown'}</p>
                        <p><strong>${I18n.t('room.locked')}:</strong> <span class="${lockStatusClass}">${lockIcon}</span></p>
                    </div>
                    <div id="card-host-info">${hostHtml}</div>
                    <div class="detail-card" id="card-other-rooms">
                        <h3>${I18n.t('room.other_rooms')}</h3>
                        <div class="other-rooms-scroll">${otherRoomsContent}</div>
                        ${currentOtherRooms.length > 5 ? `<button class="refresh-rooms-btn" style="width:100%; margin-top:10px; padding:8px; border-radius:8px; border:1px solid var(--border-color); cursor:pointer;" onclick="window.refreshOtherRooms()">&#128260; ${I18n.t('room.refresh')}</button>` : ''}
                    </div>
                </div>
                <div class="center-column">
                    <div class="detail-card" id="card-player-list">
                        <h3>${I18n.t('room.player_list')}</h3>
                        <div class="player-list-scroll"><ul class="player-list">${playersHtml}</ul></div>
                    </div>
                    ${resultsHtml}
                    ${adminHtml}
                </div>
                <div class="right-sidebar">
                    <div class="detail-card" id="card-chart-info"><h3>${I18n.t('room.chart_info')}</h3>${chartInfoHtml}</div>
                    <div class="detail-card" id="card-public-screen">
                        <h3>${I18n.t('room.public_screen')}</h3>
                        <div class="message-container" id="message-scroll-box">${chatContentHtml}</div>
                    </div>
                </div>
            `;

            const scrollBox = document.getElementById('message-scroll-box');
            if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;

        } catch (err) {
            console.error('Render Error Detail:', err);
            if (roomName) roomName.textContent = 'Render Error: ' + err.message;
        }
    }

    if (roomId) {
        if (I18n.isReady) connectWebSocket();
        else document.addEventListener('i18nReady', connectWebSocket);
    }
    else if (roomName) roomName.textContent = 'Error: No Room ID specified';
});
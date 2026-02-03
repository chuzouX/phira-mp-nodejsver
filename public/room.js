
document.addEventListener('DOMContentLoaded', () => {
    const roomName = document.getElementById('room-name');
    const roomDetails = document.getElementById('room-details');
    const connectionStatus = document.getElementById('connection-status');
    const totalPlayersDiv = document.getElementById('total-players'); // Add this
    
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('id');
    let socket;
    let isAdmin = false; // RESTORED
    
    // State for Other Rooms
    let lastDetails = null;
    let currentOtherRooms = [];
    
    window.refreshOtherRooms = () => {
        if (!currentOtherRooms || currentOtherRooms.length === 0) return;
        // Shuffle currentOtherRooms in place or just create a new random subset logic
        // Simple shuffle
        for (let i = currentOtherRooms.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [currentOtherRooms[i], currentOtherRooms[j]] = [currentOtherRooms[j], currentOtherRooms[i]];
        }
        if (lastDetails) renderRoomDetails(lastDetails);
    };

    window.sendAdminServerMessage = async () => {
        const content = prompt('请输入发送的消息：');
        if (!content || !content.trim()) return;

        try {
            const response = await fetch('/api/admin/server-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, content })
            });
            if (!response.ok) throw new Error('Failed to send message');
            console.log('Admin message sent successfully');
        } catch (error) {
            alert('发送失败: ' + error.message);
        }
    };

    window.kickPlayerByAdmin = async () => {
        const userIdStr = prompt('请输入玩家ID：');
        if (!userIdStr || !userIdStr.trim()) return;
        const userId = parseInt(userIdStr.trim(), 10);
        if (isNaN(userId)) {
            alert('请输入有效的数字ID');
            return;
        }

        try {
            const response = await fetch('/api/admin/kick-player', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('踢出失败，玩家可能不在房间中');
            console.log('Player kicked successfully');
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    window.forceStartByAdmin = async () => {
        if (!confirm('是否要强制开启游戏？')) return;

        try {
            const response = await fetch('/api/admin/force-start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('强制开始失败，房间状态可能不正确');
            console.log('Game force started successfully');
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    window.toggleRoomLockByAdmin = async () => {
        if (!confirm('你确定要锁定/解锁此房间吗？')) return;

        try {
            const response = await fetch('/api/admin/toggle-lock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('切换锁定状态失败');
            console.log('Room lock toggled successfully');
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    window.setMaxPlayersByAdmin = async () => {
        const countStr = prompt('请输入房间最大人数：');
        if (!countStr || !countStr.trim()) return;
        const maxPlayers = parseInt(countStr.trim(), 10);
        if (isNaN(maxPlayers) || maxPlayers <= 0) {
            alert('请输入有效的正整数');
            return;
        }

        try {
            const response = await fetch('/api/admin/set-max-players', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, maxPlayers })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('修改失败');
            console.log('Max players updated successfully');
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    window.closeRoomByAdmin = async () => {
        if (!confirm('确定要强制关闭房间吗？')) return;

        try {
            const response = await fetch('/api/admin/close-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('关闭失败');
            console.log('Room closed successfully');
            window.location.href = '/'; // Redirect to home since room is gone
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    window.toggleRoomModeByAdmin = async () => {
        if (!confirm('确定要更改房间的模式吗？')) return;

        try {
            const response = await fetch('/api/admin/toggle-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('更改模式失败');
            console.log('Room mode toggled successfully');
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    window.manageBlacklistByAdmin = async () => {
        try {
            // 1. Fetch current blacklist
            const getResp = await fetch(`/api/admin/room-blacklist?roomId=${roomId}`);
            const getData = await getResp.json();
            const currentList = getData.blacklist || [];

            // 2. Show prompt
            const input = prompt('房间黑名单 (用户ID，英文逗号隔开)：', currentList.join(','));
            if (input === null) return; // Cancelled

            // 3. Parse and Save
            const userIds = input.split(',')
                .map(id => parseInt(id.trim(), 10))
                .filter(id => !isNaN(id));

            const saveResp = await fetch('/api/admin/set-room-blacklist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, userIds })
            });
            const result = await saveResp.json();
            if (!saveResp.ok || !result.success) throw new Error('保存失败');
            
            console.log('Blacklist updated successfully');
            // Re-fetch room details to see if anyone was kicked
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId } }));
            }
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    window.manageWhitelistByAdmin = async () => {
        try {
            // 1. Fetch current whitelist
            const getResp = await fetch(`/api/admin/room-whitelist?roomId=${roomId}`);
            const getData = await getResp.json();
            const currentList = getData.whitelist || [];

            // 2. Show prompt
            const input = prompt('房间白名单 (用户ID，英文逗号隔开)：', currentList.join(','));
            if (input === null) return; // Cancelled

            // 3. Parse and Save
            const userIds = input.split(',')
                .map(id => parseInt(id.trim(), 10))
                .filter(id => !isNaN(id));

            const saveResp = await fetch('/api/admin/set-room-whitelist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, userIds })
            });
            const result = await saveResp.json();
            if (!saveResp.ok || !result.success) throw new Error('保存失败');
            
            console.log('Whitelist updated successfully');
            // Re-fetch room details to see if anyone was kicked
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'getRoomDetails', payload: { roomId } }));
            }
        } catch (error) {
            alert('操作失败: ' + error.message);
        }
    };

    if (!roomId) {
        roomName.textContent = 'Error: No Room ID specified';
        return;
    }

    // Add Admin Check
    async function checkAdminStatus() {
        try {
            const response = await fetch('/check-auth');
            const data = await response.json();
            isAdmin = data.isAdmin;
            console.log('Admin status:', isAdmin);
        } catch (error) {
            console.error('Failed to check admin status:', error);
            isAdmin = false;
        }
        updateTotalPlayers(currentTotalPlayers);
        // Refresh UI with new admin status if data is already present
        if (lastDetails) {
            renderRoomDetails(lastDetails);
        }
    }

    // Add Update Logic
    function updateTotalPlayers(count) {
        currentTotalPlayers = count;
        const content = `<strong>Total Players Online:</strong> ${count}`;
        if (isAdmin) {
            totalPlayersDiv.innerHTML = `<a href="/players.html">${content}</a><a href="/logout" class="logout-icon" title="Logout">&#10145;&#65039;</a>`;
        } else {
            totalPlayersDiv.innerHTML = content;
        }
    }

    function connectWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}`;

        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connection established for room details');
            connectionStatus.textContent = 'Connected';
            connectionStatus.className = 'connection-status connected';
            checkAdminStatus(); // Check admin on connect

            // Request details for the specific room
            const message = {
                type: 'getRoomDetails',
                payload: { roomId: roomId }
            };
            socket.send(JSON.stringify(message));
        };

        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'roomDetails') {
                    console.log('Received room details:', message.payload);
                    renderRoomDetails(message.payload);
                }
                // Handle serverStats
                if (message.type === 'serverStats') {
                    updateTotalPlayers(message.payload.totalPlayers);
                }
                // The main list update can also trigger a re-fetch for simplicity
                if (message.type === 'roomList') {
                     const message = {
                        type: 'getRoomDetails',
                        payload: { roomId: roomId }
                    };
                    socket.send(JSON.stringify(message));
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

    function renderRoomDetails(details) {
        lastDetails = details;
        if (!details) {
            roomName.textContent = `Error: Room "${roomId}" not found`;
            roomDetails.innerHTML = '';
            return;
        }
        
        // Sync Other Rooms data without reshuffling if possible
        if (details.otherRooms) {
            const newRoomIds = new Set(details.otherRooms.map(r => r.id));
            const currentIds = new Set(currentOtherRooms.map(r => r.id));
            
            // If sets are different, we must update
            let needsUpdate = newRoomIds.size !== currentIds.size;
            if (!needsUpdate) {
                for (let id of newRoomIds) if (!currentIds.has(id)) needsUpdate = true;
            }
            
            if (needsUpdate || currentOtherRooms.length === 0) {
                currentOtherRooms = [...details.otherRooms];
                // Initial shuffle
                for (let i = currentOtherRooms.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [currentOtherRooms[i], currentOtherRooms[j]] = [currentOtherRooms[j], currentOtherRooms[i]];
                }
            } else {
                // Update properties of existing rooms in currentOtherRooms (e.g. player count)
                currentOtherRooms = currentOtherRooms.map(cr => {
                    const fresh = details.otherRooms.find(r => r.id === cr.id);
                    return fresh || cr; // Should exist because sets match
                });
            }
        }

        roomName.textContent = `Room: ${details.name}`;

        const lockIcon = details.locked ? '&#128274;' : '&#128275;';
        const lockStatusClass = details.locked ? 'locked-status' : 'unlocked-status';

        const chartName = details.selectedChart ? details.selectedChart.name : 'Not selected';
        const chartLevel = details.selectedChart ? details.selectedChart.level : 'N/A';
        const chartLink = details.selectedChart ? `<a href="https://phira.moe/chart/${details.selectedChart.id}" target="_blank">${details.selectedChart.id}</a>` : 'N/A';
        
        // Extended chart info if available (assuming backend passes it through)
        const chartDifficulty = details.selectedChart?.difficulty ?? 'N/A';
        const chartCharter = details.selectedChart?.charter ?? 'N/A';
        const chartComposer = details.selectedChart?.composer ?? 'N/A';
        const chartFile = details.selectedChart?.file;
        const chartIllustrationUrl = details.selectedChart?.illustration;
        const uploader = details.selectedChart?.uploaderInfo;

        // Rating Logic
        const ratingVal = details.selectedChart?.rating ?? 0;
        const ratingCount = details.selectedChart?.ratingCount ?? 0;
        // Convert 0-1 scale to 0-5 scale
        const ratingNum = ratingVal * 5;
        const ratingDisplay = ratingNum.toFixed(2);
        
        // Generate stars based on decimals
        const wholeStars = Math.floor(ratingNum);
        const decimalPart = ratingNum - wholeStars;
        const firstDecimalDigit = Math.floor(decimalPart * 10);

        let starsHtml = '';
        for (let i = 1; i <= 5; i++) {
            if (i <= wholeStars) {
                // Fully filled star
                starsHtml += '<span class="star-filled">&#9733;</span>';
            } else if (i === wholeStars + 1) {
                // Fractional star based on the first decimal digit
                if (firstDecimalDigit > 8) {
                    starsHtml += '<span class="star-filled">&#9733;</span>';
                } else if (firstDecimalDigit > 4) {
                    starsHtml += '<span class="star-half">&#9733;</span>';
                } else {
                    starsHtml += '<span class="star-empty">&#9733;</span>';
                }
            } else {
                // Empty star
                starsHtml += '<span class="star-empty">&#9733;</span>';
            }
        }

        const chartInfoHtml = `
            <div class="chart-container">
                ${details.selectedChart && chartIllustrationUrl ? `
                    <div class="chart-illustration">
                        <a href="https://phira.moe/chart/${details.selectedChart.id}" target="_blank">
                            <img src="${chartIllustrationUrl}" alt="Illustration">
                        </a>
                    </div>` : '<div class="chart-illustration" style="background:#eee; height:200px; display:flex; align-items:center; justify-content:center; color:#999; border-radius:8px;">No Illustration</div>'}
                <div class="chart-details-box">
                    <h4>Chart Info</h4>
                    <p><strong>Name:</strong> ${details.selectedChart ? chartName : 'Not Selected'}</p>
                    <p><strong>ID:</strong> ${details.selectedChart ? details.selectedChart.id : 'N/A'}</p>
                    <p><strong>Level:</strong> ${details.selectedChart ? chartLevel : 'N/A'}</p>
                    <p><strong>Difficulty:</strong> ${details.selectedChart ? chartDifficulty : 'N/A'}</p>
                    <p><strong>Charter:</strong> ${details.selectedChart ? chartCharter : 'N/A'}</p>
                    <p><strong>Composer:</strong> ${details.selectedChart ? chartComposer : 'N/A'}</p>
                    <p><strong>Rating:</strong> <span title="${ratingCount} ratings">${starsHtml} <span style="font-size:0.9em; color:#7f8c8d;">(${ratingDisplay} / 5.00)</span></span></p>
                </div>
                ${chartFile ? `
                    <a href="${chartFile}" class="download-button" target="_blank">
                        &#128229; Download
                    </a>
                ` : `
                    <a href="javascript:void(0)" class="download-button placeholder" onclick="alert('杂鱼~ 你还没有选择任何谱面哦喵！')">
                        &#128229; Download
                    </a>
                `}
            </div>
        `;

        // Other Rooms HTML
        const displayRooms = currentOtherRooms.slice(0, 5);
        const otherRoomsList = displayRooms.length > 0 ? displayRooms.map(r => `
            <a href="room.html?id=${r.id}" class="other-room-item">
                <span class="other-room-id">#${r.id}</span>
                <span class="other-room-name">${r.name}</span>
                <span class="other-room-count">${r.playerCount}/${r.maxPlayers}</span>
            </a>
        `).join('') : '<p style="color:#aaa; font-style:italic; padding:20px; text-align:center;">No other active rooms</p>';

        const otherRoomsHtml = `
            <div class="detail-card">
                <h3>Other Rooms</h3>
                <div class="other-rooms-scroll">
                    <div class="other-rooms-list">
                        ${otherRoomsList}
                    </div>
                </div>
                ${currentOtherRooms.length > 5 ? `
                    <button class="refresh-rooms-btn" onclick="window.refreshOtherRooms()">
                        &#128260; 换一批
                    </button>
                ` : '<div style="height: 40px;"></div>'} 
            </div>
        `;

        const sortedPlayers = [...details.players].sort((a, b) => {
            // 1. Room Owner always first
            if (a.id === details.ownerId) return -1;
            if (b.id === details.ownerId) return 1;

            // 2. Bot always last
            if (a.id === -1) return 1;
            if (b.id === -1) return -1;

            // 3. Priority: Server Owner > Admin > Regular
            const getWeight = (p) => {
                if (p.isOwner) return 2;
                if (p.isAdmin) return 1;
                return 0;
            };

            const weightA = getWeight(a);
            const weightB = getWeight(b);

            if (weightA !== weightB) {
                return weightB - weightA; // Higher weight comes first
            }

            return 0;
        });

        const playersHtml = sortedPlayers.map(p => {
            const isServer = p.id === -1;
            const isOwner = p.id === details.ownerId;
            const profileLink = isServer ? '#' : `https://phira.moe/user/${p.id}`;
            const targetAttr = isServer ? '' : 'target="_blank"';
            
            const readyStatus = p.isReady ? 'Ready' : 'Not Ready';
            const statusClass = isServer ? '' : (p.isReady ? 'status-ready' : 'status-not-ready');
            const statusText = isServer ? 'Bot' : readyStatus;
            
            let nameClass = 'player-name';
            if (isServer) nameClass += ' name-bot';
            else if (isOwner) nameClass += ' name-owner';

            const avatarUrl = p.avatar || 'https://api.phira.cn/files/6ad662de-b505-4725-a7ef-72d65f32b404';

            // Generate Prefix
            let prefixHtml = '';
            if (isServer) {
                prefixHtml = '<span class="name-prefix prefix-bot">[Bot]</span> ';
            } else if (p.isOwner) {
                prefixHtml = '<span class="name-prefix prefix-owner">[Owner]</span> ';
            } else if (p.isAdmin) {
                prefixHtml = '<span class="name-prefix prefix-admin">[Admin]</span> ';
            } else {
                prefixHtml = '<span class="name-prefix prefix-player">[Player]</span> ';
            }

            return `
            <li class="player-item ${isOwner ? 'owner' : ''} ${p.isReady ? 'ready' : ''}">
                <div class="player-info-left">
                    <img src="${avatarUrl}" class="player-avatar-small" alt="Avatar">
                    <a class="${nameClass}" href="${profileLink}" ${targetAttr}>${prefixHtml}${p.name} ${isServer ? '' : `(ID: ${p.id})`}</a>
                </div>
                <span class="player-status ${statusClass}">${statusText}</span>
            </li>
            `;
        }).join('');

        // Find owner name
        const owner = details.players.find(p => p.id === details.ownerId);
        const ownerName = owner ? owner.name : 'Unknown';
        const ownerIdDisplay = owner ? `(ID: ${owner.id})` : '';

        // Handle uploader display more defensively
        const uploaderId = details.selectedChart?.uploader;
        const uploaderInfo = details.selectedChart?.uploaderInfo;
        
        let uploaderHtml = '';
        if (uploaderInfo) {
            uploaderHtml = `
                <div class="detail-card">
                    <h3>Chart Uploader</h3>
                    <div class="uploader-info">
                        <a href="https://phira.moe/user/${uploaderInfo.id}" target="_blank" style="text-decoration:none; color:inherit;">
                            <img src="${uploaderInfo.avatar}" alt="${uploaderInfo.name}" class="uploader-avatar">
                            <div class="uploader-text">
                                <p class="uploader-name">${uploaderInfo.name}</p>
                                <p class="uploader-rks">RKS: ${uploaderInfo.rks.toFixed(2)}</p>
                                <p class="uploader-bio">${uploaderInfo.bio || '作者没有设置简介'}</p>
                                <p class="uploader-id">ID: ${uploaderInfo.id}</p>
                            </div>
                        </a>
                    </div>
                </div>`;
        } else if (uploaderId) {
            uploaderHtml = `
                <div class="detail-card">
                    <h3>Chart Uploader</h3>
                    <div class="uploader-info">
                        <div class="uploader-text">
                            <p class="uploader-name">Unknown User</p>
                            <p class="uploader-id">ID: ${uploaderId}</p>
                        </div>
                    </div>
                </div>`;
        } else {
            // Placeholder for layout consistency
            uploaderHtml = `
                <div class="detail-card">
                    <h3>Chart Uploader</h3>
                    <div class="uploader-info">
                        <div class="uploader-text">
                            <p style="color:#aaa; font-style:italic;">No chart selected</p>
                        </div>
                    </div>
                </div>`;
        }

        // Generate Results Section
        const playersWithScores = details.players.filter(p => p.score);
        
        // Sort by score desc
        playersWithScores.sort((a, b) => b.score.score - a.score.score);
        
        let resultsTitle = 'Game Results';
        let resultsSubtitle = '';

        if (details.lastGameChart && details.selectedChart && details.lastGameChart.id !== details.selectedChart.id) {
             // Only show (Last) if we have moved on to a different chart
             resultsTitle = 'Game Results (Last)';
             resultsSubtitle = `<div style="font-size:0.85em; color:#7f8c8d; margin-bottom:5px;">
                ${details.lastGameChart.name} <span style="color:#aaa;">|</span> 
                ${details.lastGameChart.level || 'Lv.?'} <span style="color:#aaa;">|</span> 
                ID: ${details.lastGameChart.id}
             </div>`;
        }

        const rows = playersWithScores.length > 0 
            ? playersWithScores.map((p, index) => {
                const rank = index + 1;
                let rankClass = '';
                if (rank === 1) rankClass = 'rank-1';
                else if (rank === 2) rankClass = 'rank-2';
                else if (rank === 3) rankClass = 'rank-3';
                
                const accVal = p.score.accuracy;
                const accPercent = (accVal * 100).toFixed(2) + '%';
                let accClass = 'val-red';
                if (accVal >= 1.0) accClass = 'val-gold'; // Exact 100%
                else if (accVal >= 0.95) accClass = 'val-green'; // >= 95%

                const scoreVal = p.score.score;
                let scoreClass = 'score-val';
                if (scoreVal === 1000000) scoreClass += ' val-gold';

                return `
                    <tr>
                        <td class="${rankClass}">#${rank}</td>
                        <td style="text-align: left; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</td>
                        <td class="${scoreClass}">${scoreVal.toLocaleString()}</td>
                        <td class="${accClass}">${accPercent}</td>
                        <td>${p.score.maxCombo}</td>
                        <td style="font-size: 0.8em; color: #7f8c8d;">
                            ${p.score.perfect} / ${p.score.good} / ${p.score.bad} / ${p.score.miss}
                        </td>
                    </tr>
                `;
            }).join('')
            : '<tr><td colspan="6" style="padding: 20px; color: #999; font-style: italic;">No results yet. Finish a game to see scores!</td></tr>';

        const resultsHtml = `
            <div class="detail-card">
                <h3>${resultsTitle}</h3>
                ${resultsSubtitle}
                <div class="results-scroll">
                    <div style="overflow-x: auto;">
                        <table class="results-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th style="text-align: left">Player</th>
                                    <th>Score</th>
                                    <th>Acc</th>
                                    <th>Combo</th>
                                    <th>P/G/B/M</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        // Generate Messages Section (Public Screen)
        const messagesHtml = (details.messages || []).map(m => {
            let content = '';
            let typeClass = 'msg-system';
            
            switch (m.type) {
                case 'Chat':
                    const safeContent = m.content.replace(/\n/g, '<br>');
                    content = `<span class="msg-user">${m.userName}:</span> ${safeContent}`;
                    typeClass = 'msg-chat';
                    break;
                case 'JoinRoom':
                    content = `玩家 ${m.name || m.userName} 加入了房间`;
                    break;
                case 'LeaveRoom':
                    content = `玩家 ${m.name || m.userName} 离开了房间`;
                    break;
                case 'CreateRoom':
                    content = `房间已由 ${m.userName} 创建`;
                    break;
                case 'NewHost':
                    content = `玩家 ${m.userName} 成为了新房主`;
                    break;
                case 'SelectChart':
                    content = `房主选择了谱面: ${m.name} (ID: ${m.id})`;
                    break;
                case 'GameStart':
                    content = `房主发起了游戏开始请求`;
                    break;
                case 'Ready':
                    content = `玩家 ${m.userName} 已准备`;
                    typeClass = 'msg-ready';
                    break;
                case 'CancelReady':
                    content = `玩家 ${m.userName} 取消了准备`;
                    break;
                case 'StartPlaying':
                    content = `游戏开始！`;
                    typeClass = 'msg-playing';
                    break;
                case 'Played':
                    const score = m.score !== undefined && m.score !== null ? m.score.toLocaleString() : '0';
                    const accuracy = m.accuracy !== undefined && m.accuracy !== null ? (m.accuracy * 100).toFixed(2) : '0.00';
                    content = `玩家 ${m.userName} 已完成: ${score} (Acc: ${accuracy}%)`;
                    break;
                case 'Abort':
                    content = `玩家 ${m.userName} 放弃了游玩`;
                    typeClass = 'msg-abort';
                    break;
                case 'GameEnd':
                    content = `游戏结束`;
                    break;
                default:
                    content = `${m.type} event`;
            }
            
            return `<div class="message-item ${typeClass}">${content}</div>`;
        }).join(''); // Show oldest on top, newest on bottom

        const chatBoxHtml = `
            <div class="detail-card">
                <h3>Public Screen</h3>
                <div class="message-container" id="message-scroll-box">
                    ${messagesHtml || '<p style="color:#999; font-style:italic;">No messages yet.</p>'}
                </div>
            </div>
        `;

        // Generate Admin Panel (only if isAdmin)
        let adminPanelHtml = '';
        if (isAdmin) {
            adminPanelHtml = `
                <div class="detail-card admin-panel-card">
                    <h3>Admin Panel</h3>
                    
                    <div class="admin-category">
                        <div class="admin-category-title">General Actions</div>
                        <div class="admin-buttons-grid">
                            <button class="admin-btn action-primary" onclick="window.sendAdminServerMessage()">Server Message</button>
                            <button class="admin-btn action-primary" onclick="window.forceStartByAdmin()">Force Start</button>
                            <button class="admin-btn action-danger" onclick="window.closeRoomByAdmin()">Close Room</button>
                        </div>
                    </div>

                    <div class="admin-category">
                        <div class="admin-category-title">Room Config</div>
                        <div class="admin-buttons-grid">
                            <button class="admin-btn" onclick="window.setMaxPlayersByAdmin()">Max Players</button>
                            <button class="admin-btn" onclick="window.toggleRoomModeByAdmin()">Change Mode</button>
                            <button class="admin-btn" onclick="window.toggleRoomLockByAdmin()">Lock/Unlock Room</button>
                        </div>
                    </div>

                    <div class="admin-category">
                        <div class="admin-category-title">Access Control</div>
                        <div class="admin-buttons-grid">
                            <button class="admin-btn action-warning" onclick="window.kickPlayerByAdmin()">Kick Player</button>
                            <button class="admin-btn" onclick="window.manageBlacklistByAdmin()">BlackList</button>
                            <button class="admin-btn" onclick="window.manageWhitelistByAdmin()">WhiteList</button>
                        </div>
                    </div>
                </div>
            `;
        }

        const roomMode = details.cycle ? '循环模式' : '普通模式';

        roomDetails.innerHTML = `
            <div class="left-sidebar">
                <div class="detail-card">
                    <h3>Room Info</h3>
                    <p><strong>ID:</strong> ${details.id}</p>
                    <p><strong>Mode:</strong> <span style="font-weight:bold; color:#3498db;">${roomMode}</span></p>
                    <p><strong>Host:</strong> <span>${ownerName} ${ownerIdDisplay}</span></p>
                    <p><strong>Players:</strong> ${details.playerCount} / ${details.maxPlayers}</p>
                    <p><strong>Status:</strong> ${details.state.type}</p>
                    <p><strong>Locked:</strong> <span class="${lockStatusClass}">${lockIcon}</span></p>
                </div>
                ${uploaderHtml}
                ${otherRoomsHtml}
            </div>
            <div class="center-column">
                <div class="detail-card">
                    <h3>Player List</h3>
                    <div class="player-list-scroll">
                        <ul class="player-list">
                            ${playersHtml}
                        </ul>
                    </div>
                </div>
                ${resultsHtml}
                ${adminPanelHtml}
            </div>
            <div class="right-sidebar">
                <div class="detail-card">
                    <h3>Chart</h3>
                    ${chartInfoHtml}
                </div>
                ${chatBoxHtml}
            </div>
        `;

        // Scroll chat to bottom
        const scrollBox = document.getElementById('message-scroll-box');
        if (scrollBox) {
            scrollBox.scrollTop = scrollBox.scrollHeight;
        }
    }

    connectWebSocket();
});

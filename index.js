(function () {
    let isSearching = false;
    let cancelSearch = false;

    function getSTContext() {
        return window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;
    }

    function getHeaders() {
        const ctx = getSTContext();
        if (ctx && typeof ctx.getRequestHeaders === 'function') {
            return ctx.getRequestHeaders();
        }
        return { 'Content-Type': 'application/json' };
    }

    // 1. Khởi tạo Nút nổi (Floating Button) & Hộp thoại tìm kiếm
    function createUI() {
        if (document.getElementById('gcs-floating-btn')) return;

        // Tạo nút nổi
        const floatBtn = document.createElement('div');
        floatBtn.id = 'gcs-floating-btn';
        floatBtn.title = 'Tìm kiếm toàn bộ Chat (Kéo để di chuyển / Alt+F)';
        floatBtn.innerHTML = '🔍'; // Dùng cả emoji phòng khi FontAwesome bị đổi
        document.body.appendChild(floatBtn);

        // Khôi phục vị trí đã lưu (nếu có)
        const savedPos = localStorage.getItem('gcs_float_pos');
        if (savedPos) {
            try {
                const { left, top } = JSON.parse(savedPos);
                if (typeof left === 'number' && typeof top === 'number') {
                    floatBtn.style.left = Math.min(Math.max(0, left), window.innerWidth - 50) + 'px';
                    floatBtn.style.top = Math.min(Math.max(0, top), window.innerHeight - 50) + 'px';
                    floatBtn.style.right = 'auto';
                    floatBtn.style.bottom = 'auto';
                }
            } catch (e) {}
        }

        // Gắn tính năng kéo thả + click mở Modal
        makeDraggable(floatBtn, () => {
            openSearchModal();
        });

        // Tạo khung Modal
        const modalHtml = `
            <div id="gcs-modal">
                <div class="gcs-modal-content">
                    <div class="gcs-header">
                        <h3>🔍 Tìm kiếm toàn bộ lịch sử Chat</h3>
                        <span class="gcs-close" id="gcs-close-btn">×</span>
                    </div>
                    <div class="gcs-search-bar">
                        <input type="text" id="gcs-input" placeholder="Nhập từ khóa cần tìm (nhấn Enter)..." />
                        <button id="gcs-search-btn" class="menu_button">Tìm</button>
                        <button id="gcs-stop-btn" class="menu_button" style="display:none; background:#a33;">Dừng</button>
                    </div>
                    <div class="gcs-status" id="gcs-status">Sẵn sàng.</div>
                    <div class="gcs-results" id="gcs-results"></div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        document.getElementById('gcs-close-btn').addEventListener('click', () => {
            document.getElementById('gcs-modal').style.display = 'none';
        });

        // Bấm ra ngoài vùng đen để đóng
        document.getElementById('gcs-modal').addEventListener('click', (e) => {
            if (e.target.id === 'gcs-modal') {
                document.getElementById('gcs-modal').style.display = 'none';
            }
        });

        document.getElementById('gcs-search-btn').addEventListener('click', executeGlobalSearch);
        document.getElementById('gcs-stop-btn').addEventListener('click', () => { cancelSearch = true; });
        document.getElementById('gcs-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !isSearching) executeGlobalSearch();
        });

        // Phím tắt Alt + F để bật nhanh trên máy tính
        window.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'f' || e.key === 'F')) {
                e.preventDefault();
                openSearchModal();
            }
        });
    }

    function openSearchModal() {
        const modal = document.getElementById('gcs-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        setTimeout(() => document.getElementById('gcs-input')?.focus(), 50);
    }

    // Xử lý kéo thả mượt trên cả chuột (PC) và chạm (Mobile)
    function makeDraggable(el, onClickCallback) {
        let isDragging = false;
        let hasMoved = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        function onStart(clientX, clientY) {
            isDragging = true;
            hasMoved = false;
            startX = clientX;
            startY = clientY;
            const rect = el.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
        }

        function onMove(clientX, clientY) {
            if (!isDragging) return;
            const dx = clientX - startX;
            const dy = clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                hasMoved = true;
            }
            if (hasMoved) {
                const newLeft = Math.min(Math.max(0, initialLeft + dx), window.innerWidth - el.offsetWidth);
                const newTop = Math.min(Math.max(0, initialTop + dy), window.innerHeight - el.offsetHeight);
                el.style.left = newLeft + 'px';
                el.style.top = newTop + 'px';
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        }

        function onEnd() {
            if (!isDragging) return;
            isDragging = false;
            if (hasMoved) {
                const rect = el.getBoundingClientRect();
                localStorage.setItem('gcs_float_pos', JSON.stringify({ left: rect.left, top: rect.top }));
            } else {
                onClickCallback();
            }
        }

        // Sự kiện chuột
        el.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            onStart(e.clientX, e.clientY);
        });
        window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
        window.addEventListener('mouseup', onEnd);

        // Sự kiện cảm ứng điện thoại
        el.addEventListener('touchstart', e => {
            if (e.touches.length === 1) {
                onStart(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });
        window.addEventListener('touchmove', e => {
            if (isDragging && e.touches.length === 1) {
                onMove(e.touches[0].clientX, e.touches[0].clientY);
            }
        }, { passive: true });
        window.addEventListener('touchend', onEnd);
    }

    // 2. Các hàm gọi API lấy danh sách và nội dung chat
    async function fetchCharacterChatList(avatarUrl) {
        const res = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl })
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : Object.values(data);
    }

    async function fetchChatMessages(chName, fileName, avatarUrl) {
        const cleanFileName = fileName.replace(/\.jsonl$/i, '');
        const res = await fetch('/api/chats/get', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                ch_name: chName,
                file_name: cleanFileName,
                avatar_url: avatarUrl
            })
        });
        if (!res.ok) return [];
        return await res.json();
    }

    // 3. Xử lý chuỗi & tô sáng từ khóa
    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[m]));
    }

    function escapeRegExp(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buildHighlightedSnippet(text, query) {
        const lowerText = text.toLowerCase();
        const idx = lowerText.indexOf(query.toLowerCase());
        if (idx === -1) return escapeHtml(text.slice(0, 150));

        const start = Math.max(0, idx - 50);
        const end = Math.min(text.length, idx + query.length + 70);
        let snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');

        const safeSnippet = escapeHtml(snippet);
        const safeQuery = escapeHtml(query);
        const regex = new RegExp(`(${escapeRegExp(safeQuery)})`, 'gi');
        return safeSnippet.replace(regex, '<span class="gcs-highlight">$1</span>');
    }

    // 4. Thực thi tìm kiếm trên toàn bộ nhân vật
    async function executeGlobalSearch() {
        if (isSearching) return;
        const query = document.getElementById('gcs-input').value.trim();
        if (!query) return;

        const context = getSTContext();
        if (!context) {
            alert('Chưa tải xong dữ liệu từ SillyTavern, vui lòng thử lại sau vài giây!');
            return;
        }

        isSearching = true;
        cancelSearch = false;
        document.getElementById('gcs-search-btn').style.display = 'none';
        document.getElementById('gcs-stop-btn').style.display = 'inline-block';

        const statusEl = document.getElementById('gcs-status');
        const resultsEl = document.getElementById('gcs-results');
        resultsEl.innerHTML = '';

        const characters = context.characters || [];
        let matchCount = 0;

        try {
            for (let charId = 0; charId < characters.length; charId++) {
                if (cancelSearch) break;
                const char = characters[charId];
                statusEl.textContent = `Đang quét (${charId + 1}/${characters.length}): ${char.name}... (Thấy: ${matchCount})`;

                const chatFiles = await fetchCharacterChatList(char.avatar);
                if (!Array.isArray(chatFiles)) continue;

                for (const fileObj of chatFiles) {
                    if (cancelSearch) break;
                    const fileName = typeof fileObj === 'string' ? fileObj : fileObj.file_name;
                    if (!fileName) continue;

                    const messages = await fetchChatMessages(char.name, fileName, char.avatar);
                    if (!Array.isArray(messages)) continue;

                    const startIndex = (messages.length > 0 && messages[0].chat_metadata !== undefined) ? 1 : 0;

                    for (let i = startIndex; i < messages.length; i++) {
                        const msg = messages[i];
                        if (!msg || typeof msg.mes !== 'string') continue;

                        if (msg.mes.toLowerCase().includes(query.toLowerCase())) {
                            const mesId = i - startIndex;
                            matchCount++;
                            appendResultItem({
                                charId,
                                charName: char.name,
                                fileName: fileName.replace(/\.jsonl$/i, ''),
                                mesId,
                                sender: msg.name || (msg.is_user ? 'Bạn' : char.name),
                                snippet: buildHighlightedSnippet(msg.mes, query)
                            });
                        }
                    }
                }
            }
            statusEl.textContent = cancelSearch
                ? `Đã dừng. Tìm thấy ${matchCount} kết quả.`
                : `Hoàn tất! Tìm thấy ${matchCount} kết quả cho "${query}".`;
        } catch (err) {
            console.error('[Global Chat Search] Lỗi:', err);
            statusEl.textContent = `Lỗi: ${err.message}`;
        } finally {
            isSearching = false;
            document.getElementById('gcs-search-btn').style.display = 'inline-block';
            document.getElementById('gcs-stop-btn').style.display = 'none';
        }
    }

    function appendResultItem(item) {
        const resultsEl = document.getElementById('gcs-results');
        const div = document.createElement('div');
        div.className = 'gcs-result-item';
        div.innerHTML = `
            <div class="gcs-result-meta">
                <span>👤 ${escapeHtml(item.charName)} — 📄 ${escapeHtml(item.fileName)}</span>
                <span>#${item.mesId} (${escapeHtml(item.sender)})</span>
            </div>
            <div class="gcs-result-snippet">${item.snippet}</div>
        `;
        div.addEventListener('click', () => navigateToMessage(item.charId, item.fileName, item.mesId));
        resultsEl.appendChild(div);
    }

    // 5. Chuyển nhân vật, mở file chat và cuộn tới đúng tin nhắn
    async function navigateToMessage(charId, fileName, mesId) {
        const statusEl = document.getElementById('gcs-status');
        statusEl.textContent = `Đang chuyển tới "${fileName}" (Tin nhắn #${mesId})...`;

        try {
            const context = getSTContext();

            // Bước 1: Chuyển sang nhân vật
            if (String(context.characterId) !== String(charId)) {
                if (typeof context.selectCharacterById === 'function') {
                    await context.selectCharacterById(String(charId));
                } else {
                    const scriptMod = await import('/script.js');
                    if (scriptMod && typeof scriptMod.selectCharacterById === 'function') {
                        await scriptMod.selectCharacterById(String(charId));
                    }
                }
            }

            // Bước 2: Mở file chat tương ứng
            const updatedContext = getSTContext();
            const currentChat = updatedContext.characters[charId]?.chat?.replace(/\.jsonl$/i, '');
            if (currentChat !== fileName) {
                if (typeof updatedContext.openCharacterChat === 'function') {
                    await updatedContext.openCharacterChat(fileName);
                } else {
                    const scriptMod = await import('/script.js');
                    if (scriptMod && typeof scriptMod.openCharacterChat === 'function') {
                        await scriptMod.openCharacterChat(fileName);
                    }
                }
            }

            document.getElementById('gcs-modal').style.display = 'none';
            await scrollToMesId(mesId);
        } catch (err) {
            console.error('[Global Chat Search] Lỗi điều hướng:', err);
            if (window.toastr) toastr.error('Không thể chuyển tới tin nhắn này.');
        }
    }

    async function scrollToMesId(mesId) {
        await new Promise(r => setTimeout(r, 500));

        let targetEl = document.querySelector(`.mes[mesid="${mesId}"]`);
        let safetyLimit = 60;

        while (!targetEl && safetyLimit > 0) {
            const showMoreBtn = document.getElementById('show_more_messages');
            if (showMoreBtn && showMoreBtn.offsetParent !== null) {
                showMoreBtn.click();
                await new Promise(r => setTimeout(r, 150));
                targetEl = document.querySelector(`.mes[mesid="${mesId}"]`);
                safetyLimit--;
            } else {
                break;
            }
        }

        if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetEl.classList.add('gcs-target-mes');
            setTimeout(() => targetEl.classList.remove('gcs-target-mes'), 3000);
        } else if (window.toastr) {
            toastr.warning(`Đã mở file chat nhưng không tìm thấy tin nhắn #${mesId}.`);
        }
    }

    // Khởi chạy ngay khi DOM sẵn sàng và tự phục hồi nếu nút bị xóa
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createUI);
    } else {
        createUI();
    }
    setInterval(createUI, 2000);
})();

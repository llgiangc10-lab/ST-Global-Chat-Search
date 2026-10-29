// Không dùng import đường dẫn tương đối để tránh lỗi lệch thư mục third-party
const EXTENSION_NAME = 'Global Chat Search';
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

// 1. Tạo giao diện Modal và nút bấm
function createUI() {
    if (!document.getElementById('gcs-modal')) {
        const modalHtml = `
            <div id="gcs-modal">
                <div class="gcs-modal-content">
                    <div class="gcs-header">
                        <h3><i class="fa-solid fa-magnifying-glass"></i> Tìm kiếm toàn bộ lịch sử Chat</h3>
                        <span class="gcs-close" id="gcs-close-btn">×</span>
                    </div>
                    <div class="gcs-search-bar">
                        <input type="text" id="gcs-input" placeholder="Nhập từ khóa cần tìm (nhấn Enter)..." />
                        <button id="gcs-search-btn" class="menu_button">Tìm kiếm</button>
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

        document.getElementById('gcs-search-btn').addEventListener('click', executeGlobalSearch);
        document.getElementById('gcs-stop-btn').addEventListener('click', () => { cancelSearch = true; });
        document.getElementById('gcs-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !isSearching) executeGlobalSearch();
        });
    }

    injectMenuButton();
}

function injectMenuButton() {
    if (document.getElementById('gcs-open-menu-btn')) return true;

    const extMenu = document.getElementById('extensionsMenu');
    if (!extMenu) return false;

    const menuItem = document.createElement('div');
    menuItem.className = 'list-group-item flex-container flexGap5 interactable';
    menuItem.id = 'gcs-open-menu-btn';
    menuItem.tabIndex = 0;
    menuItem.innerHTML = `<div class="fa-solid fa-magnifying-glass extensionsMenuExtensionButton"></div><span>Tìm kiếm toàn bộ Chat</span>`;
    menuItem.addEventListener('click', () => {
        document.getElementById('gcs-modal').style.display = 'flex';
        document.getElementById('gcs-input').focus();
    });

    extMenu.appendChild(menuItem);
    return true;
}

// 2. Lấy danh sách file chat & nội dung tin nhắn
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

// 3. Xử lý chuỗi và tô sáng từ khóa
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

// 4. Thực thi tìm kiếm
async function executeGlobalSearch() {
    if (isSearching) return;
    const query = document.getElementById('gcs-input').value.trim();
    if (!query) return;

    const context = getSTContext();
    if (!context) {
        alert('Không lấy được Context của SillyTavern!');
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
            statusEl.textContent = `Đang quét nhân vật (${charId + 1}/${characters.length}): ${char.name}... (Đã thấy: ${matchCount})`;

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
            <span><i class="fa-solid fa-user"></i> ${escapeHtml(item.charName)} — <i class="fa-regular fa-file-lines"></i> ${escapeHtml(item.fileName)}</span>
            <span>#${item.mesId} (${escapeHtml(item.sender)})</span>
        </div>
        <div class="gcs-result-snippet">${item.snippet}</div>
    `;
    div.addEventListener('click', () => navigateToMessage(item.charId, item.fileName, item.mesId));
    resultsEl.appendChild(div);
}

// 5. Điều hướng tới nhân vật, mở file chat và cuộn tới tin nhắn
async function navigateToMessage(charId, fileName, mesId) {
    const statusEl = document.getElementById('gcs-status');
    statusEl.textContent = `Đang mở "${fileName}" (Tin nhắn #${mesId})...`;

    try {
        const context = getSTContext();

        // Chuyển nhân vật nếu khác nhân vật hiện tại
        if (String(context.characterId) !== String(charId)) {
            if (typeof context.selectCharacterById === 'function') {
                await context.selectCharacterById(String(charId));
            } else {
                // Fallback click vào thẻ nhân vật
                const charBlock = document.querySelector(`.character_select[chid="${charId}"]`);
                if (charBlock) charBlock.click();
                await new Promise(r => setTimeout(r, 800));
            }
        }

        // Mở file chat nếu chưa đúng file
        const updatedContext = getSTContext();
        const currentChat = updatedContext.characters[charId]?.chat?.replace(/\.jsonl$/i, '');
        if (currentChat !== fileName) {
            // Gọi hàm openCharacterChat từ module hoặc context
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

// Khởi tạo an toàn và tự động gắn nút nếu menu load trễ
jQuery(() => {
    createUI();
    const checkInterval = setInterval(() => {
        if (injectMenuButton()) {
            clearInterval(checkInterval);
        }
    }, 1000);
});

/**
 * Deepseek Cache Optimizer for SillyTavern 1.17.0
 * 透過原生 Interceptor API 強制對齊上下文陣列，實現 Deepseek V4 Pro 的極致緩存命中。
 */

let isEnabled = true;
let isFreezeEnabled = true;
let chunkSize = 10;
let frozenSystemContent = null;
let lastChatId = null;

// --- 介面日誌排錯函數 ---
function logDebug(message) {
    console.log(`[DeepseekOptimizer] ${message}`);
    const logArea = document.getElementById('ds_opt_logs');
    if (logArea) {
        const time = new Date().toLocaleTimeString();
        logArea.value += `[${time}] ${message}\n`;
        logArea.scrollTop = logArea.scrollHeight;
    }
}

// --- 核心原生攔截器 (SillyTavern Interceptor API) ---
// SillyTavern 會在每次發送 API 請求前，將對話陣列(chat)傳入此全域函數
globalThis.DeepseekOptimizer_interceptGeneration = async function(chat, contextSize, abort, type) {
    if (!isEnabled) return;
    
    // 只干預標準的對話生成 (忽略後台悄悄生成的 quiet prompt 或 impersonate)
    if (type === 'quiet' || type === 'impersonate') {
        logDebug(`[狀態] 忽略非標準生成類型: ${type}，不進行緩存對齊。`);
        return;
    }

    logDebug(`\n>>> [啟動] 觸發原生攔截器 (生成類型: ${type})，開始重組 Payload...`);

    const context = SillyTavern.getContext();
    const currentChatId = context.chatId;

    // 1. 偵測切換聊天對象
    if (lastChatId !== currentChatId) {
        logDebug(`[狀態] 偵測到聊天室切換，重置系統提示凍結快取。`);
        lastChatId = currentChatId;
        frozenSystemContent = null;
    }

    let sysMessages = [];
    let historyMessages = [];
    let tailMessages = [];
    let lastUserMsg = null;

    // 2. 取出最新的用戶訊息 (這條始終在最底下，不影響上方歷史緩存)
    if (chat.length > 0 && chat[chat.length - 1].role === 'user') {
        lastUserMsg = chat.pop();
    }

    // 3. 將訊息分類：頂部系統提示、中間動態設定、歷史對話
    for (let i = 0; i < chat.length; i++) {
        let msg = chat[i];
        if (msg.role === 'system') {
            if (historyMessages.length === 0) {
                // 第一條為頂部主系統提示 (包含世界觀、角色卡)
                sysMessages.push(msg);
            } else {
                // 出現在歷史之後的系統提示 (通常是觸發了不同深度的 World Info 或 Author's Note)
                tailMessages.push(msg);
            }
        } else {
            // 對話歷史
            historyMessages.push(msg);
        }
    }

    // 4. [緩存防護 1] 系統提示凍結 (System Prompt Freezing)
    // 解決預設提示詞中含有 {{time}} 或其他每回合跳動的巨集
    if (isFreezeEnabled && sysMessages.length > 0) {
        let mainSys = sysMessages[0];
        if (!frozenSystemContent) {
            frozenSystemContent = mainSys.content;
            logDebug("[緩存建構] 建立初代凍結系統提示 (Frozen System Prompt)。");
        } else {
            // 透過字元差異判斷是使用者修改了設定，還是單純的時間巨集跳動
            let diff = Math.abs(mainSys.content.length - frozenSystemContent.length);
            if (diff > 0 && diff <= 50) {
                logDebug(`[緩存守護] 偵測到主提示詞微小變化 (差異 ${diff} 字元，疑似 {{time}} 跳動)。已強制還原為凍結版本以維持 Prefix！`);
                mainSys.content = frozenSystemContent;
            } else if (diff > 50) {
                logDebug(`[緩存重建] 偵測到主提示詞顯著修改 (差異 ${diff} 字元)，已更新凍結快取，本回合重新計算 Prefix。`);
                frozenSystemContent = mainSys.content;
            }
        }
    }

    if (tailMessages.length > 0) {
        logDebug(`[動態隔離] 偵測到 ${tailMessages.length} 條觸發的動態系統設定 (World Info)。強制下移至尾部，避免破壞上方巨量歷史緩存！`);
    }

    // 5. [緩存防護 2] 絕對錨點截斷算法 (Absolute Anchor Chunking)
    // 解決 ST 內建 Sliding Window 每次吞噬 1 條最舊訊息導致開頭跳動的問題
    const totalChatLength = context.chat ? context.chat.length : 0;
    const M = historyMessages.length; // ST 當前截斷後保留的歷史訊息數
    
    if (M > 0 && chunkSize > 1 && totalChatLength > 0) {
        // startIdx 是當前歷史訊息在完整對話中的虛擬起始索引
        let startIdx = totalChatLength - M;
        // 向上對齊至 chunkSize 的倍數 (例如 10)
        let anchorIdx = Math.ceil(startIdx / chunkSize) * chunkSize;
        let dropCount = anchorIdx - startIdx;
        
        if (dropCount > 0 && dropCount < M) {
            logDebug(`[錨點對齊] 原截斷點為 ${startIdx}。為對齊區塊 ${chunkSize}，自動剔除最舊的 ${dropCount} 條訊息。歷史起點穩定於 ${anchorIdx}，未來數回合前綴將絕對靜止 100% 命中！`);
            historyMessages = historyMessages.slice(dropCount);
        } else {
            logDebug(`[錨點對齊] 當前截斷點 ${startIdx} 已完美對齊區塊，前綴 100% 命中準備就緒。`);
        }
    }

    // 6. 重組 Chat 陣列 (In-place 修改原陣列)
    chat.length = 0; // 清空 ST 原本的陣列
    chat.push(...sysMessages, ...historyMessages, ...tailMessages);
    if (lastUserMsg) {
        chat.push(lastUserMsg); // 確保最新發話在最下面
    }
    
    logDebug(`<<< [完成] Payload 重組完畢。當前發送總訊息數: ${chat.length}\n`);
};

// --- 介面綁定與 ST 設定一鍵覆蓋 ---
jQuery(() => {
    const uiHtml = `
    <style>
        #deepseek_optimizer_panel { padding: 15px; background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.5)); border-radius: 8px; border: 1px solid var(--SmartThemeBorderColor, #444); margin-bottom: 10px; color: var(--SmartThemeBodyColor); }
        #deepseek_optimizer_panel h3 { margin-top: 0; margin-bottom: 10px; }
        #ds_opt_logs { width: 100%; height: 180px; background: #1e1e1e; color: #4af626; font-family: monospace; font-size: 12px; padding: 8px; border: 1px solid #444; border-radius: 4px; resize: vertical; margin-top: 10px; }
        .ds-hr { margin: 15px 0; border-color: #555; }
        .ds-opt-btn { background: var(--SmartThemeButtonBackgroundColor, #333); color: var(--SmartThemeButtonTextColor, #fff); border: 1px solid var(--SmartThemeButtonBorderColor, #555); padding: 8px 12px; border-radius: 4px; cursor: pointer; margin-top: 10px; font-weight: bold;}
        .ds-opt-btn:hover { background: var(--SmartThemeButtonHoverColor, #444); }
    </style>
    <div id="deepseek_optimizer_panel">
        <h3>🧠 Deepseek Cache Optimizer</h3>
        <p>專為 Deepseek V4 Pro 設計，解決滑動視窗截斷、World Info 插入、動態時間巨集(如{{time}})等破壞 Prefix Cache 的因素。</p>
        <label><input type="checkbox" id="ds_opt_enable" checked> 啟用緩存最佳化攔截器 (Enable Optimizer)</label><br><br>
        <label>歷史訊息對齊區塊 (Chunk Size): <input type="number" id="ds_opt_chunk_size" value="10" min="1" max="100" style="width: 60px;"></label>
        <p><small>以設定數值為單位「階段性」丟棄舊訊息，使開頭在前綴極為穩定。建議設為 10。</small></p>
        <label><input type="checkbox" id="ds_opt_freeze" checked> 自動凍結系統提示詞 (Freeze System Prompt)</label>
        <p><small>將動態巨集（長度差異小於 50 字元）凍結在初次狀態，保護最大區塊的角色卡緩存不被破壞。</small></p>
        <hr class="ds-hr">
        <button id="ds_opt_apply_settings" class="ds-opt-btn">⚙️ 一鍵最佳化 ST 本地設定</button>
        <p><small>這會修改 ST 面板設定：強制將 World Info 作為獨立系統訊息，並將其深度與 Author's Note 的深度推至最底部(1)，不干擾前綴。</small></p>
        <hr class="ds-hr">
        <h4>即時排錯日誌 (Debug Logs)</h4>
        <textarea id="ds_opt_logs" readonly></textarea>
    </div>`;

    // 注入至 ST 擴展設定面板
    $('#extensions_settings').append(uiHtml);

    // 綁定 UI 互動事件
    $('#ds_opt_enable').on('change', function() {
        isEnabled = $(this).is(':checked');
        logDebug(`攔截器狀態切換: ${isEnabled ? '啟用' : '停用'}`);
    });
    
    $('#ds_opt_freeze').on('change', function() {
        isFreezeEnabled = $(this).is(':checked');
        logDebug(`系統提示詞凍結狀態: ${isFreezeEnabled ? '啟用' : '停用'}`);
        if (!isFreezeEnabled) frozenSystemContent = null;
    });

    $('#ds_opt_chunk_size').on('change', function() {
        chunkSize = parseInt($(this).val(), 10) || 10;
        logDebug(`錨點區塊截斷大小已更新為: ${chunkSize}`);
    });

    $('#ds_opt_apply_settings').on('click', function() {
        logDebug("--- 執行 ST 原生設定一鍵最佳化 ---");
        
        // 1. 強制 World Info 發送為獨立 System
        const wiAsSystem = document.getElementById('world_info_system');
        if (wiAsSystem && !wiAsSystem.checked) {
            $(wiAsSystem).prop('checked', true).trigger('change');
            logDebug("[修正] World Info 已勾選「Send as System」");
        }

        // 2. 將 World Info 深度強制設置為底端 (1)
        const wiDepth = document.getElementById('world_info_depth');
        if (wiDepth) {
            wiDepth.value = 1;
            $(wiDepth).trigger('input').trigger('change');
            logDebug("[修正] World Info 插入深度已強制設為 1");
        }

        // 3. 將作者筆記 (Author's Note) 深度強制設置為底端 (1)
        const anDepth = document.getElementById('authors_note_depth');
        if (anDepth) {
            anDepth.value = 1;
            $(anDepth).trigger('input').trigger('change');
            logDebug("[修正] Author's Note 插入深度已強制設為 1");
        }

        logDebug("[建議] 你現已不須手動刪除預設提示詞的 {{time}} 巨集，插件已為您開啟凍結防護。");
    });
    
    logDebug("Deepseek Cache Optimizer 載入成功。");
});

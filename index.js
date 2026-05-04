/**
 * Deepseek Cache Optimizer v4.0.0 (Total Override)
 * 絕對暴力攔截：解析最終封包字串強制排序 + 劫持 ST 原生查看按鈕，徹底消滅不同步現象。
 */

let isEnabled = true;
let isFreezeEnabled = true;
let chunkSize = 10;
let frozenSystemContent = null;
let lastChatId = null;

// 將最終優化過的 Payload 存在全域，供 UI 劫持使用
window.DS_Optimized_Payload = null;

// --- 介面日誌排錯函數 ---
function logDebug(message) {
    console.log(`[DS_Optimizer_V4] ${message}`);
    const logArea = document.getElementById('ds_opt_logs');
    if (logArea) {
        const time = new Date().toLocaleTimeString();
        logArea.value += `[${time}] ${message}\n`;
        logArea.scrollTop = logArea.scrollHeight;
    }
}

// --- 核心優化排序演算法 ---
function optimizePayload(messages) {
    if (!messages || messages.length === 0) return messages;

    const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    
    // 1. 聊天室切換偵測
    if (context) {
        const currentChatId = context.chatId;
        if (lastChatId !== currentChatId) {
            logDebug(`[狀態] 偵測到聊天室切換，重置系統提示凍結快取。`);
            lastChatId = currentChatId;
            frozenSystemContent = null;
        }
    }

    let sysMessages = [];
    let historyMessages = [];
    let tailMessages = [];

    // 2. 絕對排序分類 (隔離世界書等動態破壞源)
    for (let i = 0; i < messages.length; i++) {
        let msg = messages[i];
        if (i === 0 && msg.role === 'system') {
            sysMessages.push(msg); // 頂部主提示詞
        } else if (msg.role === 'system') {
            tailMessages.push(msg); // 中途插入的世界書(World Info)、作者筆記
        } else {
            historyMessages.push(msg); // 歷史對話 (User/Assistant)
        }
    }

    // 3. 系統提示凍結 (防禦 {{time}} 等時間巨集)
    if (isFreezeEnabled && sysMessages.length > 0) {
        let mainSys = sysMessages[0];
        let contentStr = typeof mainSys.content === 'string' ? mainSys.content : JSON.stringify(mainSys.content);
        
        if (!frozenSystemContent) {
            frozenSystemContent = contentStr;
            logDebug("[緩存建構] 建立初代凍結系統提示 (Prefix Cache 基石)。");
        } else {
            let diff = Math.abs(contentStr.length - frozenSystemContent.length);
            if (diff > 0 && diff <= 50) {
                // 微小跳動強制覆蓋
                mainSys.content = typeof mainSys.content === 'string' ? frozenSystemContent : JSON.parse(frozenSystemContent);
                logDebug(`[緩存守護] 攔截到主提示詞微小跳動 (差異 ${diff} 字元)。已強制還原為凍結版本！`);
            } else if (diff > 50) {
                // 玩家修改角色卡
                frozenSystemContent = contentStr;
                logDebug(`[緩存重建] 主提示詞顯著修改 (差異 ${diff} 字元)，更新凍結快取。`);
            }
        }
    }

    // 4. 抽取最新發話 (保證放在最尾端)
    let lastMsg = null;
    if (historyMessages.length > 0) {
        lastMsg = historyMessages.pop(); 
    }

    // 5. 絕對錨點截斷演算法 (解決滑動視窗造成的開頭跳動)
    let M = historyMessages.length; 
    if (context && context.chat && M > 0 && chunkSize > 1) {
        let UI_Total = context.chat.length;
        // 計算 ST 當前截斷了多少舊訊息
        let startIdx = UI_Total - M;
        if (startIdx < 0) startIdx = 0;

        // 對齊 chunkSize
        let anchorIdx = Math.ceil(startIdx / chunkSize) * chunkSize;
        let dropCount = anchorIdx - startIdx;
        
        if (dropCount > 0 && dropCount < M) {
            logDebug(`[錨點對齊] 當前起點為 ${startIdx}。為對齊區塊，自動剔除最舊 ${dropCount} 條對話。`);
            historyMessages = historyMessages.slice(dropCount);
        } else if (dropCount === 0 || anchorIdx === startIdx) {
            logDebug(`[錨點對齊] 當前截斷點 ${startIdx} 已完美對齊區塊，前綴 100% 命中準備就緒。`);
        }
    }

    if (tailMessages.length > 0) {
        logDebug(`[動態隔離] 成功抽離 ${tailMessages.length} 條世界書/動態設定，已強制下移至尾部！`);
    }

    // 6. 暴力重組順序：主系統卡 -> 穩定歷史對話 -> 世界書(尾部) -> 用戶最新發言
    let optimized = [...sysMessages, ...historyMessages, ...tailMessages];
    if (lastMsg) {
        optimized.push(lastMsg);
    }
    
    return optimized;
}

// --- 暴力網路攔截 (保證 AI 收到修改後的封包) ---
const originalFetch = window.fetch;
window.fetch = async function (...args) {
    const [resource, config] = args;
    
    if (isEnabled && config && config.body && typeof config.body === 'string') {
        let url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
        let isLLM = url.includes('/chat/completions') || url.includes('/api/v1/generate') || url.includes('api.deepseek.com') || url.includes('openrouter.ai') || url.includes('/api/textgeneration');
        
        if (isLLM) {
            try {
                let bodyObj = JSON.parse(config.body);
                if (bodyObj.messages && Array.isArray(bodyObj.messages)) {
                    logDebug(`\n>>> [攔截啟動] 捕獲到底層網路封包字串，開始強制修改排序...`);
                    
                    // 執行排序優化
                    let optimizedMessages = optimizePayload(bodyObj.messages);
                    
                    // 覆寫回 Object 並重新字串化
                    bodyObj.messages = optimizedMessages;
                    config.body = JSON.stringify(bodyObj);
                    
                    // 將結果存入全域供 UI 劫持使用
                    window.DS_Optimized_Payload = optimizedMessages;
                    
                    // 嘗試直接覆寫 ST 常見的全域緩存變數
                    if (typeof window.lastPrompts !== 'undefined') window.lastPrompts = optimizedMessages;
                    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext().lastPrompts) {
                        SillyTavern.getContext().lastPrompts = optimizedMessages;
                    }

                    logDebug(`<<< [網路放行] 封包重組與排序成功！(最終發送: ${optimizedMessages.length} 條)`);
                }
            } catch (e) {
                logDebug(`[嚴重錯誤] 無法解析網路封包: ${e.message}`);
                console.error(e);
            }
        }
    }
    return originalFetch.apply(this, args);
};

// --- 劫持 ST 介面按鈕 (保證 View Last Prompt 顯示最新排序結果) ---
function hijackSTInterface() {
    // 劫持全域 printLastPrompt 函數 (ST 原生呼叫的函數)
    if (typeof window.printLastPrompt === 'function') {
        const originalPrint = window.printLastPrompt;
        window.printLastPrompt = function(...args) {
            if (window.DS_Optimized_Payload) {
                // 在 ST 渲染視窗前的一瞬間，把它的全域變數調包！
                window.lastPrompts = window.DS_Optimized_Payload;
            }
            return originalPrint.apply(this, args);
        };
        logDebug("已成功劫持 ST 全域 printLastPrompt 函數。");
    }

    // 雙重保險：劫持按鈕點擊事件
    $(document).on('click', '#last_prompt_btn, #view_last_prompt', function() {
        if (window.DS_Optimized_Payload) {
            window.lastPrompts = window.DS_Optimized_Payload;
        }
    });
}

// --- 無特效極簡 UI 介面 ---
jQuery(() => {
    const uiHtml = `
    <style>
        #ds_opt_panel { padding: 10px; border: 1px solid #444; background: #1a1a1a; margin-bottom: 10px; color: #ddd; font-family: sans-serif; }
        #ds_opt_panel h3 { margin: 0 0 10px 0; font-size: 15px; color: #fff; }
        #ds_opt_logs { width: 100%; height: 200px; background: #000; color: #0f0; font-family: monospace; font-size: 12px; padding: 5px; border: 1px solid #333; resize: vertical; margin-top: 10px; }
        .ds-hr { margin: 10px 0; border-color: #333; border-style: solid; border-width: 1px 0 0 0; }
        .ds-btn { background: #333; color: #fff; border: 1px solid #555; padding: 5px 10px; cursor: pointer; font-size: 12px; margin-top: 5px;}
        .ds-btn:hover { background: #444; }
        .ds-text { font-size: 12px; color: #aaa; margin-top: 5px; line-height: 1.4; }
    </style>
    <div id="ds_opt_panel">
        <h3>🧠 Deepseek Cache Optimizer v4.0 (強制覆寫版)</h3>
        <label><input type="checkbox" id="ds_opt_enable" checked> 啟用底層網路封包暴力重寫</label><br>
        <label><input type="checkbox" id="ds_opt_freeze" checked> 自動凍結系統提示詞 (防禦時間巨集)</label><br>
        <div style="margin-top: 8px;">
            <label>歷史對齊區塊 (Chunk Size): <input type="number" id="ds_opt_chunk_size" value="10" min="1" max="50" style="width: 50px; background:#222; color:#fff; border:1px solid #555;"></label>
        </div>
        <hr class="ds-hr">
        <button id="ds_opt_apply_settings" class="ds-btn">⚙️ 一鍵優化 ST 世界書設定</button>
        <div class="ds-text">
            ✔️ <b>V4 更新：</b>已採用底層字串解析與介面函數劫持。現在你打開 ST 原生的「View Last Prompt」，會看到與網路封包<b>完全一致且已重新排序</b>的狀態！
        </div>
        <hr class="ds-hr">
        <textarea id="ds_opt_logs" readonly></textarea>
    </div>`;

    $('#extensions_settings').append(uiHtml);

    $('#ds_opt_enable').on('change', function() { isEnabled = $(this).is(':checked'); });
    $('#ds_opt_freeze').on('change', function() { 
        isFreezeEnabled = $(this).is(':checked'); 
        if (!isFreezeEnabled) frozenSystemContent = null;
    });
    $('#ds_opt_chunk_size').on('change', function() { chunkSize = parseInt($(this).val(), 10) || 10; });

    $('#ds_opt_apply_settings').on('click', function() {
        const wiAsSystem = document.getElementById('world_info_system');
        if (wiAsSystem && !wiAsSystem.checked) {
            $(wiAsSystem).prop('checked', true).trigger('change');
            logDebug("[修正] 世界書 (World Info) 已強制勾選「Send as System」。");
        }
        logDebug("ST 設定已最佳化，世界書已被本插件接管排序。");
    });
    
    // 執行 ST 介面劫持
    setTimeout(hijackSTInterface, 1000); // 延遲 1 秒確保 ST 核心腳本已載入完成
    
    logDebug("Deepseek Optimizer v4 載入成功，暴力網路覆寫已就緒。");
});

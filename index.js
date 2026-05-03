const EXTENSION_NAME = "deepseek-cache-optimizer";

// 取得 ST 全域上下文 (避免使用脆弱的 import)
const STContext = SillyTavern.getContext();

const defaultSettings = {
    enabled: true,
    chunkSize: 10
};

// 確保設定物件存在
if (!STContext.extension_settings[EXTENSION_NAME]) {
    STContext.extension_settings[EXTENSION_NAME] = {};
}

const settings = Object.assign({}, defaultSettings, STContext.extension_settings[EXTENSION_NAME]);

function saveSettings() {
    STContext.extension_settings[EXTENSION_NAME] = settings;
    STContext.saveSettingsDebounced();
}

// 核心快取狀態錨點
let cacheState = {
    chatId: null,
    anchorContent: null
};

/**
 * 核心：重新組裝發送給 API 的訊息陣列
 */
function optimizeMessages(messages) {
    if (!settings.enabled || messages.length < 3) return messages;

    // 偵測是否切換聊天室
    const currentChatId = STContext.chatId || 'default';
    if (cacheState.chatId !== currentChatId) {
        cacheState.chatId = currentChatId;
        cacheState.anchorContent = null;
        console.log("[DS-Cache-Opt] 偵測到對話切換，重置靜態錨點");
    }

    let staticTop = [];
    let history = [];
    let volatile = [];
    let latestUser = messages[messages.length - 1]; // 抽出最新一句話

    // 將所有訊息進行分類
    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        // 陣列最頂端的第一條 System 視為絕對靜態的角色設定
        if (i === 0 && msg.role === 'system') {
            staticTop.push(msg);
        } 
        // 任何被插在中間或底部的 System (通常是世界書、擴充套件注入) 都視為動態變數
        else if (msg.role === 'system') {
            volatile.push(msg);
        } 
        // 使用者與 AI 的對話歷史
        else {
            history.push(msg);
        }
    }

    // 滑動視窗 (Sliding Window) 解決方案：超前丟棄與錨點追蹤
    if (history.length > 0) {
        let anchorIndex = -1;
        // 嘗試在歷史中尋找上一次鎖定的開頭
        if (cacheState.anchorContent) {
            anchorIndex = history.findIndex(m => m.content === cacheState.anchorContent);
        }

        if (anchorIndex !== -1) {
            // 錨點還在：完美切割，保證前綴與上一輪 100% 相同
            history = history.slice(anchorIndex);
        } else {
            // 錨點不見了 (上下文滿了 ST 砍掉了舊訊息)：一口氣超前丟棄 N 條
            let chunk = settings.chunkSize || 10;
            if (history.length > chunk + 2) {
                history = history.slice(chunk);
                cacheState.anchorContent = history[0].content;
                console.log(`[DS-Cache-Opt] 歷史推進，已超前剔除 ${chunk} 條訊息以建立新的快取護城河`);
            } else {
                cacheState.anchorContent = history[0].content;
            }
        }
    }

    // 終極重組：[絕對靜態的頂層] -> [靜止的歷史] -> [動態的世界書/作者備註] -> [最新一句話]
    let optimized = [...staticTop, ...history];
    
    if (volatile.length > 0) {
        let combined = volatile.map(m => m.content).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
    }
    
    optimized.push(latestUser);

    console.log(`[DS-Cache-Opt] Payload 重組完成 | 靜態區塊: ${staticTop.length + history.length} 條 | 動態後置區塊: ${volatile.length} 條`);
    return optimized;
}

/**
 * 底層劫持：攔截 ST 的網路請求
 * 這是保證 100% 生效的唯一解，完全無視 ST 內部的 prompt 複雜生命週期
 */
const originalFetch = window.fetch;
window.fetch = async function (...args) {
    const url = args[0];
    const options = args[1];

    // 判斷是否為送出給 LLM 的 POST 請求
    if (options && options.method === 'POST' && typeof options.body === 'string') {
        try {
            if (url.includes('/generate') || url.includes('/chat/completions') || url.includes('api.')) {
                let parsedBody = JSON.parse(options.body);
                
                let targetMessages = null;
                let isWrapped = false; // 處理不同 API proxy 的格式
                
                if (parsedBody.messages && Array.isArray(parsedBody.messages)) {
                    targetMessages = parsedBody.messages;
                } else if (parsedBody.body && parsedBody.body.messages && Array.isArray(parsedBody.body.messages)) {
                    targetMessages = parsedBody.body.messages;
                    isWrapped = true;
                }

                if (targetMessages) {
                    const optimizedMessages = optimizeMessages(targetMessages);
                    // 寫回 Payload
                    if (isWrapped) {
                        parsedBody.body.messages = optimizedMessages;
                    } else {
                        parsedBody.messages = optimizedMessages;
                    }
                    options.body = JSON.stringify(parsedBody);
                }
            }
        } catch (e) {
            console.error("[DS-Cache-Opt] 底層網路攔截處理失敗:", e);
        }
    }
    // 放行請求
    return originalFetch.apply(this, args);
};

/**
 * 內聯 UI 建立 (解決加載外部 HTML 失敗的問題)
 */
const uiHTML = `
<div class="deepseek-cache-container" style="padding:15px; background:rgba(20,20,20,0.5); border:1px solid var(--SmartThemeBorderColor); border-radius:8px; margin-bottom:10px;">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DeepSeek 快取極限最佳化 V3</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="padding-top:10px;">
            <label class="checkbox_label">
                <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                <span>啟用底層劫持快取錨點引擎 (Enable)</span>
            </label>
            
            <hr style="border-color:rgba(255,255,255,0.1); margin:10px 0;">
            <div>
                <small><b>動態錨點緩衝設定 (Stateful Chunking)</b></small><br>
                <label>超前丟棄訊息數:</label>
                <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                <br><small style="color:#a8a8a8;">當對話達到長度上限 ST 刪除舊訊息時，一次性超前丟棄 N 條(預設10)，以確保接下來 N 輪的前綴陣列 100% 靜止。</small>
            </div>

            <hr style="border-color:rgba(255,255,255,0.1); margin:10px 0;">
            <div style="color:#ff9d9d; font-size:0.85em; background:rgba(255,0,0,0.15); padding:10px; border-radius:5px;">
                <b>🚨 為了 100% 命中，你「必須」在 ST 中做的事:</b>
                <ul style="padding-left:20px; margin-top:5px; margin-bottom:0; line-height: 1.4;">
                    <li><b>禁用時間變數:</b> Advanced Formatting 中的預設提示詞絕對不能有 <code>{{time}}</code> 等變動巨集，否則每分鐘第一句都在變，快取永不命中。</li>
                    <li><b>世界書與作者備註設定:</b> 觸發的世界書請務必設定<b>「深度為 0」</b>，或勾選<b>「作為 System 插入」</b>。如果它被安插在深度 4 的「舊對話字串內部」，你的前綴快取將被徹底摧毀。</li>
                </ul>
            </div>
        </div>
    </div>
</div>
`;

// 掛載 UI 與監聽器
jQuery(async () => {
    // 注入至擴充功能面板
    $('#extensions_settings').append(uiHTML);

    // 綁定事件
    $('#ds_cache_enable').on('change', function() {
        settings.enabled = !!$(this).prop('checked');
        saveSettings();
    });
    $('#ds_chunk_size').on('input', function() {
        settings.chunkSize = parseInt($(this).val()) || 10;
        saveSettings();
    });
});

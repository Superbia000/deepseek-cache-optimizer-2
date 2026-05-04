/**
 * Deepseek Cache Optimizer v9.0.0 (Absolute Tier Restructuring)
 * 完全接管並重組 ST 的 Payload，自動適應所有破壞快取的因素。
 */

let isEnabled = true;
let isFreezeEnabled = true;
let chunkSize = 10;
let frozenSystemContent = null;
let lastChatId = null;

window.DS_LastSentPayload = null;

function logDebug(message) {
    console.log(`[DS_Optimizer] ${message}`);
    const logArea = document.getElementById('ds_opt_logs');
    if (logArea) {
        const time = new Date().toLocaleTimeString();
        logArea.value += `[${time}] ${message}\n`;
        logArea.scrollTop = logArea.scrollHeight;
    }
}

// 核心重組演算法
function reconstructPayload(messages) {
    if (!messages || messages.length === 0) return messages;

    // 取得 ST 內部上下文狀態
    const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
    
    // 1. 聊天室切換偵測 (清除舊的基石快取)
    if (context) {
        const currentChatId = context.chatId;
        if (lastChatId !== currentChatId) {
            logDebug(`[狀態] 偵測到聊天室切換，重置基石凍結快取。`);
            lastChatId = currentChatId;
            frozenSystemContent = null;
        }
    }

    // 建立四個絕對階層 (Tiers)
    let tier1_MainSystem = null;     // 基石
    let tier2_StableHistory = [];    // 歷史樹幹
    let tier3_DynamicContext = [];   // 動態分支 (世界書、設定、深層 Prompt)
    let tier4_LatestUser = null;     // 最新輸入

    // 2. 抽取 Tier 4: 最新的一條 User 輸入 (絕對置底)
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            tier4_LatestUser = messages.splice(i, 1)[0];
            break;
        }
    }

    // 3. 掃描與分類剩餘所有訊息
    messages.forEach((msg) => {
        if (msg.role === 'system') {
            if (!tier1_MainSystem) {
                // 第一條遇到的系統訊息，認定為主提示詞(角色卡)
                tier1_MainSystem = msg;
            } else {
                // [關鍵] 任何後續的 System (世界書、作者筆記、Jailbreak、不管設在多深)
                // 全部強制歸類到 Tier 3，絕對不允許它們混在歷史對話中破壞快取！
                tier3_DynamicContext.push(msg);
            }
        } else {
            // User / Assistant 的對話歷史
            tier2_StableHistory.push(msg);
        }
    });

    // 4. 處理 Tier 1: 基石凍結 (防禦 {{time}} 巨集跳動)
    if (isFreezeEnabled && tier1_MainSystem) {
        let contentStr = typeof tier1_MainSystem.content === 'string' ? tier1_MainSystem.content : JSON.stringify(tier1_MainSystem.content);
        if (!frozenSystemContent) {
            frozenSystemContent = contentStr;
            logDebug("[Tier 1] 建立初代凍結基石 (Main Prompt)。");
        } else {
            let diff = Math.abs(contentStr.length - frozenSystemContent.length);
            if (diff > 0 && diff <= 50) {
                // 巨集跳動，強制覆蓋
                tier1_MainSystem.content = typeof tier1_MainSystem.content === 'string' ? frozenSystemContent : JSON.parse(frozenSystemContent);
                logDebug(`[Tier 1] 攔截微小變動 (差異 ${diff} 字元)，已強制還原以保證基石 100% 吻合！`);
            } else if (diff > 50) {
                frozenSystemContent = contentStr;
                logDebug(`[Tier 1] 偵測到角色卡/提示詞大幅修改，更新基石。`);
            }
        }
    }

    // 5. 處理 Tier 2: 歷史錨點截斷 (解決上下文上限導致的破壞)
    let M = tier2_StableHistory.length;
    if (context && context.chat && M > 0 && chunkSize > 1) {
        let UI_Total = context.chat.length;
        let startIdx = UI_Total - M;
        if (startIdx < 0) startIdx = 0;

        // 計算錨點
        let anchorIdx = Math.ceil(startIdx / chunkSize) * chunkSize;
        let dropCount = anchorIdx - startIdx;
        
        if (dropCount > 0 && dropCount < M) {
            logDebug(`[Tier 2] 歷史起點調整：捨棄最舊 ${dropCount} 條對話，使歷史開頭對齊區塊。這保證了未來 ${chunkSize} 回合內，歷史前綴絕對靜止！`);
            tier2_StableHistory = tier2_StableHistory.slice(dropCount);
        } else if (dropCount === 0 || anchorIdx === startIdx) {
            logDebug(`[Tier 2] 歷史前綴已對齊，100% 命中準備就緒。`);
            // 備註：如果是用戶手動刪除舊回覆，M 會減少，但 Radix Tree 會自動從刪除點回退，不影響命中！
        }
    }

    if (tier3_DynamicContext.length > 0) {
        logDebug(`[Tier 3] 強制抽離 ${tier3_DynamicContext.length} 條動態設定 (含世界書/Prompt深層插入)，已全數後置，保護歷史快取！`);
    }

    // 6. 最終組裝 Payload (這就是保證 100% 命中的黃金結構)
    let optimized = [];
    if (tier1_MainSystem) optimized.push(tier1_MainSystem);
    optimized.push(...tier2_StableHistory);
    optimized.push(...tier3_DynamicContext);
    if (tier4_LatestUser) optimized.push(tier4_LatestUser);
    
    return optimized;
}

// 底層網路攔截器
const originalFetch = window.fetch;
window.fetch = async function (...args) {
    try {
        const [resource, config] = args;
        
        if (isEnabled && config && typeof config === 'object' && config.body && typeof config.body === 'string') {
            let url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');
            let isLLM = url.includes('/chat/completions') || url.includes('/api/') || url.includes('api.deepseek.com') || url.includes('openrouter.ai') || url.includes('/v1/generate');
            
            if (isLLM) {
                let bodyObj = JSON.parse(config.body);
                if (bodyObj.messages && Array.isArray(bodyObj.messages)) {
                    logDebug(`\n>>> [啟動] 捕獲發送封包，進行 V9 絕對階層重組...`);
                    
                    let optimizedMessages = reconstructPayload(bodyObj.messages);
                    bodyObj.messages = optimizedMessages;
                    config.body = JSON.stringify(bodyObj);
                    
                    window.DS_LastSentPayload = optimizedMessages;
                    logDebug(`<<< [放行] 重組成功！最終發送: ${optimizedMessages.length} 條`);
                }
            }
        }
    } catch (e) {
        console.error("[DS_Optimizer] 攔截器內部錯誤:", e);
    }
    return originalFetch.apply(window, args);
};

// UI 介面與事件綁定
jQuery(() => {
    const uiHtml = `
    <style>
        #ds_opt_panel { padding: 10px; border: 1px solid #444; background: #1a1a1a; margin-bottom: 10px; color: #ddd; font-family: sans-serif; border-radius: 5px; }
        #ds_opt_panel h3 { margin: 0 0 10px 0; font-size: 15px; color: #fff; }
        #ds_opt_logs { width: 100%; height: 160px; background: #000; color: #0f0; font-family: monospace; font-size: 12px; padding: 5px; border: 1px solid #333; resize: vertical; margin-top: 10px; }
        .ds-hr { margin: 10px 0; border-color: #333; border-style: solid; border-width: 1px 0 0 0; }
        .ds-btn { background: #333; color: #fff; border: 1px solid #555; padding: 6px 10px; cursor: pointer; font-size: 12px; margin-top: 5px; border-radius: 3px; }
        .ds-btn:hover { background: #444; }
        .ds-btn-highlight { background: #1a4a2a; border-color: #2a7a4a; }
        .ds-btn-highlight:hover { background: #2a6a3a; }
        .ds-text { font-size: 12px; color: #aaa; margin-top: 5px; line-height: 1.4; }
    </style>
    <div id="ds_opt_panel">
        <h3>🧠 Deepseek Cache Optimizer v9.0 (全域重組版)</h3>
        <label><input type="checkbox" id="ds_opt_enable" checked> 啟用 Payload 強制打散與階層重組</label><br>
        <label><input type="checkbox" id="ds_opt_freeze" checked> 自動凍結系統提示詞 (防禦時間巨集)</label><br>
        <div style="margin-top: 8px;">
            <label>歷史對齊區塊 (Chunk Size): <input type="number" id="ds_opt_chunk_size" value="10" min="1" max="50" style="width: 50px; background:#222; color:#fff; border:1px solid #555;"></label>
        </div>
        <hr class="ds-hr">
        <button id="ds_opt_apply_settings" class="ds-btn">⚙️ 一鍵優化 ST 世界書設定 (必要)</button>
        <button id="ds_opt_view_payload" class="ds-btn ds-btn-highlight">🔍 檢視重組後的完美 Payload</button>
        <div class="ds-text">
            ✔️ <b>V9 原理：</b>無論你的世界書插入深度設為多少，或 ST 預設如何排列，本插件都會強制將所有動態內容集中搬運至歷史對話之後、最新輸入之前。這能 100% 確保 Deepseek 的前綴快取不被破壞！
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
            logDebug("[設定修正] 世界書已強制勾選「Send as System」。這樣插件才能將其識別並後置。");
        } else {
            logDebug("[設定確認] 世界書設定已是最佳狀態。");
        }
    });

    $('#ds_opt_view_payload').on('click', function() {
        if (!window.DS_LastSentPayload) {
            alert("尚未發送任何對話！");
            return;
        }
        const payloadStr = JSON.stringify(window.DS_LastSentPayload, null, 2);
        const win = window.open("", "DS_Payload_View", "width=800,height=700,scrollbars=yes");
        win.document.body.innerHTML = `
            <h3 style="font-family: sans-serif; color: #333;">📦 V9 黃金結構：Deepseek 100% 命中 Payload</h3>
            <p style="font-family: sans-serif; font-size: 13px; color: #555;">
                <b>結構驗證：</b><br>
                1. <b>Tier 1 (最頂部)</b>: 唯一的 Main System Prompt。<br>
                2. <b>Tier 2 (中間)</b>: 連續且未被任何設定打斷的 History (User/Assistant)。<br>
                3. <b>Tier 3 (倒數第二層)</b>: 所有的動態設定 (包含剛觸發的世界書、不同深度的作者筆記)。<br>
                4. <b>Tier 4 (最底部)</b>: 你的最新一條 User 輸入。
            </p>
            <pre style="background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word;">${payloadStr}</pre>
        `;
    });
    
    logDebug("Deepseek Optimizer v9 載入成功，全域階層重組已啟動！");
});

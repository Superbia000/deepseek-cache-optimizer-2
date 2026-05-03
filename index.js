console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/3] V12.0 官方黃金大道版啟動...");
console.log("==================================================");

import { eventSource } from '../../../../script.js';

const EXTENSION_NAME = "deepseek-cache-optimizer";
const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_ext_settings_ref = window.extension_settings || {};

// 相容性獲取設定檔
if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
    ST_ext_settings_ref = SillyTavern.getContext().extension_settings || ST_ext_settings_ref;
} else if (typeof window.getContext === 'function') {
    ST_ext_settings_ref = window.getContext().extension_settings || ST_ext_settings_ref;
}
if (!ST_ext_settings_ref[EXTENSION_NAME]) {
    ST_ext_settings_ref[EXTENSION_NAME] = { ...defaultSettings };
}
settings = Object.assign({}, defaultSettings, ST_ext_settings_ref[EXTENSION_NAME]);

// 核心快取狀態機
let cacheState = {
    chatId: null,
    isInitialized: false,
    exampleCount: 0,
    anchorKey: null
};

function safeSaveSettings() {
    ST_ext_settings_ref[EXTENSION_NAME] = settings;
    if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext && typeof SillyTavern.getContext().saveSettingsDebounced === 'function') {
        SillyTavern.getContext().saveSettingsDebounced();
    } else if (typeof window.saveSettingsDebounced === 'function') {
        window.saveSettingsDebounced();
    }
}

// 防崩潰特徵提取
function safeGetText(msg) {
    if (!msg || !msg.content) return "";
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        let txtPart = msg.content.find(c => c.type === 'text');
        return txtPart && txtPart.text ? txtPart.text : "[Media]";
    }
    return String(msg.content);
}

// 產生複合特徵金鑰
function getAnchorKey(chatArray, index) {
    if (index >= chatArray.length) return null;
    let key = `${chatArray[index].role}::${safeGetText(chatArray[index]).substring(0, 50)}`;
    if (index + 1 < chatArray.length) {
        key += `||${chatArray[index+1].role}::${safeGetText(chatArray[index+1]).substring(0, 50)}`;
    }
    return key;
}

// ==========================================
// UI 注入 (ST 原生無干擾風格)
// ==========================================
function injectUI() {
    if ($('#ds_cache_ui_box').length > 0) return;
    if ($('#extensions_settings').length === 0) {
        setTimeout(injectUI, 1000);
        return;
    }

    console.log("[DS-Cache-Opt] ⏳ [2/3] 注入介面...");
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 快取護城河 V12</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用快取黃金重組引擎</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                </div>
                <div style="margin-top: 10px;">
                    <button id="ds_reset_btn" class="menu_button">強制重置快取基準</button>
                </div>
            </div>
        </div>
    </div>
    `;

    $('#extensions_settings').append(uiHTML);
    $('#ds_cache_enable').on('change', function() {
        settings.enabled = !!$(this).prop('checked');
        if (settings.enabled) cacheState.isInitialized = false; 
        safeSaveSettings();
    });
    $('#ds_chunk_size').on('input', function() {
        settings.chunkSize = parseInt($(this).val()) || 10;
        safeSaveSettings();
    });
    $('#ds_reset_btn').on('click', function() {
        cacheState.isInitialized = false;
        alert("DeepSeek 快取狀態已重置！下一句對話將建立新基準。");
    });
}
$(document).ready(injectUI);

// ==========================================
// 核心重組邏輯 (Zero-Flaw)
// ==========================================
function optimizeMessages(messages) {
    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestMsg = messages[messages.length - 1]; 

    let foundFirstUser = false;
    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        if (msg.role !== 'system') foundFirstUser = true;

        if (!foundFirstUser && msg.role === 'system') {
            sysTop.push(msg); // 頭部靜態 Prompt
        } else if (msg.role === 'system') {
            sysBottom.push(msg); // 動態世界書與備註
        } else {
            historyAll.push(msg); // 真實對話與範例
        }
    }

    let currentChatId = sysTop.length > 0 ? getAnchorKey(sysTop, 0) : 'default';
    if (!cacheState.isInitialized || cacheState.chatId !== currentChatId) {
        cacheState.chatId = currentChatId;
        cacheState.isInitialized = true;
        let firstRealUserIndex = historyAll.findIndex(m => m.role === 'user');
        cacheState.exampleCount = firstRealUserIndex > 0 ? firstRealUserIndex : 0;
        cacheState.anchorKey = getAnchorKey(historyAll, cacheState.exampleCount);
    }

    if (historyAll.length > cacheState.exampleCount) {
        let examples = historyAll.slice(0, cacheState.exampleCount);
        let realHistory = historyAll.slice(cacheState.exampleCount);
        
        let anchorIndex = -1;
        if (cacheState.anchorKey) {
            for (let i = 0; i < realHistory.length; i++) {
                if (getAnchorKey(realHistory, i) === cacheState.anchorKey) {
                    anchorIndex = i; break;
                }
            }
        }

        if (anchorIndex !== -1) {
            realHistory = realHistory.slice(anchorIndex);
            console.log(`[DS-Cache-Opt] 🎯 複合錨點命中！(Index: ${anchorIndex})`);
        } else {
            let chunk = settings.chunkSize || 10;
            if (realHistory.length > chunk + 2) {
                realHistory = realHistory.slice(chunk);
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
                console.log(`[DS-Cache-Opt] 🚧 超前剔除 ${chunk} 條建立新護城河。`);
            } else {
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
            }
        }
        historyAll = [...examples, ...realHistory];
    }

    let optimized = [...sysTop, ...historyAll];
    if (sysBottom.length > 0) {
        let combined = sysBottom.map(m => safeGetText(m)).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 合併 ${sysBottom.length} 條動態設定並強行置底。`);
    }
    optimized.push(latestMsg);
    
    return optimized;
}

// ==========================================
// V12 獨家：ST 官方標準 Prompt 攔截點
// ==========================================
if (eventSource) {
    // 這是 ST 官方用來讓外掛修改對話陣列的唯一正確事件
    eventSource.on('chat_completion_prompt', (chatArray) => {
        if (!settings.enabled) return;
        if (Array.isArray(chatArray) && chatArray.length > 3) {
            console.log(`\n--- [DS-Cache-Opt] 🧠 觸發 ST 官方重組事件 (原長度: ${chatArray.length}) ---`);
            
            let optimized = optimizeMessages(chatArray);
            
            if (optimized.length !== chatArray.length || optimized !== chatArray) {
                // 原地替換，保證 Vue 介面與底層 API 100% 同步修改
                chatArray.splice(0, chatArray.length, ...optimized);
                
                console.log(`[DS-Cache-Opt] ✅ 陣列原地重組完成！(輸出長度: ${chatArray.length})`);
                console.log(`--- [DS-Cache-Opt] 結束 ---\n`);
            }
        }
    });
    console.log("[DS-Cache-Opt] 🎉 [3/3] 官方黃金大道攔截註冊成功！系統準備就緒。");
} else {
    console.error("[DS-Cache-Opt] ❌ 嚴重錯誤：無法載入 eventSource。");
}

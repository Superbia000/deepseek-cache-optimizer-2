console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/3] V8.0 極致相容架構啟動中...");
console.log("==================================================");

// 🚫 絕對禁止使用 import，避免不同 ST 版本的 SyntaxError 崩潰
const EXTENSION_NAME = "deepseek-cache-optimizer";
const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_ext_settings_ref = null;

// 核心狀態機
let cacheState = {
    chatId: null,
    isInitialized: false,
    exampleCount: 0,
    anchorKey: null
};

// ==========================================
// 1. 動態全域變數尋找與初始化
// ==========================================
function init() {
    console.log("[DS-Cache-Opt] ⏳ 正在尋找 ST 全域變數...");

    // 動態獲取 Context (相容各種 ST 版本)
    const getCtx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext : (window.getContext || null);
    const context = getCtx ? getCtx() : {};

    // 尋找設定檔與事件源
    let extSettings = context.extension_settings || window.extension_settings;
    let evSource = context.eventSource || window.eventSource;

    // 如果 ST 還沒載入完畢，延遲 0.5 秒後重試
    if (!extSettings || !evSource || typeof evSource.on !== 'function') {
        setTimeout(init, 500);
        return;
    }

    ST_ext_settings_ref = extSettings;
    
    // 初始化設定
    if (!ST_ext_settings_ref[EXTENSION_NAME]) {
        ST_ext_settings_ref[EXTENSION_NAME] = { ...defaultSettings };
    }
    settings = Object.assign({}, defaultSettings, ST_ext_settings_ref[EXTENSION_NAME]);
    if (settings.enabled !== false) settings.enabled = true;

    console.log("[DS-Cache-Opt] ⚙️ [2/3] 當前設定檔:", settings);

    // 啟動功能
    injectUI();
    registerHook(evSource);
}

function safeSaveSettings() {
    if (ST_ext_settings_ref) ST_ext_settings_ref[EXTENSION_NAME] = settings;
    const getCtx = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext : (window.getContext || null);
    if (getCtx && typeof getCtx().saveSettingsDebounced === 'function') {
        getCtx().saveSettingsDebounced();
    } else if (typeof window.saveSettingsDebounced === 'function') {
        window.saveSettingsDebounced();
    }
}

// 防崩潰特徵抓取
function safeGetText(msg) {
    if (!msg || !msg.content) return "";
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        let txtPart = msg.content.find(c => c.type === 'text');
        return txtPart && txtPart.text ? txtPart.text : "[Media]";
    }
    return String(msg.content);
}

// 產生複合防呆特徵金鑰
function getAnchorKey(chatArray, index) {
    if (index >= chatArray.length) return null;
    let key = `${chatArray[index].role}::${safeGetText(chatArray[index]).substring(0, 50)}`;
    if (index + 1 < chatArray.length) {
        key += `||${chatArray[index+1].role}::${safeGetText(chatArray[index+1]).substring(0, 50)}`;
    }
    return key;
}

// ==========================================
// 2. 原生風格 UI 注入
// ==========================================
function injectUI() {
    const uiHTML = `
    <div id="ds_cache_ui_box" class="extension_settings_block">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>DeepSeek 原生快取架構 V8.0</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用原生事件攔截引擎</span>
                </label>
                <hr class="sysdef_hr">
                <div>
                    <label>滑動緩衝區塊大小 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                    <br><small style="color:var(--SmartThemeBodyColor);">當 ST 刪除舊訊息時，超前丟棄 N 條以保證前綴靜止。</small>
                </div>
                <div style="margin-top: 10px;">
                    <button id="ds_reset_btn" class="menu_button">強制重置快取狀態 (手動刪除歷史後點擊)</button>
                </div>
            </div>
        </div>
    </div>
    `;

    if ($('#extensions_settings').length > 0) {
        if ($('#ds_cache_ui_box').length === 0) {
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
    } else {
        setTimeout(injectUI, 1000);
    }
}

// ==========================================
// 3. 核心零缺陷重組邏輯
// ==========================================
function optimizeMessages(messages) {
    if (!settings.enabled || messages.length < 3) return messages;

    console.log(`\n--- [DS-Cache-Opt] 🧠 開始陣列重組 (原長度: ${messages.length}) ---`);

    let sysTop = [];
    let historyAll = [];
    let sysBottom = [];
    let latestMsg = messages[messages.length - 1]; 

    let foundFirstUser = false;
    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        if (msg.role !== 'system') foundFirstUser = true;

        if (!foundFirstUser && msg.role === 'system') {
            sysTop.push(msg);
        } else if (msg.role === 'system') {
            sysBottom.push(msg);
        } else {
            historyAll.push(msg);
        }
    }

    // 對話切換與初始化基準
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
            console.log(`[DS-Cache-Opt] 🎯 複合錨點命中！(Index: ${anchorIndex})，前綴完美鎖定。`);
        } else {
            let chunk = settings.chunkSize || 10;
            if (realHistory.length > chunk + 2) {
                realHistory = realHistory.slice(chunk);
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
                console.log(`[DS-Cache-Opt] 🚧 錨點丟失，超前剔除 ${chunk} 條建立新護城河。`);
            } else {
                cacheState.anchorKey = getAnchorKey(realHistory, 0);
            }
        }
        historyAll = [...examples, ...realHistory];
    }

    // 重組並置底
    let optimized = [...sysTop, ...historyAll];
    if (sysBottom.length > 0) {
        let combined = sysBottom.map(m => safeGetText(m)).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 發現並合併 ${sysBottom.length} 條動態設定，已安全強制置底。`);
    }
    optimized.push(latestMsg);

    console.log(`[DS-Cache-Opt] ✅ 陣列重組完成！(輸出長度: ${optimized.length})`);
    console.log(`--- [DS-Cache-Opt] 結束 ---\n`);
    
    return optimized;
}

// ==========================================
// 4. 註冊 ST 原生 API 攔截事件
// ==========================================
function registerHook(evSource) {
    evSource.on('before_api_request', (requestData) => {
        if (settings.enabled && requestData && Array.isArray(requestData.messages)) {
            requestData.messages = optimizeMessages(requestData.messages);
        }
    });
    console.log("[DS-Cache-Opt] 🎉 [3/3] 原生事件攔截註冊成功！系統完美運作中。");
}

// 延遲啟動以確保 ST 環境已準備完畢
setTimeout(init, 500);

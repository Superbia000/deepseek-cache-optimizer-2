console.log("==================================================");
console.log("[DS-Cache-Opt] 🚀 [1/7] 外掛腳本已成功被 SillyTavern 讀取並開始執行！");
console.log("==================================================");

const EXTENSION_NAME = "deepseek-cache-optimizer";
const defaultSettings = { enabled: true, chunkSize: 10 };
let settings = { ...defaultSettings };
let ST_extension_settings = {}; // 全域設定參考

// 核心快取狀態錨點
let cacheState = {
    chatId: null,
    anchorContent: null
};

// ==========================================
// 1. 安全初始化模組 (防崩潰機制)
// ==========================================
async function init() {
    console.log("[DS-Cache-Opt] ⏳ [2/7] 嘗試載入 SillyTavern 核心設定...");
    try {
        // 使用動態 Import，就算路徑錯了也不會導致整個腳本白屏崩潰
        const stModule = await import('../../../../script.js');
        ST_extension_settings = stModule.extension_settings;
        console.log("[DS-Cache-Opt] ✅ [3/7] 成功從 import 取得 ST 設定！");
    } catch (err) {
        console.warn("[DS-Cache-Opt] ⚠️ [3/7] Import 失敗，嘗試使用 window 全域變數...", err);
        if (window.extension_settings) {
            ST_extension_settings = window.extension_settings;
            console.log("[DS-Cache-Opt] ✅ [3/7] 成功從 window 取得 ST 設定！");
        } else {
            console.error("[DS-Cache-Opt] ❌ [3/7] 無法取得任何設定，外掛可能無法儲存狀態。");
        }
    }

    // 初始化設定值
    if (!ST_extension_settings[EXTENSION_NAME]) {
        ST_extension_settings[EXTENSION_NAME] = {};
    }
    settings = Object.assign({}, defaultSettings, ST_extension_settings[EXTENSION_NAME]);
    console.log("[DS-Cache-Opt] ⚙️ [4/7] 當前設定檔讀取完畢:", settings);

    // 啟動 UI 與網路攔截
    injectUI();
    setupFetchHijack();
}

// ==========================================
// 2. 暴力 UI 注入 (輪詢直到成功)
// ==========================================
function injectUI() {
    console.log("[DS-Cache-Opt] ⏳ [5/7] 準備注入 UI 介面...");
    const uiHTML = `
    <div id="ds_cache_ui_box" style="padding:15px; background:rgba(20,20,20,0.8); border:2px solid #00ff88; border-radius:8px; margin-bottom:10px;">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header" style="color:#00ff88;">
                <b>🟢 DeepSeek 快取引擎 V4 (運行中)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding-top:10px;">
                <label class="checkbox_label">
                    <input type="checkbox" id="ds_cache_enable" ${settings.enabled ? 'checked' : ''}>
                    <span>啟用 DeepSeek 底層劫持快取引擎</span>
                </label>
                <hr style="border-color:rgba(255,255,255,0.1); margin:10px 0;">
                <div>
                    <label>超前丟棄訊息數 (Chunk Size):</label>
                    <input type="number" id="ds_chunk_size" class="text_pole" min="2" max="30" value="${settings.chunkSize}" style="width:60px; margin-left:10px;">
                    <br><small style="color:#a8a8a8;">當 ST 刪除舊訊息時，超前丟棄 N 條以保證前綴靜止。</small>
                </div>
            </div>
        </div>
    </div>
    `;

    // 檢查 ST 的擴充設定面板是否已經出現
    if ($('#extensions_settings').length > 0) {
        if ($('#ds_cache_ui_box').length === 0) {
            $('#extensions_settings').append(uiHTML);
            console.log("[DS-Cache-Opt] 🖥️ [6/7] UI 介面注入成功！請檢查 ST 的 Extensions 面板。");
            
            // 綁定事件
            $('#ds_cache_enable').on('change', function() {
                settings.enabled = !!$(this).prop('checked');
                ST_extension_settings[EXTENSION_NAME] = settings;
                console.log("[DS-Cache-Opt] 🔘 狀態切換: 啟用 =", settings.enabled);
            });
            $('#ds_chunk_size').on('input', function() {
                settings.chunkSize = parseInt($(this).val()) || 10;
                ST_extension_settings[EXTENSION_NAME] = settings;
                console.log("[DS-Cache-Opt] 🔘 ChunkSize 更改為:", settings.chunkSize);
            });
        }
    } else {
        console.warn("[DS-Cache-Opt] ⚠️ [5/7] 找不到 #extensions_settings 面板，1秒後重試...");
        setTimeout(injectUI, 1000); // 輪詢直到成功
    }
}

// ==========================================
// 3. 核心重組邏輯
// ==========================================
function optimizeMessages(messages) {
    console.log(`\n--- [DS-Cache-Opt] 🧠 開始進行陣列重組 ---`);
    console.log(`[DS-Cache-Opt] 原始陣列長度: ${messages.length}`);

    if (!settings.enabled) {
        console.log("[DS-Cache-Opt] ⛔ 外掛已停用，不處理。");
        return messages;
    }
    if (messages.length < 3) {
        console.log("[DS-Cache-Opt] ⏭️ 陣列太短，跳過處理。");
        return messages;
    }

    let staticTop = [];
    let history = [];
    let volatile = [];
    let latestUser = messages[messages.length - 1];

    for (let i = 0; i < messages.length - 1; i++) {
        let msg = messages[i];
        if (i === 0 && msg.role === 'system') {
            staticTop.push(msg);
        } else if (msg.role === 'system') {
            volatile.push(msg);
            console.log(`[DS-Cache-Opt] 🔍 偵測到動態/世界書 System，深度 index: ${i}`);
        } else {
            history.push(msg);
        }
    }

    // 狀態錨點處理
    if (history.length > 0) {
        let anchorIndex = -1;
        if (cacheState.anchorContent) {
            anchorIndex = history.findIndex(m => m.content === cacheState.anchorContent);
        }

        if (anchorIndex !== -1) {
            history = history.slice(anchorIndex);
            console.log(`[DS-Cache-Opt] 🎯 快取錨點命中！(在歷史記錄 index: ${anchorIndex})，完美切割保證前綴。`);
        } else {
            let chunk = settings.chunkSize || 10;
            if (history.length > chunk + 2) {
                history = history.slice(chunk);
                cacheState.anchorContent = history[0].content;
                console.log(`[DS-Cache-Opt] 🚧 錨點丟失 (上下文推進)，超前剔除 ${chunk} 條，建立新錨點。`);
            } else {
                cacheState.anchorContent = history[0].content;
                console.log(`[DS-Cache-Opt] 🆕 歷史過短，直接建立首條為新錨點。`);
            }
        }
    }

    let optimized = [...staticTop, ...history];
    if (volatile.length > 0) {
        let combined = volatile.map(m => m.content).join("\n\n---\n\n");
        optimized.push({ role: 'system', content: combined });
        console.log(`[DS-Cache-Opt] 📦 已將 ${volatile.length} 條動態 System 合併並置於最底部 (最新對話之上)。`);
    }
    optimized.push(latestUser);

    console.log(`[DS-Cache-Opt] ✅ 重組完成！新的陣列長度: ${optimized.length}`);
    console.log(`--- [DS-Cache-Opt] 重組結束 ---\n`);
    return optimized;
}

// ==========================================
// 4. 底層網路劫持 (Fetch Interceptor)
// ==========================================
function setupFetchHijack() {
    console.log("[DS-Cache-Opt] 🛡️ [7/7] 注入 Fetch 底層攔截器...");
    const originalFetch = window.fetch;
    
    window.fetch = async function (...args) {
        const url = args[0] || "";
        const options = args[1] || {};

        // 僅攔截 POST 且有 body 的請求
        if (options.method === 'POST' && typeof options.body === 'string') {
            // 判斷是否為送給 LLM 的請求
            if (url.includes('/generate') || url.includes('/chat/completions') || url.includes('api.')) {
                console.log(`\n[DS-Cache-Opt] 🌐 攔截到 LLM 請求發出: ${url}`);
                try {
                    let parsedBody = JSON.parse(options.body);
                    let targetMessages = null;
                    let isWrapped = false;
                    
                    if (parsedBody.messages && Array.isArray(parsedBody.messages)) {
                        targetMessages = parsedBody.messages;
                    } else if (parsedBody.body && parsedBody.body.messages && Array.isArray(parsedBody.body.messages)) {
                        targetMessages = parsedBody.body.messages;
                        isWrapped = true;
                    }

                    if (targetMessages) {
                        const optimizedMessages = optimizeMessages(targetMessages);
                        if (isWrapped) {
                            parsedBody.body.messages = optimizedMessages;
                        } else {
                            parsedBody.messages = optimizedMessages;
                        }
                        options.body = JSON.stringify(parsedBody);
                        console.log("[DS-Cache-Opt] 📤 Payload 已覆寫並準備送出。");
                    } else {
                        console.log("[DS-Cache-Opt] ⏩ 未在此請求中發現 messages 陣列，跳過。");
                    }
                } catch (e) {
                    console.error("[DS-Cache-Opt] ❌ 底層攔截處理失敗:", e);
                }
            }
        }
        return originalFetch.apply(this, args);
    };
    console.log("[DS-Cache-Opt] 🎉 初始化流程全部完成！外掛現正全面守護您的 DeepSeek 快取。");
}

// 啟動入口
$(document).ready(() => {
    init();
});

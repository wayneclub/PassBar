// ==UserScript==
// @name         WebViewer PDF to ZIP (Buffer Mode)
// @namespace    http://tampermonkey.net/
// @version      12.0
// @description  自動捲動、暫存圖片，最後手動或到底自動打包成 ZIP 下載
// @author       Gemini
// @match        https://view.protectedpdf.com/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(function () {
    "use strict";

    let isRunning = false;
    let capturedPages = new Map(); // 暫存圖片數據 { "Page 1": blob }
    let timer = null;
    let lastScrollTop = -1;
    let bottomHitCount = 0;

    // UI 面板設定
    const panel = document.createElement("div");
    Object.assign(panel.style, {
        position: "fixed", top: "20px", right: "20px", zIndex: "9999999",
        padding: "15px", background: "rgba(0,0,0,0.9)", color: "white",
        borderRadius: "12px", display: "flex", flexDirection: "column", gap: "10px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.5)", fontFamily: "sans-serif", width: "200px"
    });

    const statusView = document.createElement("div");
    statusView.style.fontSize = "14px";
    statusView.innerHTML = "狀態: 待機<br>暫存: 0 頁";

    const startBtn = createBtn("▶️ Start (開始抓取)", "#28a745");
    const stopBtn = createBtn("⏹️ Stop (停止捲動)", "#dc3545");
    const zipBtn = createBtn("📦 Download ZIP", "#ffc107");
    zipBtn.style.color = "black";

    panel.append(statusView, startBtn, stopBtn, zipBtn);
    document.body.appendChild(panel);

    function createBtn(text, color) {
        const b = document.createElement("button");
        b.innerHTML = text;
        Object.assign(b.style, {
            padding: "10px", border: "none", borderRadius: "6px",
            background: color, color: "white", cursor: "pointer", fontWeight: "bold"
        });
        return b;
    }

    // 將 DataURL 轉為 Blob 的輔助函數
    function dataURLtoBlob(dataurl) {
        let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
            bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
        while(n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], {type:mime});
    }

    async function autoRun() {
        if (!isRunning) return;

        const iframe = document.querySelector('iframe');
        const innerDoc = iframe?.contentDocument;
        const scrollContainer = innerDoc?.querySelector('.DocumentContainer') || innerDoc?.querySelector('.document')?.parentElement;

        if (!innerDoc || !scrollContainer) return;

        const pages = innerDoc.querySelectorAll('.pageContainer');
        pages.forEach(page => {
            const pageId = page.getAttribute('aria-label');
            if (pageId && !capturedPages.has(pageId)) {
                const canvas = page.querySelector('canvas[id^="hrthumb"]') || page.querySelector('canvas.hacc') || page.querySelector('canvas');
                if (canvas && canvas.width > 200) {
                    try {
                        const dataUrl = canvas.toDataURL("image/png");
                        capturedPages.set(pageId, dataURLtoBlob(dataUrl));
                    } catch (e) { console.error("抓取失敗", e); }
                }
            }
        });

        statusView.innerHTML = `狀態: 抓取中...<br>暫存: ${capturedPages.size} 頁`;

        const currentScroll = scrollContainer.scrollTop;
        const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;

        if (currentScroll >= maxScroll - 5 || (lastScrollTop !== -1 && currentScroll === lastScrollTop)) {
            bottomHitCount++;
        } else {
            bottomHitCount = 0;
        }

        lastScrollTop = currentScroll;

        if (bottomHitCount >= 3) {
            stopCapture("已自動掃描到底部");
            return;
        }

        scrollContainer.scrollTop += 750;
        timer = setTimeout(autoRun, 2000);
    }

    function stopCapture(msg = "已停止") {
        isRunning = false;
        clearTimeout(timer);
        statusView.innerHTML = `狀態: ${msg}<br>暫存: ${capturedPages.size} 頁`;
    }

    async function downloadZip() {
        if (capturedPages.size === 0) return alert("目前沒有暫存圖片");
        if (typeof JSZip === "undefined") return alert("JSZip 庫尚未載入，請確認網路連線或稍候再試。");

        statusView.innerHTML = "⏳ 正在打包 ZIP...";
        const zip = new JSZip();

        capturedPages.forEach((blob, pageId) => {
            const fileName = `${pageId.replace(/\s+/g, '_')}.png`;
            zip.file(fileName, blob);
        });

        const content = await zip.generateAsync({type:"blob"});
        const link = document.createElement("a");
        link.href = URL.createObjectURL(content);
        link.download = `PDF_Bundle_${new Date().getTime()}.zip`;
        link.click();

        statusView.innerHTML = `✅ 下載完成！<br>共 ${capturedPages.size} 頁`;
    }

    startBtn.onclick = () => {
        if (isRunning) return;
        isRunning = true;
        bottomHitCount = 0;
        autoRun();
    };

    stopBtn.onclick = () => stopCapture("手動停止");

    zipBtn.onclick = downloadZip;

})();
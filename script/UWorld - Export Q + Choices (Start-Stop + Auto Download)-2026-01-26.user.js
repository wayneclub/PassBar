// ==UserScript==
// @name         UWorld - Export Q + Choices (Start/Stop + Auto Download)
// @namespace    http://tampermonkey.net/
// @version      2026-01-26
// @description  Capture #questionText + choices A-D, auto-next, auto-download JSON with exam name + date
// @author       You
// @match        https://apps-legal.uworld.com/courseapp/legal/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      www.uworld.com
// @connect      apps-legal.uworld.com
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    questionSelector: "#questionText",
    nextSelector: 'a[aria-label="Navigate to Next Question"]',
    submitSelector: 'button.submit-btn[aria-label="Submit"], button.submit-btn',
    statsBarSelector: ".stats-bar[role='alert'], .stats-bar",
    incorrectAnswerSelector: ".stats-bar .incorrect-answer .stats-value",
    explanationContainerSelector: "#explanation-container",
    explanationBlockSelector: "div.question-content.right-content",
    standardContainerSelector: "div.content.d-flex.justify-content-start",
    choiceTableSelector: "table.single-response",
    choiceHighlightPrefix: "#answerhighlight", // #answerhighlight1..4
    maxQuestions: 5000,

    // 你遇到 timeout 多半是 SPA 換題沒改到 #questionText 本身（而是外層重 render）
    // 所以這裡改成：用「輪詢」等到題目文字變化，比 mutation 更穩。
    waitTimeoutMs: 20000,
    pollIntervalMs: 120,

    afterClickDelayMs: 250,
    afterSelectDelayMs: 120,
    loopDelayMs: 80,
    submitWaitTimeoutMs: 12000,
    answerReadyTimeoutMs: 25000,
    answerReadyRetryCount: 2,
    explanationMinTextLength: 40,
    screenshotRetryCount: 4,
    screenshotRetryDelayMs: 450,
    screenshotScrollSettleMs: 220,
    screenshotImageWaitTimeoutMs: 12000,
    screenshotScaleMax: 2,
    html2canvasUrl:
      "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
    jsZipUrl: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",

    // SPA routes
    createTestPathHint: "createtest",
    launchTestPathHint: "launchtest",

    // createtest auto-fill behavior
    createTestCountSelector: ".question-count-div",
    createTestInputSelector: "input.mat-input-element.step5, #mat-input-2",
    createTestAutofillDelayMs: 120,
  };

  // ===== State =====
  let isRunning = false;
  let stopRequested = false;

  const questions = [];
  const screenshotFiles = []; // [{ name, blob }]
  const seen = new Set(); // 題幹去重（如果你要關掉跟我說）
  const crossOriginImgDataUrlCache = new Map(); // src -> dataURL
  let html2canvasLib = null;
  let fflateLib = null;
  let JSZipLib = null;
  let isDownloading = false;

  let examName = "UWorld";
  let examSubject = "";
  let examChapter = "";

  // ===== Utils =====
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function pad4(n) {
    return String(n).padStart(4, "0");
  }

  function blobFromDataUrl(dataUrl) {
    const m = (dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return null;
    const mime = m[1] || "image/png";
    const b64 = m[2] || "";
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function blobToUint8Array(blob) {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  }

  async function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label || "operation"}-timeout-${ms}ms`));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("blob-to-dataurl-failed"));
      fr.readAsDataURL(blob);
    });
  }

  function isCrossOriginUrl(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin !== location.origin;
    } catch (e) {
      return false;
    }
  }

  function gmFetchBlob(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("gm_xmlhttprequest-unavailable"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "blob",
        timeout: timeoutMs,
        onload: (resp) => {
          if (resp.status >= 200 && resp.status < 300 && resp.response) {
            resolve(resp.response);
            return;
          }
          reject(new Error(`gm-http-${resp.status}`));
        },
        ontimeout: () => reject(new Error("gm-timeout")),
        onerror: () => reject(new Error("gm-error")),
      });
    });
  }

  async function buildCrossOriginImgDataMap(root) {
    const map = new Map();
    if (!root) return map;
    const imgs = Array.from(root.querySelectorAll("img[src]"));

    for (const img of imgs) {
      const raw = img.getAttribute("src") || "";
      if (!raw) continue;
      const abs = new URL(raw, location.href).href;
      if (!isCrossOriginUrl(abs)) continue;

      if (crossOriginImgDataUrlCache.has(abs)) {
        map.set(abs, crossOriginImgDataUrlCache.get(abs));
        continue;
      }

      try {
        const blob = await gmFetchBlob(abs);
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl) {
          crossOriginImgDataUrlCache.set(abs, dataUrl);
          map.set(abs, dataUrl);
        }
      } catch (err) {
        console.warn("[UWorld Export] cross-origin img inline failed:", abs, err);
      }
    }
    return map;
  }

  function loadScriptOnce(src, globalName) {
    return new Promise((resolve, reject) => {
      if (globalName && window[globalName]) return resolve(window[globalName]);

      const existed = Array.from(document.scripts).find((s) => s.src === src);
      if (existed) {
        const start = Date.now();
        const timer = setInterval(() => {
          if (globalName && window[globalName]) {
            clearInterval(timer);
            resolve(window[globalName]);
            return;
          }
          if (Date.now() - start > 6000) {
            clearInterval(timer);
            reject(new Error(`load-timeout: ${src}`));
          }
        }, 120);
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve(window[globalName]);
      script.onerror = () => reject(new Error(`load-failed: ${src}`));
      document.head.appendChild(script);
    });
  }

  async function ensureHtml2CanvasDep() {
    if (!html2canvasLib) {
      if (typeof html2canvas !== "undefined") html2canvasLib = html2canvas;
      else if (window.html2canvas) html2canvasLib = window.html2canvas;
    }
    if (html2canvasLib) return;
    await loadScriptOnce(CONFIG.html2canvasUrl, "html2canvas");
    html2canvasLib =
      (typeof html2canvas !== "undefined" && html2canvas) ||
      window.html2canvas ||
      null;
    if (!html2canvasLib) throw new Error("html2canvas-not-ready");
  }

  async function ensureZipDep() {
    if (!fflateLib) {
      if (typeof fflate !== "undefined") fflateLib = fflate;
      else if (window.fflate) fflateLib = window.fflate;
    }
    if (fflateLib && typeof fflateLib.zipSync === "function") return;

    if (!JSZipLib) {
      if (typeof JSZip !== "undefined") JSZipLib = JSZip;
      else if (window.JSZip) JSZipLib = window.JSZip;
    }
    if (JSZipLib) return;

    await loadScriptOnce(
      "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js",
      "fflate",
    );
    fflateLib = (typeof fflate !== "undefined" && fflate) || window.fflate || null;
    if (fflateLib && typeof fflateLib.zipSync === "function") return;

    await loadScriptOnce(CONFIG.jsZipUrl, "JSZip");
    JSZipLib = (typeof JSZip !== "undefined" && JSZip) || window.JSZip || null;
    if (!JSZipLib) throw new Error("zip-engine-not-ready");
  }

  function getMode() {
    const href = location.href;
    if (href.includes(CONFIG.launchTestPathHint)) return "launchtest";
    if (href.includes(CONFIG.createTestPathHint)) return "createtest";
    return "other";
  }

  function onUrlChange(cb) {
    let last = location.href;

    const check = () => {
      const now = location.href;
      if (now !== last) {
        last = now;
        cb(now);
      }
    };

    // 1) Poll as a fallback
    const pollId = setInterval(check, 500);

    // 2) Hook SPA history changes
    const _pushState = history.pushState;
    const _replaceState = history.replaceState;
    history.pushState = function () {
      _pushState.apply(this, arguments);
      setTimeout(check, 0);
    };
    history.replaceState = function () {
      _replaceState.apply(this, arguments);
      setTimeout(check, 0);
    };
    window.addEventListener("popstate", () => setTimeout(check, 0));

    return () => clearInterval(pollId);
  }

  function setNativeValue(inputEl, value) {
    // Angular/React often intercept value setter
    const proto = Object.getPrototypeOf(inputEl);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && typeof desc.set === "function") {
      desc.set.call(inputEl, value);
    } else {
      inputEl.value = value;
    }
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ===== Exam Name (Subject + Chapter) =====
  function getStandardValueByHeader(headerText) {
    const container = document.querySelector(CONFIG.standardContainerSelector);
    if (!container) return "";

    const standards = Array.from(container.querySelectorAll(".standard"));
    for (const s of standards) {
      const headerEl = s.querySelector(".standard-header");
      const descEl = s.querySelector(".standard-description");
      const header = (headerEl?.innerText || "").trim();
      const desc = (descEl?.innerText || "").trim();
      if (header.toLowerCase() === headerText.toLowerCase()) return desc;
    }
    return "";
  }

  function captureExamName() {
    examSubject =
      normalizeChoiceText(getStandardValueByHeader("Subject")) || examSubject;
    examChapter =
      normalizeChoiceText(getStandardValueByHeader("Chapter")) || examChapter;

    if (examSubject && examChapter) examName = `${examSubject}: ${examChapter}`;
    else if (examSubject) examName = examSubject;
    else if (examChapter) examName = examChapter;
    else examName = "UWorld";

    setStatus(`Exam: ${examName}`);
    return examName;
  }

  // ===== Choices A-D =====
  function normalizeChoiceText(t) {
    return (t || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeQuestionText(t) {
    // Replace NBSP (\xa0) and normalize whitespace/newlines for stable capture
    return (t || "")
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getChoices() {
    const out = { a: "", b: "", c: "", d: "" };

    const byHighlight = (n) => {
      const el = document.querySelector(`${CONFIG.choiceHighlightPrefix}${n}`);
      if (!el) return "";
      return normalizeChoiceText(el.innerText);
    };

    out.a = byHighlight(1);
    out.b = byHighlight(2);
    out.c = byHighlight(3);
    out.d = byHighlight(4);

    if (out.a && out.b && out.c && out.d) return out;

    const table = document.querySelector(CONFIG.choiceTableSelector);
    if (table) {
      const cells = Array.from(
        table.querySelectorAll("td.answer-choice-content"),
      );
      const texts = cells
        .map((c) => normalizeChoiceText(c.innerText))
        .filter(Boolean);
      if (texts.length >= 4) {
        out.a = out.a || texts[0];
        out.b = out.b || texts[1];
        out.c = out.c || texts[2];
        out.d = out.d || texts[3];
      }
    }

    return out;
  }

  function clickElement(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function getChoiceRows() {
    const table = document.querySelector(CONFIG.choiceTableSelector);
    if (!table) return [];
    return Array.from(table.querySelectorAll("tr")).filter((row) =>
      row.querySelector("td.answer-choice-content"),
    );
  }

  function getRowLetter(row) {
    const txt = normalizeChoiceText(
      row?.querySelector("td.left-td")?.innerText || "",
    );
    const m = txt.match(/([A-D])\.?/i);
    return m ? m[1].toUpperCase() : "";
  }

  function letterByRowIndex(row) {
    const rows = getChoiceRows();
    const idx = rows.indexOf(row);
    return idx >= 0 && idx < 4 ? "ABCD"[idx] : "";
  }

  function pickRandomChoice() {
    const rows = getChoiceRows();
    if (!rows.length) return { ok: false, reason: "no-choice-row", letter: "" };

    const enabledRows = rows.filter(
      (row) =>
        !row.querySelector("mat-radio-button.mat-radio-disabled") &&
        !!row.querySelector("mat-radio-button, input.mat-radio-input"),
    );
    const pool = enabledRows.length ? enabledRows : rows;
    const row = pool[Math.floor(Math.random() * pool.length)];
    const letter = getRowLetter(row) || letterByRowIndex(row);

    const clickTarget =
      row.querySelector("mat-radio-button label.mat-radio-label") ||
      row.querySelector("mat-radio-button") ||
      row.querySelector("input.mat-radio-input") ||
      row;

    clickElement(clickTarget);
    return { ok: true, reason: "selected", letter };
  }

  function getSubmitBtn() {
    const btn = document.querySelector(CONFIG.submitSelector);
    if (!btn) return null;
    const disabled =
      btn.disabled ||
      (btn.getAttribute("aria-disabled") || "").toLowerCase() === "true" ||
      btn.classList.contains("disabled");
    const notVisible = btn.offsetParent === null;
    if (disabled || notVisible) return null;
    return btn;
  }

  function hasResultRendered() {
    const stats = document.querySelector(CONFIG.statsBarSelector);
    const explanation = document.querySelector(
      CONFIG.explanationContainerSelector,
    );
    return !!(stats && explanation);
  }

  async function waitForResultRender(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stopRequested) return { ok: false, reason: "stopped" };
      if (hasResultRendered()) return { ok: true, reason: "rendered" };
      await sleep(CONFIG.pollIntervalMs);
    }
    return { ok: false, reason: "timeout" };
  }

  async function ensureSubmittedAndRendered() {
    const picked = pickRandomChoice();
    if (!picked.ok) {
      return {
        ok: false,
        selectedChoice: "",
        reason: picked.reason,
        didSubmit: false,
      };
    }
    await sleep(CONFIG.afterSelectDelayMs);

    const submitBtn = getSubmitBtn();
    if (!submitBtn) {
      return {
        ok: false,
        selectedChoice: picked.letter,
        reason: "no-submit-btn-after-pick",
        didSubmit: false,
      };
    }

    clickElement(submitBtn);
    const waited = await waitForResultRender(CONFIG.submitWaitTimeoutMs);
    return {
      ok: waited.ok,
      selectedChoice: picked.letter,
      reason: waited.reason,
      didSubmit: true,
    };
  }

  function hasCompleteAnswerData(data) {
    return !!data.correctAnswer && !!data.explanationReady;
  }

  async function waitForAnswerData(selectedChoice, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stopRequested) return { ok: false, reason: "stopped" };
      const correctAnswer = getCorrectAnswerLetter(selectedChoice);
      const explanation = getExplanationSnapshot();
      const data = {
        correctAnswer,
        explanationReady: explanation.ready,
      };
      if (hasCompleteAnswerData(data))
        return { ok: true, reason: "ready", data };
      await sleep(CONFIG.pollIntervalMs);
    }
    const explanation = getExplanationSnapshot();
    return {
      ok: false,
      reason: "answer-data-timeout",
      data: {
        correctAnswer: getCorrectAnswerLetter(selectedChoice),
        explanationReady: explanation.ready,
      },
    };
  }

  async function ensureSubmittedAndAnswerCaptured() {
    let selectedChoice = "";
    let lastReason = "unknown";
    let hasSubmitted = false;

    for (
      let attempt = 1;
      attempt <= CONFIG.answerReadyRetryCount + 1;
      attempt++
    ) {
      const submitted = await ensureSubmittedAndRendered();
      selectedChoice = selectedChoice || submitted.selectedChoice || "";
      lastReason = submitted.reason;
      hasSubmitted = hasSubmitted || !!submitted.didSubmit;

      if (!submitted.ok) {
        if (stopRequested) break;
        await sleep(CONFIG.afterSelectDelayMs);
        continue;
      }

      const waited = await waitForAnswerData(
        selectedChoice,
        CONFIG.answerReadyTimeoutMs,
      );
      if (waited.ok) {
        if (!hasSubmitted) {
          lastReason = "not-submitted-yet";
          await sleep(CONFIG.afterSelectDelayMs);
          continue;
        }
        return {
          ok: true,
          selectedChoice,
          correctAnswer: waited.data.correctAnswer || "",
          explanationReady: waited.data.explanationReady,
          reason: "ready",
        };
      }

      lastReason = waited.reason;
      if (stopRequested) break;
      await sleep(CONFIG.afterSelectDelayMs);
    }

    return {
      ok: false,
      selectedChoice,
      correctAnswer: getCorrectAnswerLetter(selectedChoice) || "",
      explanationReady: false,
      reason: lastReason,
    };
  }

  async function captureAnswerUntilReady() {
    let round = 0;
    while (!stopRequested) {
      round += 1;
      const answerState = await ensureSubmittedAndAnswerCaptured();
      if (answerState.ok && hasCompleteAnswerData(answerState)) {
        return answerState;
      }

      setStatus(
        `Waiting answer/explanation (${answerState.reason || "retry"})... try ${round}`,
      );
      await sleep(600);
    }

    return {
      ok: false,
      selectedChoice: "",
      correctAnswer: "",
      explanationReady: false,
      reason: "stopped",
    };
  }

  function getCorrectAnswerLetter(selectedChoice = "") {
    const fromIncorrectStats = normalizeChoiceText(
      document.querySelector(CONFIG.incorrectAnswerSelector)?.innerText || "",
    );
    const incorrectMatch = fromIncorrectStats.match(/\b([A-D])\b/i);
    if (incorrectMatch) return incorrectMatch[1].toUpperCase();

    const rows = getChoiceRows();
    for (const row of rows) {
      const hasCheck = !!row.querySelector("i.fa-check, i.fal.fa-check");
      if (!hasCheck) continue;
      const letter = getRowLetter(row);
      if (letter) return letter;
    }

    return selectedChoice || "";
  }

  function getExplanationSnapshot() {
    const strictBlock = document.querySelector(CONFIG.explanationBlockSelector);
    if (!strictBlock) return { ready: false, el: null };

    const explanation = strictBlock.querySelector(
      CONFIG.explanationContainerSelector,
    );
    if (!explanation) return { ready: false, el: strictBlock };

    const keyContent =
      explanation.querySelector("#first-explanation") ||
      explanation.querySelector("#explanation") ||
      explanation.querySelector(".tab-content") ||
      explanation;

    const text = normalizeChoiceText(keyContent.innerText || "");
    const ready = text.length >= CONFIG.explanationMinTextLength;
    return { ready, el: strictBlock };
  }

  function findBestScrollableIn(root) {
    if (!root) return null;
    const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
    let best = null;
    let bestDelta = 0;

    for (const el of nodes) {
      const delta = (el.scrollHeight || 0) - (el.clientHeight || 0);
      if (delta <= 20) continue;
      const st = getComputedStyle(el);
      const oy = st?.overflowY || "";
      const scrollable =
        oy === "auto" || oy === "scroll" || oy === "overlay" || delta > 120;
      if (!scrollable) continue;
      if (delta > bestDelta) {
        best = el;
        bestDelta = delta;
      }
    }
    return best || root;
  }

  async function waitImagesSettled(root, timeoutMs) {
    if (!root) return true;
    const imgs = Array.from(root.querySelectorAll("img"));
    if (!imgs.length) return true;

    imgs.forEach((img) => {
      if (img.__uworld_img_bind) return;
      img.__uworld_img_bind = true;
      img.addEventListener(
        "error",
        () => {
          img.dataset.uworldImgErr = "1";
        },
        { once: true },
      );
    });

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const allDone = imgs.every(
        (img) =>
          img.complete ||
          img.dataset.uworldImgErr === "1" ||
          img.naturalWidth > 0,
      );
      if (allDone) return true;
      await sleep(120);
    }
    return false;
  }

  function buildScrollStops(scrollEl) {
    const total = Math.max(scrollEl.scrollHeight, scrollEl.clientHeight);
    const view = Math.max(1, scrollEl.clientHeight);
    const stops = [];
    for (let y = 0; y < total; y += view) stops.push(y);
    const last = Math.max(0, total - view);
    if (!stops.length || stops[stops.length - 1] !== last) stops.push(last);
    return stops;
  }

  async function warmupScrollToLoadAll(scrollEl) {
    const orig = scrollEl.scrollTop;
    const stops = buildScrollStops(scrollEl);
    for (const y of stops) {
      if (stopRequested) break;
      scrollEl.scrollTop = y;
      await sleep(CONFIG.screenshotScrollSettleMs);
      await waitImagesSettled(scrollEl, 900);
    }
    scrollEl.scrollTop = 0;
    await sleep(CONFIG.screenshotScrollSettleMs);
    await waitImagesSettled(scrollEl, 900);
    if (orig > 0) scrollEl.scrollTop = orig;
  }

  async function stitchScrollableToCanvas(scrollEl, crossOriginImgMap) {
    const scale = Math.min(CONFIG.screenshotScaleMax, window.devicePixelRatio || 1.5);
    const total = Math.max(scrollEl.scrollHeight, scrollEl.clientHeight);
    const view = Math.max(1, scrollEl.clientHeight);
    const width = Math.max(1, scrollEl.clientWidth);

    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(width * scale));
    out.height = Math.max(1, Math.round(total * scale));
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("canvas-context-failed");

    const orig = scrollEl.scrollTop;
    const stops = buildScrollStops(scrollEl);
    for (const y of stops) {
      if (stopRequested) throw new Error("stopped");
      scrollEl.scrollTop = y;
      await sleep(CONFIG.screenshotScrollSettleMs);

      const segHeight = Math.min(view, total - y);
      const shot = await html2canvasLib(scrollEl, {
        backgroundColor: "#ffffff",
        useCORS: true,
        allowTaint: false,
        scale,
        logging: false,
        width,
        height: segHeight,
        onclone: (doc) => {
          if (!crossOriginImgMap || !crossOriginImgMap.size) return;
          const imgs = doc.querySelectorAll("img[src]");
          imgs.forEach((img) => {
            const src = img.getAttribute("src") || "";
            let abs = "";
            try {
              abs = new URL(src, location.href).href;
            } catch (e) {
              abs = src;
            }
            const dataUrl = crossOriginImgMap.get(abs);
            if (dataUrl) img.setAttribute("src", dataUrl);
          });
        },
      });

      const dy = Math.round(y * scale);
      const drawH = Math.round(segHeight * scale);
      ctx.drawImage(
        shot,
        0,
        0,
        shot.width,
        Math.min(shot.height, drawH),
        0,
        dy,
        out.width,
        Math.min(shot.height, drawH),
      );
    }

    scrollEl.scrollTop = orig;
    return out;
  }

  async function captureExplanationPngForQuestion(index) {
    const snap = getExplanationSnapshot();
    if (!snap.ready || !snap.el) {
      return { ok: false, reason: "explanation-not-ready", fileName: "" };
    }
    await ensureHtml2CanvasDep();
    const scrollEl = findBestScrollableIn(snap.el) || snap.el;
    await waitImagesSettled(snap.el, CONFIG.screenshotImageWaitTimeoutMs);
    await warmupScrollToLoadAll(scrollEl);
    const crossOriginImgMap = await buildCrossOriginImgDataMap(snap.el);
    const canvas = await stitchScrollableToCanvas(scrollEl, crossOriginImgMap);

    let blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png", 1),
    );
    if (!blob) {
      const dataUrl = canvas.toDataURL("image/png");
      blob = blobFromDataUrl(dataUrl);
    }
    if (!blob) return { ok: false, reason: "png-encode-failed", fileName: "" };

    const fileName = `imgs/q${pad4(index)}.png`;
    return { ok: true, reason: "captured", fileName, blob };
  }

  async function captureExplanationPngUntilReady(index) {
    let lastErr = "";
    for (let attempt = 1; attempt <= CONFIG.screenshotRetryCount; attempt++) {
      if (stopRequested) return { ok: false, reason: "stopped", fileName: "" };
      try {
        const cap = await captureExplanationPngForQuestion(index);
        if (cap.ok) return cap;
        lastErr = cap.reason || lastErr;
      } catch (err) {
        lastErr = err?.message || String(err);
      }
      await sleep(CONFIG.screenshotRetryDelayMs);
    }
    return {
      ok: false,
      reason: `screenshot-timeout${lastErr ? ` (${lastErr})` : ""}`,
      fileName: "",
    };
  }

  // ===== Download =====
  function buildPayload() {
    return {
      meta: {
        source: "UWorld (captured from DOM #questionText + choices + right-content screenshot)",
        capturedAt: new Date().toISOString(),
        count: questions.length,
        screenshotCount: screenshotFiles.length,
        url: location.href,
        examName,
        subject: examSubject,
        chapter: examChapter,
      },
      questions: [...questions],
    };
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFilename(filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
  }

  async function triggerBlobDownloadBestEffort(blob, filename) {
    const safeName = sanitizeFilename(filename);
    if (typeof GM_download === "function") {
      const url = URL.createObjectURL(blob);
      try {
        await withTimeout(
          new Promise((resolve, reject) => {
            let done = false;
            const finish = (ok, err) => {
              if (done) return;
              done = true;
              if (ok) resolve(true);
              else reject(err || new Error("gm_download_failed"));
            };
            GM_download({
              url,
              name: safeName,
              saveAs: false,
              onload: () => finish(true),
              onerror: (e) =>
                finish(
                  false,
                  new Error(`gm_download_error: ${e?.error || "unknown"}`),
                ),
              ontimeout: () => finish(false, new Error("gm_download_timeout")),
            });
          }),
          8000,
          "gm-download",
        );
        return;
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    }
    triggerBlobDownload(blob, safeName);
  }

  async function downloadZip() {
    if (isDownloading) {
      setStatus("Download already in progress...");
      return;
    }
    isDownloading = true;
    const started = Date.now();
    try {
      const payload = buildPayload();
      const stamp = `${todayYMD()}_${nowHMS()}`;
      const base = sanitizeFilename(`${examName}_${stamp}`);
      setStatus("Preparing ZIP...");
      await withTimeout(ensureZipDep(), 8000, "ensure-zip-dep");
      console.log("[UWorld Export] zip stage: deps-ready");

      let totalBytes = 0;
      const filesU8 = {};
      filesU8[`${base}.json`] = new TextEncoder().encode(
        JSON.stringify(payload, null, 2),
      );
      for (let i = 0; i < screenshotFiles.length; i++) {
        const f = screenshotFiles[i];
        if (!f || !f.name || !f.blob) continue;
        totalBytes += Number(f.blob.size || 0);
        const u8 = await withTimeout(
          blobToUint8Array(f.blob),
          12000,
          "blob-read",
        );
        filesU8[f.name] = u8;
      }
      const mb = (totalBytes / (1024 * 1024)).toFixed(1);
      setStatus(`Building ZIP... 0% (${screenshotFiles.length} imgs, ${mb} MB)`);

      let zipBlob = null;
      if (fflateLib && typeof fflateLib.zipSync === "function") {
        const zipU8 = await withTimeout(
          Promise.resolve().then(() =>
            fflateLib.zipSync(filesU8, { level: 0 }),
          ),
          12000,
          "fflate-zip-generate",
        );
        zipBlob = new Blob([zipU8], { type: "application/zip" });
      } else {
        const zip = new JSZipLib();
        Object.entries(filesU8).forEach(([name, u8]) => {
          zip.file(name, u8, { binary: true });
        });
        let lastPct = 0;
        zipBlob = await withTimeout(
          zip.generateAsync(
            {
              type: "blob",
              compression: "STORE",
            },
            (meta) => {
              const p = Math.floor(meta.percent || 0);
              if (p !== lastPct) {
                lastPct = p;
                setStatus(`Building ZIP... ${p}%`);
              }
            },
          ),
          30000,
          "jszip-generate",
        );
      }
      console.log(
        "[UWorld Export] zip stage: generated",
        `size=${Math.round((zipBlob.size || 0) / 1024)}KB`,
        `elapsed=${Date.now() - started}ms`,
      );

      const zipName = `${base}.zip`;
      setStatus("Saving ZIP...");
      await triggerBlobDownloadBestEffort(zipBlob, zipName);
      setStatus(
        `Downloaded ZIP: ${zipName} (${payload.meta.count} qs, ${screenshotFiles.length} imgs)`,
      );
    } catch (err) {
      const msg = err?.message || String(err);
      setStatus(`ZIP failed (${msg}), fallback to separate files...`);
      console.error("[UWorld Export] zip download failed:", err);
      try {
        const payload = buildPayload();
        const stamp = `${todayYMD()}_${nowHMS()}`;
        const base = sanitizeFilename(`${examName}_${stamp}`);
        const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        });
        await triggerBlobDownloadBestEffort(jsonBlob, `${base}.json`);
        for (let i = 0; i < screenshotFiles.length; i++) {
          const f = screenshotFiles[i];
          if (!f || !f.blob) continue;
          const num = String(i + 1).padStart(4, "0");
          await triggerBlobDownloadBestEffort(
            f.blob,
            `${base}_img_${num}.png`,
          );
          await sleep(80);
        }
        setStatus(
          `Fallback downloaded: 1 JSON + ${screenshotFiles.length} images`,
        );
      } catch (e2) {
        setStatus(`Download failed: ${e2?.message || String(e2)}`);
        console.error("[UWorld Export] fallback download failed:", e2);
      }
    } finally {
      isDownloading = false;
    }
  }

  // ===== UI =====
  let uiRoot, statusEl, startBtn, stopBtn, dlBtn, clearBtn;
  let currentMode = "other";
  let createtestObserver = null;
  let createtestBound = false;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log("[UWorld Export]", msg);
  }

  function updateStats() {
    const stats = document.getElementById("__uworld_export_stats");
    if (stats) stats.textContent = `Captured: ${questions.length}`;
  }

  function createUI() {
    // Only show panel on launchtest
    if (currentMode !== "launchtest") return;
    if (uiRoot) return;

    uiRoot = document.createElement("div");
    uiRoot.style.position = "fixed";
    uiRoot.style.right = "16px";
    uiRoot.style.bottom = "16px";
    uiRoot.style.zIndex = "999999";
    uiRoot.style.background = "rgba(20,20,20,0.92)";
    uiRoot.style.color = "#fff";
    uiRoot.style.padding = "12px";
    uiRoot.style.borderRadius = "12px";
    uiRoot.style.fontSize = "13px";
    uiRoot.style.minWidth = "280px";
    uiRoot.style.boxShadow = "0 6px 18px rgba(0,0,0,0.35)";

    const title = document.createElement("div");
    title.textContent = "UWorld Export";
    title.style.fontWeight = "700";
    title.style.marginBottom = "6px";

    statusEl = document.createElement("div");
    statusEl.textContent = "Loading exam...";
    statusEl.style.opacity = "0.9";
    statusEl.style.marginBottom = "10px";

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.flexWrap = "wrap";

    function mkBtn(text) {
      const b = document.createElement("button");
      b.textContent = text;
      b.style.cursor = "pointer";
      b.style.border = "1px solid rgba(255,255,255,0.18)";
      b.style.background = "rgba(255,255,255,0.08)";
      b.style.color = "#fff";
      b.style.padding = "6px 10px";
      b.style.borderRadius = "10px";
      b.style.fontSize = "12px";
      return b;
    }

    startBtn = mkBtn("Start");
    stopBtn = mkBtn("Stop");
    dlBtn = mkBtn("Download ZIP");
    clearBtn = mkBtn("Clear");

    stopBtn.disabled = true;

    startBtn.onclick = () => start();
    stopBtn.onclick = () => stop();
    dlBtn.onclick = async () => {
        if (isRunning) {
        setStatus("Please Stop first, then click Download ZIP.");
        return;
      }
      await downloadZip();
    }; // 保留手動，但正常不需要
    clearBtn.onclick = () => {
      questions.length = 0;
      screenshotFiles.length = 0;
      seen.clear();
      updateStats();
      setStatus(`Exam: ${examName} (cleared)`);
    };

    row.appendChild(startBtn);
    row.appendChild(stopBtn);
    row.appendChild(dlBtn);
    row.appendChild(clearBtn);

    const stats = document.createElement("div");
    stats.style.marginTop = "10px";
    stats.style.opacity = "0.85";
    stats.id = "__uworld_export_stats";
    stats.textContent = "Captured: 0";

    uiRoot.appendChild(title);
    uiRoot.appendChild(statusEl);
    uiRoot.appendChild(row);
    uiRoot.appendChild(stats);

    document.body.appendChild(uiRoot);
  }

  function destroyUI() {
    if (!uiRoot) return;
    try {
      uiRoot.remove();
    } catch (e) {
      // ignore
    }
    uiRoot = null;
    statusEl = null;
    startBtn = null;
    stopBtn = null;
    dlBtn = null;
    clearBtn = null;
  }

  function readCreateTestCount() {
    const el = document.querySelector(CONFIG.createTestCountSelector);
    const txt = (el?.innerText || "").trim();
    const n = parseInt(txt, 10);
    return Number.isFinite(n) ? n : null;
  }

  function getCreateTestInput() {
    const el = document.querySelector(CONFIG.createTestInputSelector);
    return el || null;
  }

  function autofillCreateTestInputFromCount() {
    const n = readCreateTestCount();
    const input = getCreateTestInput();
    if (!input || n == null) return false;
    setNativeValue(input, String(n));
    console.log("[UWorld Export][createtest] Autofilled max per block =", n);
    return true;
  }

  function bindCreateTestAutoFill() {
    if (createtestBound) return;
    createtestBound = true;

    const bindOne = (root = document) => {
      const inputs = root.querySelectorAll(
        'mat-checkbox input[type="checkbox"].mat-checkbox-input',
      );
      inputs.forEach((cb) => {
        if (cb.__uworld_autofill_bound) return;
        cb.__uworld_autofill_bound = true;

        const handler = () => {
          // UWorld/Angular may update the question-count-div after the click
          setTimeout(() => {
            autofillCreateTestInputFromCount();
          }, CONFIG.createTestAutofillDelayMs);
        };

        cb.addEventListener("click", handler, true);
        cb.addEventListener("change", handler, true);
      });
    };

    // Initial bind
    bindOne(document);

    // Observe DOM changes because this is an SPA
    createtestObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const node of m.addedNodes) {
            if (node && node.nodeType === 1) bindOne(node);
          }
        }
      }
    });

    createtestObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Also try once shortly after load
    setTimeout(() => autofillCreateTestInputFromCount(), 300);
  }

  function unbindCreateTestAutoFill() {
    createtestBound = false;
    if (createtestObserver) {
      try {
        createtestObserver.disconnect();
      } catch (e) {}
    }
    createtestObserver = null;
  }

  function applyMode() {
    currentMode = getMode();

    if (currentMode === "launchtest") {
      // show panel
      createUI();

      // capture exam name and show it
      (async () => {
        for (let i = 0; i < 160; i++) {
          captureExamName();
          if (examName && examName !== "UWorld") break;
          await sleep(100);
        }
        setStatus(`Exam: ${examName}`);
      })();

      // ensure createtest bindings are off
      unbindCreateTestAutoFill();
      return;
    }

    // Not launchtest -> remove panel if any
    destroyUI();

    // createtest -> enable auto-fill bindings
    if (currentMode === "createtest") {
      bindCreateTestAutoFill();
    } else {
      unbindCreateTestAutoFill();
    }
  }

  // ===== Main Loop =====
  async function start() {
    if (isRunning) return;

    stopRequested = false;
    isRunning = true;

    startBtn.disabled = true;
    stopBtn.disabled = false;

    setStatus(`Running: ${examName}`);

    // 等題目元素存在
    for (let i = 0; i < 200; i++) {
      if (getQuestionEl()) break;
      await sleep(100);
    }

    let currentText = getQuestionText();
    if (!currentText) {
      setStatus("Error: #questionText not found / empty");
      isRunning = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      return;
    }

    let endedBy = "unknown";

    for (let step = 1; step <= CONFIG.maxQuestions; step++) {
      if (stopRequested) {
        endedBy = "stopped";
        break;
      }

      currentText = getQuestionText();
      const choices = getChoices();

      // ✅ 不再存 per-question capturedAt
      if (currentText && !seen.has(currentText)) {
        const answerState = await captureAnswerUntilReady();
        if (!answerState.ok) {
          setStatus(
            `Stopped before answer/explanation ready (${answerState.reason}).`,
          );
          endedBy = "stopped";
          break;
        }

        const shot = await captureExplanationPngUntilReady(questions.length + 1);
        if (!shot.ok || !shot.blob) {
          setStatus(
            `Stopped before screenshot ready (${shot.reason}). Check console for details.`,
          );
          console.error("[UWorld Export] screenshot failed:", shot);
          endedBy = "stopped";
          break;
        }

        seen.add(currentText);
        screenshotFiles.push({ name: shot.fileName, blob: shot.blob });
        questions.push({
          index: questions.length + 1,
          question: currentText,
          choices: {
            a: choices.a || "",
            b: choices.b || "",
            c: choices.c || "",
            d: choices.d || "",
          },
          selectedChoice: answerState.selectedChoice || "",
          correctAnswer: answerState.correctAnswer || "",
          explanationImageFile: shot.fileName,
        });
        updateStats();
      }

      const nextEl = getNextEl();
      if (!nextEl) {
        endedBy = "no-next";
        setStatus(
          `Finished (no Next). Auto-downloading... (${questions.length} qs)`,
        );
        await downloadZip();
        break;
      }

      const prevText = currentText;

      clickNext(nextEl);
      await sleep(CONFIG.afterClickDelayMs);

      const waitRes = await waitForQuestionChangeByPolling(
        prevText,
        CONFIG.waitTimeoutMs,
      );
      if (!waitRes.ok) {
        endedBy = waitRes.reason;

        // ✅ timeout 也自動下載（把已抓到的先存起來）
        if (waitRes.reason === "timeout") {
          setStatus(
            `Timeout waiting next question. Auto-downloading partial... (${questions.length} qs)`,
          );
          await downloadZip();
        } else if (waitRes.reason === "stopped") {
          setStatus(`Stopped. Captured ${questions.length}.`);
        }
        break;
      }

      await sleep(CONFIG.loopDelayMs);
    }

    isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;

    if (endedBy === "stopped") return;

    // 如果跑到 maxQuestions 也自動下載（保險）
    if (questions.length > 0 && endedBy === "unknown") {
      setStatus(`Reached limit. Auto-downloading... (${questions.length} qs)`);
      await downloadZip();
    }
  }

  function stop() {
    stopRequested = true;
  }

  // ===== Helpers =====
  function todayYMD() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function nowHMS() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}${mm}${ss}`;
  }

  function sanitizeFilename(name) {
    return name
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getQuestionEl() {
    return document.querySelector(CONFIG.questionSelector);
  }

  function getQuestionText() {
    const el = getQuestionEl();
    if (!el) return "";
    return normalizeQuestionText(el.innerText || "");
  }

  function getNextEl() {
    const el = document.querySelector(CONFIG.nextSelector);
    if (!el) return null;

    const ariaDisabled =
      (el.getAttribute("aria-disabled") || "").toLowerCase() === "true";
    const classDisabled = el.classList.contains("disabled");
    const notVisible = el.offsetParent === null;

    if (ariaDisabled || classDisabled || notVisible) return null;
    return el;
  }

  function clickNext(el) {
    clickElement(el);
  }

  // 更穩：輪詢等題幹變化（SPA/Angular 常常會整塊重 render）
  async function waitForQuestionChangeByPolling(prevText, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (stopRequested) return { ok: false, reason: "stopped" };
      const now = getQuestionText();
      if (now && now !== prevText) return { ok: true, reason: "changed" };
      await sleep(CONFIG.pollIntervalMs);
    }
    return { ok: false, reason: "timeout" };
  }

  // ===== init =====
  // Apply mode for the current route
  applyMode();

  // Re-apply mode when SPA URL changes
  onUrlChange(() => {
    // If user is running, do not auto-stop; just keep capture logic available on launchtest.
    // If they navigate away, UI will disappear.
    applyMode();
  });

  // console helpers
  window.__uworldExportStart = start;
  window.__uworldExportStop = stop;
  window.__uworldExportDownload = downloadZip;
})();

// 审核小助手
// 列表页:自动点开最上方的「审查」。
// 详情页:按 A=批准(通过)、D=拒绝。完成后网站自动回列表页,再自动点开下一个。

(function () {
  "use strict";

  const VERSION = "v2.0"; // 改代码时记得 +1,方便确认是否生效
  const CLICK_COOLDOWN = 1500; // 同一动作的最小间隔,防连点
  let lastReviewClickAt = 0;
  let lastDecisionAt = 0;
  let lastRowDecisionAt = 0; // 列表页「按行通过/拒绝」的防连点
  let lastUrl = location.href;
  let paused = false; // 暂停时不自动打开审查

  // 只在「未成年审查 / minor review」标签激活。
  // 列表页 URL 带 ?tab=minor_review;点开详情页可能不带 tab 参数,
  // 所以用「黏性」判定:见到 minor 标签就记住,其它 tab 就关掉,详情页沿用上次状态。
  function onMinorReview() {
    const m = location.href.match(/[?&]tab=([^&]+)/);
    if (m) {
      const isMinor = /minor/i.test(m[1]);
      try {
        sessionStorage.setItem("__rh_minor", isMinor ? "1" : "0");
      } catch (e) {}
      return isMinor;
    }
    // 明确排除:回顾历史 / 统计等页面
    if (/\/review\/history/i.test(location.href)) return false;
    // 无 tab 参数:仅当当前确实是详情页(有批准+拒绝按钮)才沿用黏性状态。
    // 这样 history、统计弹窗等没有审查按钮的页面不会误触发。
    let sticky = false;
    try {
      sticky = sessionStorage.getItem("__rh_minor") === "1";
    } catch (e) {}
    return sticky && isDetailPage();
  }

  // 注:注入谷歌翻译组件的方案已移除 —— admin.fantacy.live 的 CSP 禁止加载
  // translate.google.com 脚本(script-src 'self'),此路不通,详见对话说明。

  // ---- 取按钮文字(处理 <font><font>…</font></font> 嵌套) ----
  function btnText(el) {
    return (el.textContent || "").replace(/\s+/g, "").trim();
  }

  // ---- 找按钮 ----
  function findReviewButtons() {
    // 列表里的蓝色小按钮,文字含「审查」或 Review
    const all = Array.from(
      document.querySelectorAll("button.MuiButton-colorPrimary")
    );
    return all.filter((b) => {
      const t = btnText(b);
      return (t.includes("审查") || /review/i.test(t)) && isVisible(b);
    });
  }

  function findApproveButton() {
    // 绿色 = 批准/通过
    const b = Array.from(
      document.querySelectorAll("button.MuiButton-colorSuccess")
    ).find(isVisible);
    if (b) return b;
    // 兜底:按文字
    return Array.from(document.querySelectorAll("button")).find(
      (x) => isVisible(x) && /(批准|通过|approve|pass)/i.test(btnText(x))
    );
  }

  function findRejectButton() {
    // 红色 = 拒绝
    const b = Array.from(
      document.querySelectorAll("button.MuiButton-colorError")
    ).find(isVisible);
    if (b) return b;
    return Array.from(document.querySelectorAll("button")).find(
      (x) => isVisible(x) && /(拒绝|reject|deny)/i.test(btnText(x))
    );
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && !el.disabled;
  }

  // ======== 列表页「鼠标悬停行 + 按 A/D 决策」相关 ========
  // 每一行是一个含 border-b 的 flex 容器;里面自带 经过(绿)/ 拒绝(红) 等行内按钮。
  let hoverRow = null; // 鼠标当前所在的那一行
  let lastMouseX = 0;
  let lastMouseY = 0;

  // 是否在「可按行决策」的列表页。
  // 仅 Character(?tab=character) 与 Multi-Character(?tab=multi_character) 两个 tab 启用。
  // Plot / Plot Card / Private Minor Review 一律不启用;minor 老流程保持原样。
  function isListPage() {
    if (/\/review\/history/i.test(location.href)) return false;
    if (onMinorReview()) return false;
    // 注意:不能用 isDetailPage() 排除 —— 列表页每行都有 Pass/Reject 按钮,
    // 会被 isDetailPage() 误判成详情页,导致面板消失。这两个 tab 一律当列表页。
    return /[?&]tab=(character|multi_character)\b/i.test(location.href);
  }

  // 从某个元素往上找“行容器”:带 border-b 的那层 flex。
  function findRowFrom(el) {
    let node = el;
    while (node && node !== document.body) {
      if (
        node.nodeType === 1 &&
        node.classList &&
        node.classList.contains("border-b") &&
        /\bflex\b/.test(node.className)
      ) {
        // 行内要确实含有 Pass 或 Reject 按钮才算一行(排除表头/无决策按钮的容器)
        if (findRowApprove(node) || findRowReject(node)) {
          return node;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  // 在指定行内找 通过(绿=Pass) / 拒绝(红=Reject) 按钮。
  // 只用颜色类判定:一行里绿色按钮只有 Pass、红色只有 Reject,足够区分。
  // 【勿加文字校验】界面被谷歌翻译改写(Pass→经过),任何按文字匹配都会失效。
  function findRowApprove(row) {
    if (!row) return null;
    return Array.from(
      row.querySelectorAll("button.MuiButton-colorSuccess")
    ).find(isVisible);
  }
  function findRowReject(row) {
    if (!row) return null;
    return Array.from(
      row.querySelectorAll("button.MuiButton-colorError")
    ).find(isVisible);
  }

  // 高亮当前悬停行
  function highlightRow(row) {
    if (hoverRow === row) return;
    if (hoverRow) hoverRow.style.outline = "";
    hoverRow = row;
    if (hoverRow) {
      hoverRow.style.outline = "2px solid #2e7d32";
      hoverRow.style.outlineOffset = "-2px";
    }
  }

  // 用鼠标最后位置重新确定悬停行(DOM 变动后行元素可能已被替换)
  function refreshHoverRow() {
    const el = document.elementFromPoint(lastMouseX, lastMouseY);
    highlightRow(el ? findRowFrom(el) : null);
  }

  // 列表页按行决策
  function decideRow(kind) {
    if (!isListPage()) return false; // 交回给详情页逻辑
    const now = Date.now();
    if (now - lastRowDecisionAt < 600) return true; // 防手抖连按
    if (!hoverRow || !document.body.contains(hoverRow)) {
      refreshHoverRow();
    }
    if (!hoverRow) {
      setStatus("鼠标不在任何一行上");
      return true;
    }
    const btn = kind === "approve" ? findRowApprove(hoverRow) : findRowReject(hoverRow);
    if (!btn) {
      setStatus(kind === "approve" ? "该行没有通过按钮" : "该行没有拒绝按钮");
      return true;
    }
    lastRowDecisionAt = now;
    setStatus(kind === "approve" ? "✅ 已通过(当前行)" : "❌ 已拒绝(当前行)");
    btn.click();
    return true;
  }

  document.addEventListener(
    "mousemove",
    (e) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      if (!isListPage()) {
        if (hoverRow) highlightRow(null);
        return;
      }
      highlightRow(findRowFrom(e.target));
    },
    true
  );

  // ---- 是否有弹窗开着(拒绝理由框等)。有弹窗时绝不自动打开审查 ----
  function isModalOpen() {
    const sels = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      ".MuiModal-root",
      ".MuiDialog-root",
      ".MuiBackdrop-root",
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && isVisible(el)) return true;
    }
    return false;
  }

  // ---- 判定当前页面类型 ----
  // 详情页:同时存在批准(绿)和拒绝(红)按钮
  function isDetailPage() {
    return !!(findApproveButton() && findRejectButton());
  }

  // ---- 找主图(要鉴别的那张,src 含 /character/image/;头像是 /character/avatar/) ----
  function findMainImage() {
    const imgs = Array.from(document.querySelectorAll("img")).filter(isVisible);
    // 优先 /character/image/
    const main = imgs.find((im) => /\/character\/image\//i.test(im.src));
    if (main) return main;
    // 兜底:排除头像后,取页面里最大的一张可见图
    const cands = imgs.filter((im) => !/\/character\/avatar\//i.test(im.src));
    if (cands.length === 0) return null;
    return cands.sort(
      (a, b) =>
        b.getBoundingClientRect().height - a.getBoundingClientRect().height
    )[0];
  }

  // 记录已经居中过的详情页(按 URL),避免反复拉回,妨碍你自己滚动
  let centeredUrl = "";
  function centerMainImageOnce() {
    if (centeredUrl === location.href) return;
    const img = findMainImage();
    if (!img) return; // 图还没加载出来,下一轮再试
    centeredUrl = location.href;
    img.scrollIntoView({ block: "center", behavior: "smooth" });
    setStatus("图片已居中");
  }

  // ---- 动作 ----
  function autoOpenFirstReview() {
    const now = Date.now();
    if (now - lastReviewClickAt < CLICK_COOLDOWN) return;
    if (isModalOpen()) {
      // 拒绝理由框还开着,等你选完关闭再说
      setStatus("等待弹窗关闭(选拒绝理由)…");
      return;
    }
    const btns = findReviewButtons();
    if (btns.length === 0) return;
    // DOM 顺序 [0] 即最上方那条
    lastReviewClickAt = now;
    setStatus("打开第一个审查…");
    btns[0].click();
  }

  function decide(kind) {
    const now = Date.now();
    if (now - lastDecisionAt < 600) return; // 防手抖连按
    if (!isDetailPage()) {
      setStatus("当前不是详情页,忽略");
      return;
    }
    const btn = kind === "approve" ? findApproveButton() : findRejectButton();
    if (!btn) {
      setStatus(kind === "approve" ? "找不到批准按钮" : "找不到拒绝按钮");
      return;
    }
    lastDecisionAt = now;
    setStatus(kind === "approve" ? "✅ 已通过" : "❌ 已拒绝");
    btn.click();
  }

  // ---- 键盘 ----
  document.addEventListener(
    "keydown",
    (e) => {
      // 输入框内不触发
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable)
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "a" && k !== "d") return;

      // 列表页:按鼠标当前所在行决策(点该行的 经过/拒绝)
      if (isListPage()) {
        e.preventDefault();
        decideRow(k === "a" ? "approve" : "reject");
        return;
      }

      // 详情页:仅在未成年审查页响应 A/D(原逻辑)
      if (!onMinorReview()) return;
      e.preventDefault();
      decide(k === "a" ? "approve" : "reject");
    },
    true
  );

  // ---- 主循环:检测页面变化,列表页则自动打开 ----
  function tick() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // 页面切换,重置冷却,让新页面能立刻响应
      lastReviewClickAt = 0;
    }
    // 列表页(仅 character / multi_character):启用「悬停行 + A/D」,面板可见,不自动打开审查
    if (isListPage()) {
      // 进入列表页给一次操作提示(不覆盖刚发生的行决策反馈)
      if (!/已通过|已拒绝|该行|不在任何一行/.test(currentMsg)) {
        currentMsg = "列表页:悬停某行,A=通过 / D=拒绝";
      }
      renderPanel();
      // DOM 可能已重排(点了通过/翻页),用鼠标位置重新定位高亮行
      if (!hoverRow || !document.body.contains(hoverRow)) refreshHoverRow();
      return;
    }
    if (!onMinorReview()) {
      // 非未成年审查页、又不是列表页:隐藏面板,什么都不做(不干扰其它界面)
      hidePanel();
      return;
    }
    renderPanel(); // 确保面板可见
    if (paused) {
      // 暂停中:不自动打开审查,方便你查看列表
      return;
    }
    if (isModalOpen()) {
      // 弹窗(拒绝理由框)期间什么都不自动做
      return;
    }
    if (isDetailPage()) {
      centerMainImageOnce();
    } else if (findReviewButtons().length > 0) {
      autoOpenFirstReview();
    }
  }

  const observer = new MutationObserver((muts) => {
    // 忽略我们自己面板内部的变动,避免自触发循环
    const onlyOurs = muts.every(
      (m) => panelEl && (m.target === panelEl || panelEl.contains(m.target))
    );
    if (onlyOurs) return;
    // 合并抖动,节流放长一点,谷歌翻译改 DOM 时不至于狂刷
    clearTimeout(observer._t);
    observer._t = setTimeout(tick, 300);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  setInterval(tick, 800); // 兜底轮询

  // ---- 屏幕角标(带暂停/继续按钮) ----
  let panelEl = null;
  let labelEl = null;
  let btnEl = null;

  function buildPanel() {
    panelEl = document.createElement("div");
    panelEl.id = "__review_helper_status";
    // notranslate + translate=no:阻止谷歌翻译改写面板文字(否则反复翻译导致抖动)
    panelEl.className = "notranslate";
    panelEl.setAttribute("translate", "no");
    Object.assign(panelEl.style, {
      position: "fixed",
      left: "12px",
      bottom: "12px",
      zIndex: "2147483647",
      background: "rgba(0,0,0,.8)",
      color: "#fff",
      font: "12px/1.4 -apple-system,system-ui,sans-serif",
      padding: "6px 8px 6px 10px",
      borderRadius: "8px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "260px", // 固定宽度,文字变化不再引起左右抖动
      boxSizing: "border-box",
    });

    labelEl = document.createElement("span");
    labelEl.className = "notranslate";
    labelEl.setAttribute("translate", "no");
    Object.assign(labelEl.style, {
      pointerEvents: "none",
      flex: "1",
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });

    btnEl = document.createElement("button");
    btnEl.className = "notranslate";
    btnEl.setAttribute("translate", "no");
    Object.assign(btnEl.style, {
      flex: "0 0 auto",
      cursor: "pointer",
      border: "none",
      borderRadius: "6px",
      padding: "3px 10px",
      font: "12px/1 -apple-system,system-ui,sans-serif",
      fontWeight: "600",
      color: "#fff",
    });
    btnEl.addEventListener("click", (e) => {
      e.stopPropagation();
      paused = !paused;
      if (!paused) {
        // 继续时清冷却,让它能立刻打开
        lastReviewClickAt = 0;
      }
      renderPanel();
      tick();
    });

    panelEl.appendChild(labelEl);
    panelEl.appendChild(btnEl);
    document.body.appendChild(panelEl);
  }

  let currentMsg = "已启动";
  function hidePanel() {
    if (panelEl) panelEl.style.display = "none";
  }

  let _lastLabel = "";
  let _lastBtn = "";
  function renderPanel() {
    if (!panelEl) buildPanel();
    if (panelEl.style.display !== "flex") panelEl.style.display = "flex";
    // 幂等:文字没变就不动 DOM,避免无谓重写引发抖动
    const label = "审核小助手 " + VERSION + " · " + currentMsg;
    if (label !== _lastLabel) {
      labelEl.textContent = label;
      _lastLabel = label;
    }
    const btnTxt = paused ? "▶ 继续" : "⏸ 暂停";
    if (btnTxt !== _lastBtn) {
      btnEl.textContent = btnTxt;
      btnEl.style.background = paused ? "#2e7d32" : "#c62828";
      _lastBtn = btnTxt;
    }
  }

  function setStatus(msg) {
    currentMsg = msg;
    renderPanel();
  }

  tick();
})();

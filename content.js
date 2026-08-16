// 审核小助手
// 列表页:自动点开最上方的「审查」。
// 详情页:按 A=批准(通过)、D=拒绝。完成后网站自动回列表页,再自动点开下一个。

(function () {
  "use strict";

  const VERSION = "v3.6"; // 改代码时记得 +1,方便确认是否生效
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

  // 高亮当前选中行(鼠标或键盘都会走到这)
  function highlightRow(row) {
    if (hoverRow === row) return;
    if (hoverRow) hoverRow.style.outline = "";
    clearPreview(); // 换行时先关掉上一张预览
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

  // ===== 预览图:自绘一个固定在屏幕最右侧的预览框,永远不挡列表信息 =====
  // 不再驱动网站自带的左侧悬停弹层(它位置固定在头像旁、会挡住信息)。
  let previewBox = null;
  let previewRow = null; // 当前预览跟随的行,供滚动/重排时实时重定位

  // 找某行的头像元素(优先 src 含 /character/avatar/ 的图,兜底取行内第一张可见图)
  function findRowAvatar(row) {
    if (!row) return null;
    const imgs = Array.from(row.querySelectorAll("img")).filter(isVisible);
    return (
      imgs.find((im) => /\/character\/avatar\//i.test(im.src)) || imgs[0] || null
    );
  }

  function ensurePreviewBox() {
    if (previewBox && document.body.contains(previewBox)) return previewBox;
    previewBox = document.createElement("div");
    previewBox.id = "__tipsy_preview__";
    // 位置(left/top/width/height)在每次预览时由 positionPreviewUnderRow 动态设置,
    // 让预览图出现在“选中行正下方、左侧列”,占住下面两行的位置。
    previewBox.style.cssText = [
      "position:fixed",
      "z-index:2147483646",
      "background:#000",
      "border:2px solid #2e7d32",
      "border-radius:8px",
      "box-shadow:0 6px 24px rgba(0,0,0,.5)",
      "overflow:hidden",
      "display:none",
      "pointer-events:none", // 不拦截鼠标,方便继续操作页面
    ].join(";");
    const img = document.createElement("img");
    // 图片按自身比例显示,宽/高上限由 positionPreviewUnderRow 动态设置,
    // 两个上限内等比缩放,保证完整不截断。
    img.style.cssText = "display:block;height:auto;width:auto;";
    previewBox.appendChild(img);
    document.body.appendChild(previewBox);

    // 注入样式:仅在“假悬停读图”期间隐藏网站自带 tooltip(图仍会加载),避免头像旁闪一下。
    // 你手动悬停头像时页面没有这个 class,tooltip 照常显示,不受影响。
    if (!document.getElementById("__tipsy_preview_style__")) {
      const st = document.createElement("style");
      st.id = "__tipsy_preview_style__";
      st.textContent =
        "html.__tipsy_hide_tip__ .MuiTooltip-popper{opacity:0!important;pointer-events:none!important;}";
      document.head.appendChild(st);
    }
    return previewBox;
  }

  // 关掉预览框
  function clearPreview() {
    previewRow = null;
    if (previewBox) previewBox.style.display = "none";
  }

  // 预览框跟随行:滚动或 DOM 重排会改变行的位置,实时把预览框贴回行下方。
  // 行已从列表移除(如审核完被删)→ 关掉预览,避免留在原地盖住列表。
  function repositionPreview() {
    if (!previewBox || previewBox.style.display === "none" || !previewRow) return;
    if (!document.body.contains(previewRow) || !getRows().includes(previewRow)) {
      clearPreview();
      return;
    }
    positionPreviewUnderRow(previewRow, previewBox);
  }
  // 滚动/尺寸变化时实时跟随(capture:true 以捕获内部滚动容器的滚动)
  window.addEventListener("scroll", repositionPreview, true);
  window.addEventListener("resize", repositionPreview, true);

  // 把预览框定位到“选中行正下方、左侧列”,向下铺开占住下面的空间。
  function positionPreviewUnderRow(row, box) {
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(8, r.left);
    const top = r.bottom + gap;
    // 宽度:跟随行左侧信息区宽度(约到 AI 评分区之前),这里取行宽的 ~40%,并限制范围
    // 可用宽度:约行宽的 40%(左侧列),限制范围;
    // 可用高度:从行底一直到接近视口底部。
    const maxWidth = Math.min(460, Math.max(280, r.width * 0.4));
    // 高度封顶:最多铺到视口底部,但也不超过 520px,避免竖图把整条左列铺满、盖住下方行。
    const maxHeight = Math.min(520, Math.max(200, window.innerHeight - top - 12));
    // 框自适应图片大小(auto),把约束加到图片上,让图在两个上限内等比完整显示。
    box.style.left = left + "px";
    box.style.top = top + "px";
    box.style.width = "auto";
    box.style.height = "auto";
    const img = box.querySelector("img");
    if (img) {
      img.style.maxWidth = maxWidth + "px";
      img.style.maxHeight = maxHeight + "px";
    }
  }

  // 向元素(及其父级)派发一组鼠标/指针事件,用来“假装悬停”头像,
  // 促使网站把高清大图加载进它自带的 tooltip(.MuiTooltip-popper)。
  function fireHoverEvents(el, types) {
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    const targets = [el, el.parentElement].filter(Boolean);
    types.forEach((type) => {
      targets.forEach((t) => {
        let ev;
        try {
          ev = type.startsWith("pointer")
            ? new PointerEvent(type, base)
            : new MouseEvent(type, base);
        } catch (e) {
          ev = new MouseEvent(type.replace("pointer", "mouse"), base);
        }
        t.dispatchEvent(ev);
      });
    });
  }

  // 从网站 tooltip 里读高清大图地址(/character/image/ 优先)
  function readTooltipImageSrc() {
    const imgs = Array.from(
      document.querySelectorAll(".MuiTooltip-popper img")
    ).filter(isVisible);
    if (!imgs.length) return null;
    const hi = imgs.find((im) =>
      /\/character\/image\//i.test(im.currentSrc || im.src)
    );
    const chosen = hi || imgs[imgs.length - 1];
    return chosen ? chosen.currentSrc || chosen.src : null;
  }

  // 每次切行的令牌:防止上一行的异步轮询把图写错到当前框
  let previewToken = 0;

  // 显示某行头像的高清预览(固定在右侧)
  function triggerPreview(row) {
    const myToken = ++previewToken;
    const av = findRowAvatar(row);
    if (!av) {
      clearPreview();
      return;
    }
    const box = ensurePreviewBox();
    const img = box.querySelector("img");

    // 不用小头像占位,避免“先缩略图后高清图”的闪切;
    // 保持当前框内容不变,直到高清图读到再替换显示。

    // 假装悬停头像 → 触发网站加载高清图到 tooltip。
    // 先挂 class 把网站 tooltip 隐藏,避免头像旁闪一下(图仍会加载)。
    document.documentElement.classList.add("__tipsy_hide_tip__");
    fireHoverEvents(av, [
      "pointerover",
      "pointerenter",
      "mouseover",
      "mouseenter",
      "mousemove",
    ]);

    const endFakeHover = () => {
      fireHoverEvents(av, [
        "pointerout",
        "pointerleave",
        "mouseout",
        "mouseleave",
      ]);
      // 稍等 tooltip 收起后再撤 class,避免撤早了又闪一下
      setTimeout(
        () => document.documentElement.classList.remove("__tipsy_hide_tip__"),
        150
      );
    };

    // tooltip 与大图加载都是异步,轮询几次去读地址
    let tries = 0;
    const timer = setInterval(() => {
      if (myToken !== previewToken) {
        clearInterval(timer);
        endFakeHover(); // 已切到别的行:撤掉本次假悬停
        return;
      }
      const hi = readTooltipImageSrc();
      if (hi) {
        img.onload = () => {
          if (myToken === previewToken) positionPreviewUnderRow(row, box);
        };
        img.src = hi;
        previewRow = row; // 记住跟随的行,滚动/重排时实时重定位
        positionPreviewUnderRow(row, box); // 定位到选中行正下方
        box.style.display = "block";
        // 平滑滚动可能未结束,稍后再校准一次位置
        setTimeout(() => {
          if (myToken === previewToken) positionPreviewUnderRow(row, box);
        }, 350);
        clearInterval(timer);
        endFakeHover(); // 读到高清图,撤掉假悬停
      } else if (++tries >= 20) {
        // ~2s 还没读到,放弃(保留小头像占位)
        clearInterval(timer);
        endFakeHover();
      }
    }, 100);
  }

  // 取当前列表页所有可选行(文档顺序)
  function getRows() {
    return Array.from(document.querySelectorAll("div.border-b")).filter(
      (n) =>
        /\bflex\b/.test(n.className) &&
        isVisible(n) &&
        (findRowApprove(n) || findRowReject(n))
    );
  }

  // 顶部固定栏的底边 = “创建者UID / 角色ID / 审查小组 / 搜索”那一行的底部。
  // 直接量这一行的实际底边(它固定在头部),选中行顶部对齐到它下面即可。
  function getTopBarBottom() {
    // 锚点:搜索栏那一行里的“搜索”按钮,取它所在那一行的底边。
    const searchBtn = Array.from(
      document.querySelectorAll("button.MuiButton-colorPrimary, button")
    ).find((b) => isVisible(b) && /^(搜索|search)$/i.test(btnText(b)));
    if (searchBtn) {
      // 用按钮向上找到那一整行(含 UID / 角色ID / 审查小组 的容器),取其底边。
      const rowBar = searchBtn.closest("div");
      const el = rowBar || searchBtn;
      const b = el.getBoundingClientRect().bottom;
      if (b > 0 && b < window.innerHeight * 0.5) return b;
    }
    return 200; // 兜底
  }

  // 找到真正带滚动条的祖先容器(列表可能在内部滚动区里滚,而不是整个窗口)。
  // 返回 null 表示用窗口滚动。
  function getScrollParent(el) {
    let node = el ? el.parentElement : null;
    while (node && node !== document.body && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const oy = cs.overflowY;
      if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight + 4) {
        return node;
      }
      node = node.parentElement;
    }
    return null; // 用 window
  }

  // 选中某行:高亮 + 把该行顶部滚到搜索栏正下方 + 触发预览。
  // 量搜索栏底边算出差值,直接滚到“正确的滚动容器”上,一次到位,不猜高度。
  function selectRow(row) {
    highlightRow(row); // 内部已 clearPreview
    if (!row) return;
    const target = getTopBarBottom() + 8; // 目标:行顶距视口顶部 = 顶栏底边 + 一点间距
    const delta = row.getBoundingClientRect().top - target; // >0:行在目标下方,需向下滚
    const sc = getScrollParent(row);
    if (sc) {
      sc.scrollTo({ top: sc.scrollTop + delta, behavior: "smooth" });
    } else {
      window.scrollBy({ top: delta, behavior: "smooth" });
    }
    triggerPreview(row);
  }

  // ↑/↓ 移动选中行
  function moveSelection(delta) {
    const rows = getRows();
    if (!rows.length) {
      setStatus("本页没有可选的行");
      return;
    }
    let idx = hoverRow ? rows.indexOf(hoverRow) : -1;
    if (idx === -1) idx = delta > 0 ? -1 : 0; // 尚未选中:↓选第一行,↑也从第一行起
    idx = Math.max(0, Math.min(rows.length - 1, idx + delta));
    selectRow(rows[idx]);
    setStatus("已选中第 " + (idx + 1) + " / " + rows.length + " 行");
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
    // 记录当前行索引:决行后该行通常从列表移除,下一个待审行会顶到同一索引。
    const rowsBefore = getRows();
    const decidedIdx = rowsBefore.indexOf(hoverRow);
    btn.click();
    // 等列表重排后,自动选中下一个待审行并弹预览(体验和按 ↓ 一致)。
    advanceAfterDecision(decidedIdx);
    return true;
  }

  // 决行后前进到下一行。关键:上下键能稳,是因为选行时列表是静止的。
  // 这里网站决行后会继续重渲染(删行 → 重排/拉下一批),若在“行数刚变”的瞬间就选行,
  // selectRow 记住的行随即被 React 换成新节点,后续读图/滚动全在动的列表上算坐标 → 乱跑。
  // 所以:先等列表发生变化,再等它连续几次“行数不再变”(彻底静止),
  // 之后才走与上下键完全相同的 selectRow —— 此刻 DOM 和按上下键时一样是静止的。
  function advanceAfterDecision(decidedIdx) {
    if (decidedIdx < 0) return;
    const beforeCount = getRows().length;
    hoverRow = null; // 让 selectRow/highlightRow 一定重新走高亮+预览
    clearPreview(); // 先撤掉旧预览,别让它在重排期间乱铺
    let tries = 0;
    let changed = false;
    let lastCount = beforeCount;
    let stableFor = 0; // 连续多少次行数没变
    const timer = setInterval(() => {
      tries++;
      const rows = getRows();
      if (!changed) {
        // 第一步:等列表真正变化(有行被处理掉)
        if (rows.length !== beforeCount) {
          changed = true;
          lastCount = rows.length;
          stableFor = 0;
        } else if (tries >= 20) {
          // 3s 还没变:兜底直接按原索引选
          clearInterval(timer);
          finish(rows);
        }
        return;
      }
      // 第二步:等列表静止(连续 3 次 ~450ms 行数不变)
      if (rows.length === lastCount) {
        stableFor++;
      } else {
        lastCount = rows.length;
        stableFor = 0;
      }
      if (stableFor >= 3 || tries >= 40) {
        clearInterval(timer);
        finish(rows);
      }
    }, 150);

    function finish(rows) {
      rows = getRows(); // 用最新的
      if (!rows.length) {
        setStatus("本页已无待审行");
        return;
      }
      const idx = Math.max(0, Math.min(rows.length - 1, decidedIdx));
      selectRow(rows[idx]); // 与上下键同一路径,此刻 DOM 已静止
      setStatus("已选中第 " + (idx + 1) + " / " + rows.length + " 行");
    }
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
      if (paused) return; // 暂停中:不高亮、不预览,防误触
      const row = findRowFrom(e.target);
      if (row !== hoverRow) {
        highlightRow(row); // 鼠标换行:高亮(不强制滚动)
        if (row) triggerPreview(row); // 也触发预览,和键盘选择体验一致
      }
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
      if (paused) return; // 暂停中:不响应任何快捷键,防误触

      // 列表页:↑/↓ 切换选中行并预览;A/D 对当前选中行决策
      if (isListPage()) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          moveSelection(1);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          moveSelection(-1);
          return;
        }
        const kk = e.key.toLowerCase();
        if (kk === "a" || kk === "d") {
          e.preventDefault();
          decideRow(kk === "a" ? "approve" : "reject");
        }
        return;
      }

      const k = e.key.toLowerCase();
      if (k !== "a" && k !== "d") return;

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
      if (!/已通过|已拒绝|该行|不在任何|已选中|没有可选/.test(currentMsg)) {
        currentMsg = "列表页:↑↓ 选行看预览,A=通过 / D=拒绝";
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

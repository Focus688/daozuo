/* ============ 道坐 · app.js ============ */
(function () {
  "use strict";

  /* ---------- 工具 ---------- */
  var STORE_KEY = "daozuo_log_v1";
  var KEYS = ["meditation", "pushup", "heel"];
  var KEYS_CN = { meditation: "打坐", pushup: "俯卧撑", heel: "踮脚" };

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function localDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function todayStr() { return localDate(new Date()); }

  var store = null;
  try {
    store = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch (e) {
    store = {};
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 隐私模式降级 */ }
  }

  /* ---------- 打卡状态 ---------- */
  function dayList(dateStr) {
    if (!store[dateStr]) store[dateStr] = [];
    return store[dateStr];
  }
  function hasKey(dateStr, key) { return dayList(dateStr).indexOf(key) >= 0; }
  function toggleKey(key) {
    var list = dayList(todayStr());
    var i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
    else list.push(key);
    save();
    render();
  }
  function addKey(key) {
    var list = dayList(todayStr());
    if (list.indexOf(key) < 0) { list.push(key); save(); render(); }
  }
  function isFull(dateStr) {
    var list = store[dateStr];
    if (!list) return false;
    return KEYS.every(function (k) { return list.indexOf(k) >= 0; });
  }
  function streakCount() {
    var n = 0;
    var d = new Date();
    if (!isFull(localDate(d))) d.setDate(d.getDate() - 1); // 今天未满，从昨天数
    while (isFull(localDate(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    streakNum: $("streakNum"),
    cards: {
      meditation: $("card-meditation"),
      pushup: $("card-pushup"),
      heel: $("card-heel")
    },
    weekDots: $("weekDots"),
    todayState: $("todayState"),
    overlay: $("overlay"),
    overlayTimer: $("overlayTimer"),
    btnQuit: $("btnQuit"),
    breathRing: $("breathRing"),
    breathCircle: $("breathCircle"),
    breathWord: $("breathWord"),
    overlayGuide: $("overlayGuide"),
    overlayCount: $("overlayCount"),
    overlayMain: null, // 动态取
    overlayDone: $("overlayDone"),
    doneText: $("doneText"),
    btnDone: $("btnDone")
  };

  /* ---------- 渲染 ---------- */
  function render() {
    var today = todayStr();
    var cnt = 0;
    KEYS.forEach(function (k) {
      var done = hasKey(today, k);
      if (done) cnt++;
      els.cards[k].classList.toggle("done", done);
      var btn = els.cards[k].querySelector(".btn-check");
      btn.setAttribute("aria-pressed", done ? "true" : "false");
    });

    // streak
    els.streakNum.textContent = streakCount();

    // 近 7 天
    var dots = "";
    var WEEK_CN = ["日", "一", "二", "三", "四", "五", "六"];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var ds = localDate(d);
      var full = isFull(ds);
      var cls = "week-dot" + (full ? " on" : "") + (ds === today ? " today" : "");
      dots += '<div class="' + cls + '" title="' + ds + (full ? " 达标" : "") + '">' + WEEK_CN[d.getDay()] + "</div>";
    }
    els.weekDots.innerHTML = dots;

    // 今日状态
    els.todayState.textContent = "今日 " + cnt + "/3" + (cnt === 3 ? " · 达标 ✓" : "");
  }

  // 打卡按钮事件
  document.querySelectorAll(".btn-check").forEach(function (btn) {
    btn.addEventListener("click", function () {
      toggleKey(btn.getAttribute("data-key"));
    });
  });

  /* ---------- 打坐 Overlay ---------- */
  var session = null; // { total, remain, timer, phaseTimer, breathTimer, count, guideTimer }

  function buildDurationPick() {
    var main = els.overlay.querySelector(".overlay-main");
    if (!main || main.querySelector(".duration-pick")) return;
    var box = document.createElement("div");
    box.className = "duration-pick";
    box.style.flexDirection = "column";
    box.style.alignItems = "center";
    box.style.gap = "20px";
    box.innerHTML =
      '<div class="breath-word" style="font-size:26px">坐多久？</div>' +
      '<div style="display:flex;gap:12px">' +
      [5, 10, 15, 20].map(function (m) {
        return '<button class="duration-btn" data-min="' + m + '">' + m + ' 分</button>';
      }).join("") +
      "</div>" +
      '<p style="color:#8d8778;font-size:13px">初次建议 10 分钟，坐得住再慢慢加</p>';
    main.prepend(box);
    box.querySelectorAll(".duration-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        startSession(parseInt(b.getAttribute("data-min"), 10) * 60);
      });
    });
    return box;
  }

  function openOverlay() {
    els.overlay.classList.add("open");
    els.overlay.setAttribute("aria-hidden", "false");
    var pick = buildDurationPick();
    // 隐藏呼吸区，先显示选时长
    els.breathRing.style.display = "none";
    els.breathWord.style.display = "none";
    els.overlayGuide.style.display = "none";
    els.overlayCount.style.display = "none";
    els.overlayDone.hidden = true;
    if (pick) pick.style.display = "flex";
    els.overlayTimer.textContent = "—";
  }

  function closeOverlay() {
    stopSession();
    els.overlay.classList.remove("open");
    els.overlay.setAttribute("aria-hidden", "true");
  }

  function fmt(sec) {
    return Math.floor(sec / 60) + ":" + pad(sec % 60);
  }

  function startSession(totalSec) {
    var pick = els.overlay.querySelector(".duration-pick");
    if (pick) pick.style.display = "none";
    els.breathRing.style.display = "flex";
    els.breathWord.style.display = "block";
    els.overlayGuide.style.display = "block";
    els.overlayCount.style.display = "block";
    els.overlayDone.hidden = true;

    session = {
      total: totalSec,
      remain: totalSec,
      elapsed: 0,
      count: 0,
      timer: null,
      guideTimer: null,
      running: false
    };
    els.overlayTimer.textContent = fmt(totalSec);
    els.overlayCount.textContent = "";
    setGuide(0);
    startBreathCycle();
    startTimers();
  }

  function setGuide(elapsed) {
    var total = session.total;
    var word, guide;
    if (elapsed < 60) {
      word = "调身";
      guide = "脊背竖直如筷，双肩下沉，舌尖轻抵上颚。先检查一遍身体，哪里紧就松开哪里。";
    } else if (elapsed < 120) {
      word = "调息";
      guide = "把呼吸交给腹部：吸气鼓起，呼气收回。不憋气，不追求快，练到细、匀、深、长。";
    } else if (elapsed < total - 90) {
      var cycle = Math.floor((elapsed - 120) / 40) % 2;
      word = cycle === 0 ? "数息" : "观息";
      guide = cycle === 0
        ? "跟着呼吸数数：一息，数一个数，1…2…3… 数到 10，再从头来。"
        : "念头来了，不追不打，像云飘过。看见了，放它走，回到呼吸。";
    } else {
      word = "坐忘";
      guide = "放下计数，放下身体，放下念头——离形去知，同于大通。只是安安静静地坐着。";
    }
    els.breathWord.textContent = word;
    els.overlayGuide.textContent = guide;
  }

  function startBreathCycle() {
    var IN = 4, OUT = 6; // 秒
    var cycle = function () {
      if (!session || !session.running) return;
      // 吸气：圆环放大
      els.breathCircle.style.transition = "transform " + IN + "s ease-in-out";
      els.breathCircle.style.transform = "scale(1)";
      setTimeout(function () {
        if (!session || !session.running) return;
        // 呼气：圆环缩小，数一息
        els.breathCircle.style.transition = "transform " + OUT + "s ease-in-out";
        els.breathCircle.style.transform = "scale(0.55)";
        session.count = (session.count % 10) + 1;
        els.overlayCount.textContent = "第 " + session.count + " 息";
        setTimeout(cycle, OUT * 1000);
      }, IN * 1000);
    };
    // 首轮直接从吸气开始
    session.running = true;
    els.breathCircle.style.transition = "none";
    els.breathCircle.style.transform = "scale(0.55)";
    setTimeout(function () {
      els.breathCircle.style.transition = "transform " + IN + "s ease-in-out";
      els.breathCircle.style.transform = "scale(1)";
      setTimeout(function () {
        if (!session || !session.running) return;
        els.breathCircle.style.transition = "transform " + OUT + "s ease-in-out";
        els.breathCircle.style.transform = "scale(0.55)";
        session.count = 1;
        els.overlayCount.textContent = "第 1 息";
        setTimeout(cycle, OUT * 1000);
      }, IN * 1000);
    }, 30);
  }

  function startTimers() {
    session.timer = setInterval(function () {
      if (!session) return;
      session.elapsed++;
      session.remain--;
      if (session.remain <= 0) {
        finishSession();
        return;
      }
      els.overlayTimer.textContent = fmt(session.remain);
    }, 1000);

    session.guideTimer = setInterval(function () {
      if (!session) return;
      setGuide(session.elapsed);
    }, 10000);
  }

  function stopSession() {
    if (!session) return;
    session.running = false;
    clearInterval(session.timer);
    clearInterval(session.guideTimer);
    session = null;
  }

  function finishSession() {
    stopSession();
    els.overlayTimer.textContent = "0:00";
    els.breathRing.style.display = "none";
    els.breathWord.style.display = "none";
    els.overlayGuide.style.display = "none";
    els.overlayCount.style.display = "none";
    addKey("meditation");
    els.doneText.textContent = "已自动打卡 · 连续达标 " + streakCount() + " 天";
    els.overlayDone.hidden = false;
  }

  $("btnStart").addEventListener("click", openOverlay);
  els.btnQuit.addEventListener("click", function () {
    stopSession();
    closeOverlay();
  });
  els.btnDone.addEventListener("click", closeOverlay);
  // Esc 关闭（未开始时）
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && els.overlay.classList.contains("open")) {
      if (session && session.running && session.remain < session.total) {
        // 打坐中按 Esc = 提前结束，不打卡
      }
      closeOverlay();
    }
  });

  /* ---------- 初始化 ---------- */
  render();
})();

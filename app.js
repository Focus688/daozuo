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
    breathStage: $("breathStage"),
    breathCanvas: $("breathCanvas"),
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
    // 停粒子，先显示选时长
    particle.halt();
    els.breathCanvas.style.display = "none";
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
    els.breathCanvas.style.display = "block";
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
    // 启动 3D 粒子 + 呼吸节奏
    particle.start("body", function () {
      if (!session || !session.running) return;
      session.count = (session.count % 10) + 1;
      els.overlayCount.textContent = "第 " + session.count + " 息";
    });
    startTimers();
  }

  /* ---------- 阶段判定：调身→调息→数息/观息→坐忘 ---------- */
  function stageOf(elapsed) {
    var total = session.total;
    if (elapsed < 60) return "body";
    if (elapsed < 120) return "breath";
    if (elapsed < total - 90) {
      var cycle = Math.floor((elapsed - 120) / 40) % 2;
      return cycle === 0 ? "count" : "observe";
    }
    return "forget";
  }
  var STAGE_TEXT = {
    body:    ["调身", "脊背竖直如筷，双肩下沉，舌尖轻抵上颚。先检查一遍身体，哪里紧就松开哪里。"],
    breath:  ["调息", "把呼吸交给腹部：吸气鼓起，呼气收回。不憋气，不追求快，练到细、匀、深、长。"],
    count:   ["数息", "跟着呼吸数数：一息，数一个数，1…2…3… 数到 10，再从头来。"],
    observe: ["观息", "念头来了，不追不打，像云飘过。看见了，放它走，回到呼吸。"],
    forget:  ["坐忘", "放下计数，放下身体，放下念头——离形去知，同于大通。只是安安静静地坐着。"]
  };
  function setGuide(elapsed) {
    var s = stageOf(elapsed);
    var t = STAGE_TEXT[s];
    els.breathWord.textContent = t[0];
    els.overlayGuide.textContent = t[1];
    particle.setStage(s);
  }

  /* ============ 3D 粒子引擎（零依赖 canvas，伪透视投影） ============ */
  var particle = (function () {
    var cv = els.breathCanvas;
    var ctx = cv ? cv.getContext("2d") : null;
    var W = 0, H = 0, DPR = 1, CX = 0, CY = 0, RADIUS = 0;
    var pts = [];
    var raf = null, tPrev = 0, t = 0;
    var running = false;
    var IN = 4, OUT = 6, CYCLE = IN + OUT;   // 吸4s 呼6s
    var breathT = 0;
    var curStage = "body";
    var onBreath = null;

    // 各阶段形态目标（smooth lerp 过渡）
    var stages = {
      body:    { shape: 0, respAmp: 0.05, spin: 0.12, drift: 0.0, spread: 1.00, alpha: 0.92 },
      breath:  { shape: 0, respAmp: 0.20, spin: 0.12, drift: 0.0, spread: 1.00, alpha: 0.92 },
      count:   { shape: 0, respAmp: 0.10, spin: 0.30, drift: 0.3, spread: 1.12, alpha: 0.92 },
      observe: { shape: 1, respAmp: 0.05, spin: 0.48, drift: 0.6, spread: 1.30, alpha: 0.85 },
      forget:  { shape: 2, respAmp: 0.03, spin: 0.60, drift: 1.2, spread: 2.10, alpha: 0.80 },
      done:    { shape: 3, respAmp: 0.00, spin: 0.90, drift: 2.8, spread: 3.60, alpha: 0.00 }
    };
    var cur = { shape: 0, respAmp: 0, spin: 0, drift: 0, spread: 1, alpha: 0 };

    function resize() {
      if (!cv) return;
      var r = cv.getBoundingClientRect();
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = Math.max(1, Math.round(r.width * DPR));
      H = cv.height = Math.max(1, Math.round(r.height * DPR));
      CX = W / 2; CY = H / 2;
      RADIUS = Math.min(W, H) * 0.40;
      spawn(620);
    }

    function spawn(n) {
      pts = [];
      for (var i = 0; i < n; i++) {
        var u = Math.random() * 2 - 1;
        var th = Math.random() * Math.PI * 2;
        var s = Math.sqrt(1 - u * u);
        var r = Math.pow(Math.random(), 0.55);
        pts.push({
          bx: s * Math.cos(th) * r,
          by: u * r,
          bz: s * Math.sin(th) * r,
          wob: Math.random() * Math.PI * 2,
          spd: 0.4 + Math.random() * 1.2,
          siz: 0.7 + Math.random() * 1.8
        });
      }
    }

    function setStage(s) { if (stages[s]) curStage = s; }

    function start(stage, cb) {
      onBreath = cb;
      curStage = stage || "body";
      var g = stages[curStage];
      cur.shape = g.shape; cur.respAmp = g.respAmp; cur.spin = g.spin;
      cur.drift = g.drift; cur.spread = g.spread; cur.alpha = g.alpha;
      breathT = 0; t = 0;
      running = true;
      cv.style.display = "block";
      resize();
      tPrev = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function halt() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (ctx) ctx.clearRect(0, 0, W, H);
    }

    function loop(ts) {
      if (!running) return;
      var dt = Math.min(0.05, (ts - tPrev) / 1000); tPrev = ts; t += dt;

      breathT += dt;
      if (breathT >= CYCLE) { breathT -= CYCLE; if (onBreath) onBreath(); }
      var bp = (breathT < IN) ? breathT / IN : 1 + (breathT - IN) / OUT;
      var resp = 0.5 - 0.5 * Math.cos(bp * Math.PI);   // 吸满=1 呼空=0

      var g = stages[curStage], k = 0.018;
      cur.shape += (g.shape - cur.shape) * k;
      cur.respAmp += (g.respAmp - cur.respAmp) * k;
      cur.spin += (g.spin - cur.spin) * k;
      cur.drift += (g.drift - cur.drift) * k;
      cur.spread += (g.spread - cur.spread) * k;
      cur.alpha += (g.alpha - cur.alpha) * k;

      draw(resp);
      raf = requestAnimationFrame(loop);
    }

    function draw(resp) {
      if (!ctx) return;
      var grad = ctx.createRadialGradient(CX, CY, 0, CX, CY, Math.max(W, H) * 0.6);
      grad.addColorStop(0, "#242118");
      grad.addColorStop(1, "#14120e");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      var rot = t * cur.spin, cosR = Math.cos(rot), sinR = Math.sin(rot);
      var rot2 = t * cur.spin * 0.6, cosR2 = Math.cos(rot2), sinR2 = Math.sin(rot2);
      var respAmp = cur.respAmp, spread = cur.spread, drift = cur.drift;

      for (var i = 0; i < pts.length; i++) {
        var p = pts[i], x, y, z;
        if (cur.shape < 0.5) {
          x = p.bx; y = p.by; z = p.bz;
        } else if (cur.shape < 1.5) {
          var flat = 1 - Math.abs(p.by);
          x = p.bx; y = p.by * (0.35 + 0.65 * flat); z = p.bz * 0.9;
        } else if (cur.shape < 2.5) {
          var rr2 = Math.sqrt(p.bx * p.bx + p.bz * p.bz);
          var ang = Math.atan2(p.bz, p.bx) + rr2 * 2.2 * (p.by > 0 ? 1 : -1);
          var ex = Math.cos(ang) * rr2 * spread, ez = Math.sin(ang) * rr2 * spread;
          x = ex * cosR2 - p.by * 0.4 * sinR2;
          y = p.by * spread * 1.4;
          z = ez * cosR2 + p.by * 0.4 * sinR2;
        } else {
          x = p.bx * spread + Math.sin(p.wob + t * 2) * 0.5;
          y = p.by * spread + Math.cos(p.wob + t * 1.7) * 0.5;
          z = p.bz * spread;
        }

        // 个体微颤
        x += Math.sin(p.wob + t * p.spd * 2) * 0.02;
        y += Math.cos(p.wob * 1.3 + t * p.spd * 1.6) * 0.02;
        z += Math.sin(p.wob * 0.7 + t * p.spd * 2.4) * 0.02;

        var rad = 1 + respAmp * resp;
        var rx = x * cosR - z * sinR;
        var rz = x * sinR + z * cosR;
        var ry = y * cosR2 - rz * sinR2 * 0.35;
        var rz2 = y * sinR2 * 0.35 + rz * cosR2;

        var depth = 1 / (1.8 - rz2 * 0.55);
        var px = CX + rx * RADIUS * rad * spread * depth;
        var py = CY + ry * RADIUS * rad * spread * depth;

        if (px < -20 || px > W + 20 || py < -20 || py > H + 20) continue;

        var size = p.siz * depth * (0.5 + 0.5 * spread);
        var alpha = cur.alpha * Math.min(1, depth * 0.9);
        var light = 0.5 + 0.5 * depth;
        var rCol = Math.min(255, Math.round(216 * light));
        var gCol = Math.min(255, Math.round(190 * light));
        var bCol = Math.min(255, Math.round(128 * light));

        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + rCol + "," + gCol + "," + bCol + "," + alpha + ")";
        ctx.fill();
      }
    }

    return { start: start, halt: halt, setStage: setStage };
  })();

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
    }, 3000);
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
    // 粒子如烟消散，再露出完成界面
    particle.setStage("done");
    setTimeout(function () {
      particle.halt();
      els.breathCanvas.style.display = "none";
      els.breathWord.style.display = "none";
      els.overlayGuide.style.display = "none";
      els.overlayCount.style.display = "none";
      addKey("meditation");
      els.doneText.textContent = "已自动打卡 · 连续达标 " + streakCount() + " 天";
      els.overlayDone.hidden = false;
    }, 900);
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

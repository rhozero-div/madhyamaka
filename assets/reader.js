/* 《中觀論疏》/《心經》共用閱讀器
 *
 * 頁面用 <body data-text="T08n0251"> 指定文本；其餘（標題、作者、模式、
 * 分段）全由 text/<id>.json 的 meta 決定。注釋存 annotations/<id>.json，
 * 術語存 glossary/terms.json。
 *
 * 兩種模式：
 *   long  —— 多卷本，按卷切頁，有目錄；單元為段內「問答回合」
 *   short —— 單篇，一屏到底，無目錄；單元為句
 *
 * 一條注可分三截（parts）：原義 / 觀義 / 串講，各帶小標籤；
 * 舊注只有 note 一字串，照原樣顯示，不強制遷移。
 */
(function () {
"use strict";

const $ = s => document.querySelector(s);
const CIR = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const circle = n => n <= 20 ? CIR[n - 1] : "(" + n + ")";
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const escA = s => esc(s).replace(/"/g, "&quot;");

const TEXT = document.body.dataset.text || "T42n1824";
// 靜態託管（GitHub Pages）判別：只有本機才會有 serve.py 的 api/*
const STATIC_HOST = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const SLOTS = ["原義", "觀義", "串講"];
const KIND = { "原義": "yuan", "觀義": "guan", "串講": "chuan" };
// 舊注的層名可能仍是簡體；比對與顯示都先歸繁，免兩套寫法各認一套
const KZ = { "原義": "原義", "觀義": "觀義", "串講": "串講" };
const kn = k => KZ[k] || k;

let DOC = null, NOTES = [], META = {}, MODE = "long";
let TERMS = [], AUTO = [], TMAP = new Map();
let JUAN = 1, LIVE = true, FS = +(localStorage.getItem("nz_fs") || 18);
// 靜態託管（GitHub Pages）沒有 api/*，此時 LIVE=false、READONLY=true：
// 注文改讀 annotations/<id>.json，頁面只供閱讀，不給加注、改注、刪注的入口。
let READONLY = false;
let editing = null, pending = null;

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2200);
}

/* 打不開時的落地頁：給出可直接點的地址，並探一下服務是否已在跑。
   頁面檔名即文本 id（T42n1824.html / T08n0251.html），與 text/<id>.json 對應。 */
const PAGE_TITLE = { T42n1824: "中觀論疏", T08n0251: "般若心經" };
const PAGE_CMD = { T42n1824: "開啟論疏.command", T08n0251: "開啟心經.command" };
function fail(msg) {
  // 線上沒有本地服務可開，別把「跑 serve.py」的提示推給讀者
  if (STATIC_HOST) {
    $("#body").innerHTML =
      '<div class="err">' +
      '<p class="err-t">' + msg + "</p>" +
      '<p class="err-h">線上為靜態檔，多半是網絡一時未到，刷新即可；也可回<a href="reading.html">閱讀目錄</a>另開一頁。</p>' +
      "</div>";
    return;
  }
  const page = TEXT + ".html";
  const url = "http://127.0.0.1:8765/" + page;
  const other = TEXT === "T08n0251" ? "T42n1824" : "T08n0251";
  const cmd = PAGE_CMD[TEXT] || "開啟論疏.command";
  $("#body").innerHTML =
    '<div class="err">' +
    '<p class="err-t">' + msg + "</p>" +
    '<p class="err-u"><a href="' + url + '">' + url + "</a></p>" +
    '<p class="err-h" id="errHint">在終端機執行 <code>python3 serve.py</code>，或雙擊項目裡的 <code>' + cmd + "</code>。</p>" +
    '<p class="err-h">另一頁：<a href="' + other + '.html">' + (PAGE_TITLE[other] || other) + "</a></p>" +
    "</div>";

  const hint = document.getElementById("errHint");
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 1500);
  fetch(url, { mode: "no-cors", signal: ac.signal, cache: "no-store" })
    .then(() => { if (hint) hint.innerHTML = "服務已在運行，直接點上面的紅色地址即可。"; })
    .catch(() => {});
}

/* ---------- 術語 ---------- */

/* 取數據的網址一律加時間戳。服務端雖已發 no-store，但瀏覽器（尤其 Safari）
   對同址 GET 仍可能直接吐內存裡的舊響應，連普通刷新都不走網絡。
   換個網址就沒有緩存可命中了。 */
function bust(u) {
  return u + (u.indexOf("?") < 0 ? "?" : "&") + "_=" + Date.now();
}

async function loadTerms() {
  let d = null;
  try {
    const r = await fetch(bust("api/terms"), { cache: "no-store" });
    if (r.ok) d = await r.json();
  } catch (e) { /* 靜態託管時無此接口，改用檔案 */ }
  if (!d) {
    try {
      const r = await fetch(bust("glossary/terms.json"), { cache: "no-store" });
      if (r.ok) d = await r.json();
    } catch (e) { /* 無術語檔案也能照常讀經 */ }
  }
  TERMS = (d && d.terms) || [];
  buildTermIndex();
}

function buildTermIndex() {
  TMAP = new Map();
  for (const t of TERMS) {
    if (t.k) TMAP.set(t.k, t);
    for (const a of (t.aka || [])) if (a && !TMAP.has(a)) TMAP.set(a, t);
  }
  // 只自動加鏈有釋義的詞；空釋義留在術語表裡當待辦，不污染正文
  AUTO = TERMS
    .filter(t => t.auto && t.k && t.t && t.t.trim())
    .map(t => ({ k: t.k, aka: (t.aka || []).filter(Boolean) }))
    .sort((a, b) => b.k.length - a.k.length);
}

/* 注文渲染：{{術語}} 顯式標記一律可點；其餘按術語表自動補鏈，
   每個詞只鏈文中首次出現，且不與既有標記重疊。 */
function termize(text, seen) {
  if (!text) return "";
  const spans = [];
  let out = "", last = 0;
  const re = /\{\{([^{}\n]{1,24})\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    out += text.slice(last, m.index);
    spans.push({ a: out.length, b: out.length + m[1].length, key: m[1] });
    out += m[1];
    last = m.index + m[0].length;
  }
  out += text.slice(last);

  for (const t of AUTO) {
    if (seen && seen.has(t.k)) continue;
    if (spans.some(s => s.key === t.k)) continue;
    let hit = -1, len = 0;
    for (const c of [t.k].concat(t.aka)) {
      const i = out.indexOf(c);
      if (i >= 0 && (hit < 0 || i < hit)) { hit = i; len = c.length; }
    }
    if (hit < 0) continue;
    if (spans.some(s => !(hit + len <= s.a || hit >= s.b))) continue;
    spans.push({ a: hit, b: hit + len, key: t.k });
  }
  if (seen) for (const s of spans) seen.add(s.key);

  spans.sort((x, y) => x.a - y.a);
  let html = "", cur = 0;
  for (const s of spans) {
    html += esc(out.slice(cur, s.a));
    html += '<span class="term" data-k="' + escA(s.key) + '">' + esc(out.slice(s.a, s.b)) + "</span>";
    cur = s.b;
  }
  return html + esc(out.slice(cur));
}

function showTerm(k, el) {
  const card = $("#tcard");
  if (!card) return;
  const t = TMAP.get(k);
  card.hidden = false;
  $("#tcTerm").textContent = k;
  let html = "";
  if (t && t.t && t.t.trim()) {
    // 釋義可分數段：空行分段，逐段渲染，段內仍自動補術語鏈
    html = String(t.t).split(/\n+/).map(s => s.trim()).filter(Boolean)
      .map(s => "<p>" + termize(s) + "</p>").join("");
  } else {
    html = '<span class="tc-empty">釋義待撰</span>';
  }
  // 所引：術語亦可附經論文句，與注文所引同一格式（w 書名 / p 品名 / q 引文 / l 行號）
  if (t && t.src && t.src.length) {
    html += '<div class="tc-quote"><div class="tq-k">所引</div>' + t.src.map(s => {
      const o = typeof s === "string" ? { w: s } : s;
      let h = '<div class="tq-h">' + esc([o.w, o.p].filter(Boolean).join("　")) + "</div>";
      if (o.q) h += '<div class="tq-q">' + esc(o.q) + "</div>";
      if (o.l) h += '<div class="tq-l">' + esc(o.l) + "</div>";
      return h;
    }).join("") + "</div>";
  }
  if (t && t.refs && t.refs.length) {
    html += '<div class="tc-src">所據　' + esc(t.refs.join("　")) + "</div>";
  }
  html += '<div class="tc-act"><a href="glossary.html#' + encodeURIComponent(k) + '">' +
    (READONLY ? "在術語表中查看 →" : "在術語表中編輯 →") + "</a></div>";
  $("#tcBody").innerHTML = html;

  const r = el.getBoundingClientRect();
  const w = card.offsetWidth;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - w - 12;
  card.style.left = Math.max(12, Math.min(r.left + window.scrollX - 10, maxLeft)) + "px";
  card.style.top = (r.bottom + window.scrollY + 8) + "px";
}
function hideTerm() { const c = $("#tcard"); if (c) c.hidden = true; }

async function boot() {
  if (location.protocol === "file:") {
    return fail("這一頁要由本地服務提供，直接用檔案打開讀不到正文，注也存不了盤。");
  }
  document.documentElement.style.setProperty("--fs", FS + "px");
  if (localStorage.getItem("nz_clean") === "1") {
    document.body.classList.add("clean");
    $("#cleanBtn").setAttribute("aria-pressed", "true");
  }

  try {
    const r = await fetch(bust("text/" + TEXT + ".json"), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    DOC = await r.json();
  } catch (e) {
    return fail("未能讀取正文數據（text/" + esc(TEXT) + ".json）。");
  }

  MODE = DOC.mode || document.body.dataset.mode || "long";
  document.body.dataset.mode = MODE;
  META = DOC;
  document.title = (DOC.title || "") + " · 閱讀";

  try {
    const r = await fetch(bust("api/notes?t=" + encodeURIComponent(TEXT)), { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    NOTES = (await r.json()).notes || [];
  } catch (e) {
    LIVE = false;
    // 本地服務不在，就退回倉庫裡的注釋檔（線上即走這一路）
    try {
      const r = await fetch(bust("annotations/" + TEXT + ".json"), { cache: "no-store" });
      if (r.ok) {
        const d = await r.json();
        NOTES = (Array.isArray(d) ? d : d.notes) || [];
      }
    } catch (e2) { /* 沒有注釋檔也照常讀經 */ }
    READONLY = true;
    document.body.classList.add("ro");
    toast("唯讀：注文取自倉庫，只能看不能改");
  }

  await loadTerms();

  if (MODE === "short") {
    renderAll();
  } else {
    buildToc();
    const m = location.hash.match(/^#j(\d+)$/);
    go(m ? +m[1] : 1, true);
  }
}

function buildToc() {
  const list = $("#tocList");
  list.innerHTML = "";
  DOC.blocks.filter(b => b.k === "juan").forEach(b => {
    const a = document.createElement("a");
    a.className = "toc-j"; a.dataset.j = b.n;
    a.innerHTML = esc(b.short || b.label) + "<small>" + b.page + "</small>";
    a.onclick = () => { go(b.n); $("#toc").classList.remove("on"); };
    list.appendChild(a);
  });
  const t = document.querySelector(".toc-t");
  if (t) t.textContent = (DOC.title || "") + " · 目錄";
}

function blocksOf(j) {
  const out = []; let on = false;
  for (const b of DOC.blocks) {
    if (b.k === "juan") {
      if (b.n === j) on = true;
      else if (on) break;
    }
    if (on) out.push(b);
  }
  return out;
}

/* ---------- 渲染 ---------- */
function renderBlocks(frag, blocks) {
  for (const b of blocks) {
    if (b.k === "p") addPara(frag, b);
    else if (b.k === "juan") {
      const d = document.createElement("div");
      d.className = "juan-h";
      d.innerHTML = "<span>" + esc(b.short || b.label) + "</span><span>" +
        esc(DOC.base || "") + " · " + esc(b.page) + "</span>";
      frag.appendChild(d);
    } else if (b.k === "head" || b.k === "pin" || b.k === "xu") {
      const d = document.createElement("div");
      d.className = "pin";
      d.innerHTML = "<h2>" + esc(b.t) + (b.repeat ? '<span style="font-size:.6em;letter-spacing:.1em;color:var(--ink-3)">（續）</span>' : "") +
        '</h2><span class="sub">' + esc(b.sub || (b.k === "xu" ? "序疏" : b.k === "pin" ? "品第" : "")) + "</span>";
      frag.appendChild(d);
    } else if (b.k === "byline") {
      const d = document.createElement("div");
      d.className = "byline"; d.textContent = b.t;
      frag.appendChild(d);
    } else if (b.k === "trailer") {
      const d = document.createElement("div");
      d.className = "trailer"; d.textContent = b.t;
      frag.appendChild(d);
    }
  }
}

function go(j, silent) {
  JUAN = j;
  document.querySelectorAll(".toc-j").forEach(a => a.classList.toggle("on", +a.dataset.j === j));
  const wrap = $("#body");
  const frag = document.createDocumentFragment();
  renderBlocks(frag, blocksOf(j));
  wrap.innerHTML = "";
  wrap.appendChild(frag);
  updateWhere();
  if (!silent) window.scrollTo({ top: 0, behavior: "smooth" });
  history.replaceState(null, "", "#j" + j);
}

function renderAll(silent) {
  const y = window.scrollY;
  const wrap = $("#body");
  const frag = document.createDocumentFragment();
  renderBlocks(frag, DOC.blocks);
  wrap.innerHTML = "";
  wrap.appendChild(frag);
  updateWhere();
  if (silent) window.scrollTo({ top: y });
}

/* 角標畫在所注文字的右端，不畫在左端。
   這樣整句之注落在句末，句中之詞注依次在前，讀時自然先詞後句；
   若一律畫在左端，句注與句首詞注會擠在同一處，先後就亂了。
   舊注只存了選區起點 offset，用 offset + 引文長度補出右端；新注另存 end。 */
function markAt(n) {
  if (typeof n.end === "number") return n.end;
  return n.offset + (n.quote || "").length;
}

function addPara(frag, p) {
  const cuts = (p.cuts && p.cuts.length > 1) ? p.cuts : [0, p.t.length];
  // 底本分段的引文，照大正藏體例只在引文最終處收號，中間各段僅段首開號。
  // 本段止處若引文未收，末尾補一個淡色收號，免讀者以為漏排；真收號處不補。
  const fill = Math.max(0, (p.t.match(/「/g) || []).length - (p.t.match(/」/g) || []).length);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], last = i === cuts.length - 2;
    // 編號：本單元內自 ① 起，與古籍「頁下注」同理；按右端位置排序，
    // 右端相同者短注在前（詞注先於包住它的句注）。
    const ns = NOTES.filter(n => {
      if (n.para !== p.id) return false;
      const m = markAt(n);
      // 落點恰在單元邊界（即句末標點之後）者歸前一段：本段止處即彼注之所在，
      // 若歸後一段，角標會跑到下一句句首去。
      return (i === 0 ? m >= a : m > a) && m <= b;
    }).sort((x, y) => (markAt(x) - markAt(y)) || (y.offset - x.offset));

    let html = "", cur = a, tail = "";
    ns.forEach((n, k) => {
      const sup = '<sup class="mark" data-nid="' + n.id + '" data-no="' + circle(k + 1) + '"></sup>';
      const cut = Math.max(a, Math.min(markAt(n), b));
      // 落在段末的注，要排在補收號之後，否則會插進引號裡面
      if (cut >= b) { tail += sup; return; }
      html += esc(p.t.slice(cur, cut)) + sup;
      cur = cut;
    });
    html += esc(p.t.slice(cur, b));
    html = html.replace(/問：/g, '<span class="qw">問：</span>').replace(/答：/g, '<span class="aw">答：</span>');
    if (last && fill) {
      html += '<span class="qfill" title="底本此段止處引文未收，此號為便讀補足，非原文">' +
        "」".repeat(fill) + "</span>";
    }
    html += tail;

    const el = document.createElement("p");
    el.className = "unit" + (p.dh ? " dh" : "");
    el.dataset.pid = p.id; el.dataset.start = a; el.dataset.end = b;
    el.innerHTML = html;
    frag.appendChild(el);

    if (ns.length) {
      const box = document.createElement("div");
      box.className = "notes";
      ns.forEach((n, k) => box.appendChild(noteEl(n, circle(k + 1))));
      frag.appendChild(box);
    }
  }
}

/* 注文分段（古籍體）：首段緊接標籤、不縮進；其後各段不空行，只在段首縮進兩格。
   所引原文（.nsq）不走這裡，仍照底本換行。 */
function paraHtml(t, seen) {
  const ps = String(t || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  if (!ps.length) return "";
  return '<span class="np">' + termize(ps[0], seen) + "</span>" +
    ps.slice(1).map(s => '<p class="np-p">' + termize(s, seen) + "</p>").join("");
}

function noteEl(n, no) {
  const d = document.createElement("div");
  d.className = "nt"; d.id = "n-" + n.id; d.dataset.nid = n.id;

  // 注文前列出所注原文（即劃線部分），便於對讀；過長者截斷，全文留在 title 裡
  let q = "";
  if (n.quote) {
    const LIM = 48, cut = n.quote.length > LIM;
    const shown = cut ? n.quote.slice(0, LIM) + "…" : n.quote;
    q = '<span class="nq"' + (cut ? ' title="' + escA(n.quote) + '"' : "") +
        ">" + esc(shown) + '</span><span class="nc">：</span>';
  }

  const parts = Array.isArray(n.parts) ? n.parts.filter(p => p && p.k && p.t && p.t.trim()) : [];
  let body = "";
  // 同一條注內，一個術語只加一次鏈，免得原義、觀義各鏈一遍
  const seen = new Set();
  if (parts.length) {
    body = '<div class="nparts">' + parts.map(p =>
      '<div class="npart"><span class="nk k-' + (KIND[kn(p.k)] || "other") + '">' + esc(kn(p.k)) + "</span>" +
      paraHtml(p.t, seen) + "</div>").join("") + "</div>";
  }
  if (n.note) {
    body += (parts.length ? '<div class="nplain">' : '<div class="nb-i">') + paraHtml(n.note, seen) + "</div>";
  }
  if (n.src && n.src.length) {
    // 一書一條：書名／品名／原文／出處，舊數據為純字符串，照舊顯示
    const items = n.src.map(s => (typeof s === "string" ? { w: s } : (s || {})))
      .filter(o => o.w || o.p || o.q || o.l);
    if (items.length) {
      body += '<div class="nsrc"><i>所引</i><div class="nsrc-l">' + items.map(it => {
        let h = '<div class="nsrc-i">';
        const head = [it.w, it.p].filter(Boolean).join("　");
        if (head) h += '<div class="nsw">' + esc(head) + "</div>";
        if (it.q) h += '<div class="nsq">' + esc(it.q) + "</div>";
        if (it.l) h += '<div class="nsl">' + esc(it.l) + "</div>";
        return h + "</div>";
      }).join("") + "</div></div>";
    }
  }

  d.innerHTML = '<span class="nn">' + no + '</span><div class="nb">' + q + body +
    '</div>' + (READONLY ? "" : '<button class="nd" title="刪除">×</button>');
  return d;
}

function updateWhere() {
  if (MODE === "short") {
    $("#where").innerHTML = esc(DOC.title || "") +
      (DOC.author ? ' <em>' + esc(DOC.author) + "</em>" : "");
    return;
  }
  const j = DOC.blocks.find(b => b.k === "juan" && b.n === JUAN);
  const label = j ? (j.short || j.label || "") : "";
  const pin = [...document.querySelectorAll(".pin h2")].map(x => x.textContent)[0] || "";
  $("#where").innerHTML = esc(label) + (pin ? ' <em>' + esc(pin) + "</em>" : "");
}

/* ---------- 點擊 ---------- */
document.addEventListener("click", e => {
  const tm = e.target.closest(".term");
  if (tm) { showTerm(tm.dataset.k, tm); return; }

  const mk = e.target.closest(".mark");
  if (mk) {
    const t = document.getElementById("n-" + mk.dataset.nid);
    if (t) {
      t.scrollIntoView({ block: "center", behavior: "smooth" });
      t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 900);
    }
    return;
  }
  const nn = e.target.closest(".nn");
  if (nn) {
    const m = document.querySelector('.mark[data-nid="' + nn.closest(".nt").dataset.nid + '"]');
    if (m) {
      m.scrollIntoView({ block: "center", behavior: "smooth" });
      m.classList.add("flash"); setTimeout(() => m.classList.remove("flash"), 900);
    }
    return;
  }
  const del = e.target.closest(".nd");
  if (del) {
    if (READONLY) return;
    if (!confirm("刪去這條注？")) return;
    removeNote(del.closest(".nt").dataset.nid);
    return;
  }
  const nb = e.target.closest(".nb");
  if (nb) {
    if (READONLY) return;
    const id = nb.closest(".nt").dataset.nid;
    const n = NOTES.find(x => x.id === id);
    if (n) openEditor(n, nb.closest(".nt"));
    return;
  }
  if (!e.target.closest("#tcard")) hideTerm();
  if (!e.target.closest(".tip")) $("#tip").style.display = "none";
});

/* ---------- 選注 ---------- */
document.addEventListener("mouseup", e => {
  if (READONLY) return;
  if (e.target.closest(".editor") || e.target.closest("#toc") || e.target.closest(".notes") || e.target.closest("#tcard")) return;
  setTimeout(() => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { $("#tip").style.display = "none"; return; }
    const r = sel.getRangeAt(0);
    const u1 = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer).closest(".unit");
    const u2 = (r.endContainer.nodeType === 3 ? r.endContainer.parentElement : r.endContainer).closest(".unit");
    if (!u1 || u1 !== u2) { $("#tip").style.display = "none"; return; }
    const rect = r.getBoundingClientRect();
    const tip = $("#tip");
    tip.style.display = "block";
    tip.style.left = (rect.left + rect.width / 2 + window.scrollX) + "px";
    tip.style.top = (rect.top + window.scrollY - 9) + "px";
    pending = r.cloneRange();
  }, 10);
});

$("#tip").onclick = () => {
  if (!pending) return;
  const r = pending;
  const u = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer).closest(".unit");
  const pre = document.createRange();
  pre.setStart(u, 0);
  pre.setEnd(r.startContainer, r.startOffset);
  const raw = getSelection().toString();
  const lead = raw.length - raw.replace(/^\s+/, "").length;   // 去掉選區前端空白，錨點才準
  const quote = raw.trim();
  const offset = +u.dataset.start + pre.toString().length + lead;
  $("#tip").style.display = "none";
  if (!quote) return;
  openEditor({ id: null, para: u.dataset.pid, offset, end: offset + quote.length, quote }, null);
};

/* ---------- 編輯器（三欄：原義 / 觀義 / 串講，另附所引） ---------- */
const grow = el => { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight + 2, 220) + "px"; };

function growAll() {
  ["#edYuan", "#edGuan", "#edChuan", "#edLegacy"].forEach(s => { const el = $(s); if (el) grow(el); });
}

/* ---------- 所引：一書一條，可記品名、原文與出處 ---------- */
function srcRow(it) {
  it = typeof it === "string" ? { w: it } : (it || {});
  const d = document.createElement("div");
  d.className = "ed-srow";
  d.innerHTML =
    '<div class="ed-srow-h">' +
      '<input class="sw" placeholder="書名，如《中論》">' +
      '<input class="sp" placeholder="品名，如觀行品第十三">' +
      '<button type="button" class="sdel" title="刪去此條">×</button>' +
    "</div>" +
    '<textarea class="sq" rows="2" placeholder="原文，可空；換行照錄，與底本同"></textarea>' +
    '<input class="sl" placeholder="出處，如 T30.1564.0018c16–17，可空">';
  d.querySelector(".sw").value = it.w || "";
  d.querySelector(".sp").value = it.p || "";
  d.querySelector(".sq").value = it.q || "";
  d.querySelector(".sl").value = it.l || "";
  d.querySelector(".sdel").onclick = () => { d.remove(); ensureSrcRow(); };
  grow(d.querySelector(".sq"));
  return d;
}

// 至少留一條空行，免得刪空後無處下筆
function ensureSrcRow() {
  if (!$("#edSrcList").children.length) $("#edSrcList").appendChild(srcRow({}));
}

function openEditor(n, ntEl) {
  editing = { note: n, el: ntEl };
  $("#editor").classList.add("on");
  $("#edQuote").innerHTML = n.id
    ? "改注：<b>" + (n.quote ? esc(n.quote) : "（句末串講）") + "</b>"
    : n.quote
      ? "原文：" + esc(n.quote.slice(0, 80)) + (n.quote.length > 80 ? "…" : "")
      : "句末串講：不引原文，只通釋這一句";

  const parts = Array.isArray(n.parts) ? n.parts : [];
  const get = k => { const p = parts.find(x => x && kn(x.k) === k); return p && p.t ? p.t : ""; };
  $("#edYuan").value = get("原義");
  $("#edGuan").value = get("觀義");
  $("#edChuan").value = get("串講");
  const srcList = $("#edSrcList");
  srcList.innerHTML = "";
  (Array.isArray(n.src) ? n.src : []).forEach(s => srcList.appendChild(srcRow(s)));
  ensureSrcRow();

  const legacy = n.id ? (n.note || "") : "";
  $("#edLegacy").value = legacy;
  $("#edLegacyWrap").style.display = legacy ? "" : "none";
  $("#edHint").textContent = legacy ? "舊注可剪入上三欄；留空則原樣保留" : "三欄皆可空，填一欄即可存";

  growAll();
  // 舊注尚未分層時，光標落在舊注框裡——那才是要剪的東西
  const f = legacy ? $("#edLegacy") : $("#edYuan");
  f.focus();
  f.setSelectionRange(f.value.length, f.value.length);
}

function closeEditor() {
  $("#editor").classList.remove("on");
  editing = null; pending = null;
}

$("#edCancel").onclick = closeEditor;
$("#edSave").onclick = saveNote;
$("#edAddSrc").onclick = () => {
  const row = srcRow({});
  $("#edSrcList").appendChild(row);
  row.querySelector(".sw").focus();
};
["#edYuan", "#edGuan", "#edChuan", "#edLegacy"].forEach(s => {
  const el = $(s); if (el) el.addEventListener("input", () => grow(el));
});
/* 編集框內不綁任何快捷鍵：輸入法用 Esc 取消候選、用 Enter 上屏，
   若這裡攔鍵盤，正好會把整段注文吞掉。存與取消一律點按鈕。 */

function readForm() {
  const parts = [];
  for (const k of SLOTS) {
    const el = { "原義": "#edYuan", "觀義": "#edGuan", "串講": "#edChuan" }[k];
    const v = $(el).value.trim();
    if (v) parts.push({ k: k, t: v });
  }
  const src = [...$("#edSrcList").querySelectorAll(".ed-srow")].map(r => ({
    w: r.querySelector(".sw").value.trim(),
    p: r.querySelector(".sp").value.trim(),
    q: r.querySelector(".sq").value.trim(),
    l: r.querySelector(".sl").value.trim(),
  })).filter(o => o.w || o.p || o.q || o.l);
  const legacy = $("#edLegacy").value.trim();
  return { parts, src, legacy };
}

async function saveNote() {
  if (!editing) return;
  const { parts, src, legacy } = readForm();
  if (!parts.length && !legacy) { toast("注文為空"); return; }
  // 舊注若已被剪進某一欄，就不再另存一份，免得頁上重複
  let keep = legacy;
  if (keep && parts.length && parts.map(p => p.t).join("\n").indexOf(keep) >= 0) keep = "";
  const n = editing.note;

  if (n.id) {
    const old = NOTES.find(x => x.id === n.id) || n;
    let upd = Object.assign({}, old, { parts, src, ts: new Date().toISOString() });
    if (keep) upd.note = keep; else delete upd.note;
    if (LIVE) {
      const r = await post({ op: "update", t: TEXT, note: upd });
      if (!r) return;
      if (r.note) upd = r.note;   // 服務端已把簡體轉繁，取回轉過的那份
    }
    NOTES[NOTES.indexOf(old)] = upd;
    closeEditor();
    refreshTo(upd.id);
    toast("已改");
    return;
  }

  let note = {
    id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    para: n.para, offset: n.offset, end: n.end, quote: n.quote,
    parts, src, ts: new Date().toISOString()
  };
  if (keep) note.note = keep;
  if (LIVE) {
    const r = await post({ op: "add", t: TEXT, note });
    if (!r) return;
    if (r.note) note = r.note;
  }
  NOTES.push(note);
  closeEditor();
  refreshTo(note.id);
  toast(LIVE ? "已存盤" : "已加（唯讀模式，未存盤）");
}

async function post(body) {
  try {
    const r = await fetch("api/note", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.ok) { toast("保存失敗：" + (j.error || "")); return null; }
    return j;
  } catch (e) {
    toast("保存失敗：未連上本地服務");
    return null;
  }
}

async function removeNote(id) {
  if (LIVE) { if (!await post({ op: "delete", t: TEXT, note: { id } })) return; }
  NOTES = NOTES.filter(x => x.id !== id);
  rerender();
  toast("已刪");
}

function rerender() {
  if (MODE === "short") renderAll(true);
  else go(JUAN, true);
}

function refreshTo(id) {
  const y = window.scrollY;
  rerender();
  const el = document.getElementById("n-" + id);
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 900);
  } else {
    window.scrollTo({ top: y });
  }
}

/* ---------- 工具 ---------- */
const tcClose = $("#tcClose");
if (tcClose) tcClose.onclick = hideTerm;
$("#cleanBtn").onclick = () => {
  const on = document.body.classList.toggle("clean");
  $("#cleanBtn").setAttribute("aria-pressed", on);
  localStorage.setItem("nz_clean", on ? "1" : "0");
};
$("#tocBtn").onclick = () => {
  const on = $("#toc").classList.toggle("on");
  $("#tocBtn").setAttribute("aria-pressed", on);
};
function setFs(v) {
  FS = Math.max(15, Math.min(30, v));
  document.documentElement.style.setProperty("--fs", FS + "px");
  localStorage.setItem("nz_fs", FS);
}
$("#fsPlus").onclick = () => setFs(FS + 1);
$("#fsMinus").onclick = () => setFs(FS - 1);

addEventListener("scroll", () => {
  const h = document.documentElement;
  $("#bar").style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight || 1) * 100) + "%";
  $("#tip").style.display = "none";
  hideTerm();
  if (MODE === "short" || !DOC) return;
  const heads = [...document.querySelectorAll(".pin h2")];
  let cur = "";
  for (const x of heads) { if (x.getBoundingClientRect().top < 110) cur = x.textContent; }
  const j = DOC.blocks.find(b => b.k === "juan" && b.n === JUAN);
  if (j) $("#where").innerHTML = esc(j.short || j.label || "") + (cur ? ' <em>' + esc(cur) + "</em>" : "");
}, { passive: true });

addEventListener("keydown", e => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || MODE === "short" || !DOC) return;
  const js = DOC.blocks.filter(b => b.k === "juan");
  if (e.key === "ArrowRight" && JUAN < js.length) go(JUAN + 1);
  if (e.key === "ArrowLeft" && JUAN > 1) go(JUAN - 1);
});

boot();
})();
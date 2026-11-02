/* 術語表頁：讀寫 glossary/terms.json
 *
 * 資料結構：{ version, terms: [{ k, t, aka[], auto, refs[] }] }
 * k=詞，t=釋義（空則顯示「待撰」，且不在注文中自動加鏈）
 * 寫入走 POST /api/term（op: update / add / delete），由 serve.py 落盤。
 * 與閱讀頁一樣，存與取消只用滑鼠，不綁鍵盤。
 */
(function () {
"use strict";

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const TEXT_IDS = ["T42n1824", "T08n0251"];

let TERMS = [], USES = {}, editing = null, LIVE = true;

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2200);
}

/* 網址加時間戳，繞開瀏覽器對同址 GET 的舊響應（見 reader.js 同名函數）。 */
function bust(u) {
  return u + (u.indexOf("?") < 0 ? "?" : "&") + "_=" + Date.now();
}

async function loadTerms() {
  try {
    const r = await fetch(bust("api/terms"), { cache: "no-store" });
    if (r.ok) { const d = await r.json(); LIVE = true; return d.terms || []; }
  } catch (e) { /* 靜態託管時無此接口 */ }
  LIVE = false;
  try {
    const r = await fetch(bust("glossary/terms.json"), { cache: "no-store" });
    if (r.ok) { const d = await r.json(); return d.terms || []; }
  } catch (e) {}
  return [];
}

async function countUses() {
  const texts = [];
  for (const id of TEXT_IDS) {
    let d = null;
    try {
      const r = await fetch(bust("api/notes?t=" + id), { cache: "no-store" });
      if (r.ok) d = await r.json();
    } catch (e) { LIVE = false; }
    if (!d) {
      // 靜態託管：接口不在，改讀倉庫裡的注釋檔
      try {
        const r = await fetch(bust("annotations/" + id + ".json"), { cache: "no-store" });
        if (r.ok) d = await r.json();
      } catch (e) { /* 該文本沒有注釋檔，跳過 */ }
    }
    if (!d) continue;
    const notes = Array.isArray(d) ? d : (d.notes || []);
    for (const n of notes) {
      if (n.note) texts.push(n.note);
      for (const p of (n.parts || [])) if (p && p.t) texts.push(p.t);
    }
  }
  const blob = texts.join("\n");
  USES = {};
  for (const t of TERMS) {
    let c = 0;
    for (const w of [t.k].concat(t.aka || [])) {
      if (!w) continue;
      let i = 0;
      while ((i = blob.indexOf(w, i)) >= 0) { c++; i += w.length; }
    }
    USES[t.k] = c;
  }
}

function rowEl(t) {
  const d = document.createElement("div");
  d.className = "g-row"; d.dataset.k = t.k;
  d.setAttribute("role", "button");
  d.tabIndex = 0;
  const has = t.t && t.t.trim();
  const n = USES[t.k] || 0;
  d.innerHTML =
    '<span class="g-k' + (has ? "" : " wait") + '">' + esc(t.k) + "</span>" +
    '<span class="g-aka">' + esc((t.aka || []).join("　")) + "</span>" +
    '<span class="g-t' + (has ? "" : " wait") + '">' +
      (has ? esc(t.t.replace(/\s+/g, " ").slice(0, 60)) : "待撰") + "</span>" +
    '<span class="g-n">' + (n ? n : "") + "</span>" +
    '<span class="g-car" aria-hidden="true">›</span>';
  d.onclick = () => toggleRow(d, t);
  d.onkeydown = e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(d, t); }
  };
  return d;
}

/* 點一條即就地展開全文，適合通讀；再點收起。
   一次只開一條——「空」這類長條有九百多字，同時開幾條會把列表撐散。 */
function panelEl(t) {
  const box = document.createElement("div");
  box.className = "g-panel";
  const meta = [];
  if ((t.aka || []).length) meta.push("異名　" + t.aka.join("、"));
  if ((t.refs || []).length) meta.push("所據　" + t.refs.join("、"));
  let h = "";
  if (meta.length) h += '<p class="g-p-meta">' + esc(meta.join("　｜　")) + "</p>";

  const paras = (t.t || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
  h += paras.length
    ? paras.map(s => "<p>" + esc(s) + "</p>").join("")
    : '<p class="g-p-meta">釋義待撰</p>';

  // 所引：與術語卡的引文同一格式，書名・品名・引文・行號四層
  if (t.src && t.src.length) {
    h += '<div class="tc-quote"><div class="tq-k">所引</div>' + t.src.map(s => {
      const o = typeof s === "string" ? { w: s } : s;
      let x = '<div class="tq-h">' + esc([o.w, o.p].filter(Boolean).join("　")) + "</div>";
      if (o.q) x += '<div class="tq-q">' + esc(o.q) + "</div>";
      if (o.l) x += '<div class="tq-l">' + esc(o.l) + "</div>";
      return x;
    }).join("") + "</div>";
  }

  // 本機才有改動的必要；線上藏起，免得讀者以為壞了
  if (LIVE) h += '<p class="g-p-edit"><span>編輯這條 →</span></p>';
  box.innerHTML = h;
  if (LIVE) box.querySelector(".g-p-edit").onclick = e => {
    e.stopPropagation();
    openEdit(t);
  };
  return box;
}

function toggleRow(row, t) {
  const wasOpen = row.classList.contains("on");
  document.querySelectorAll(".g-row.on").forEach(r => r.classList.remove("on"));
  document.querySelectorAll(".g-panel").forEach(p => p.remove());
  if (wasOpen) return;
  row.classList.add("on");
  const panel = panelEl(t);
  row.after(panel);
  // 展開後若底部落到視口外：短條整條挪進來，長條則把行頂對到頂欄之下，從頭讀起
  try {
    const pr = panel.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - 12) {
      const fits = pr.height + 76 < window.innerHeight;
      (fits ? panel : row).scrollIntoView({ block: fits ? "end" : "start", behavior: "smooth" });
    }
  } catch (e) { /* 老瀏覽器沒有 scrollIntoView 選項，忽略 */ }
}

function render() {
  const q = ($("#gq").value || "").trim();
  const list = $("#gList");
  list.innerHTML = "";
  let shown = 0, done = 0;
  for (const t of TERMS) {
    if (t.t && t.t.trim()) done++;
    const hay = [t.k].concat(t.aka || [], [t.t || ""]).join(" ");
    if (q && hay.indexOf(q) < 0) continue;
    list.appendChild(rowEl(t));
    shown++;
  }
  if (q && !LIVE && !TERMS.some(t => t.k === q)) {
    const add = document.createElement("div");
    add.className = "g-row";
    add.innerHTML = '<span class="g-k wait">＋ 新增</span><span class="g-aka"></span>' +
      '<span class="g-t">「' + esc(q) + '」</span><span class="g-n"></span>';
    add.onclick = () => openEdit({ k: q, t: "", aka: [], auto: true, refs: [] }, true);
    list.appendChild(add);
  }
  if (!shown && !q) {
    list.innerHTML = '<p class="g-empty">尚未讀到術語。檢查 glossary/terms.json，或在上方輸入新詞。</p>';
  }
  $("#gCount").textContent = "已撰 " + done + " / " + TERMS.length + " 條";
}

const grow = el => { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight + 2, 420) + "px"; };

function openEdit(t, isNew) {
  const ro = !LIVE;
  if (ro && isNew) return;          // 只讀模式下不新增
  editing = { k: t.k, isNew: !!isNew, src: t.src || [] };  // src（所引）暫由 JSON 維護，存檔時原樣帶回
  $("#ged").classList.add("on");
  $("#ged").classList.toggle("ro", ro);
  $("#gedHead").innerHTML = isNew
    ? "新增術語：<b>" + esc(t.k) + "</b>"
    : "術語：<b>" + esc(t.k) + "</b>" +
      ((USES[t.k] || 0) ? "　注文中出現 " + USES[t.k] + " 次" : "") +
      (ro ? "　<span class=\"ed-ro\">唯讀</span>" : "");
  $("#gk").value = t.k;
  $("#gaka").value = (t.aka || []).join("、");
  $("#gt").value = t.t || "";
  $("#grefs").value = (t.refs || []).join("、");
  $("#gsrc").textContent = (t.src && t.src.length)
    ? t.src.map(s => (s.w || "") + (s.p ? "　" + s.p : "")).join("；") + "（引文在 glossary/terms.json 中改）"
    : "無";
  $("#gauto").checked = !!t.auto;
  // 只讀：欄位能選能複製，不能改；存與刪收起來，只剩「關閉」
  ["#gk", "#gaka", "#gt", "#grefs"].forEach(s => { $(s).readOnly = ro; });
  $("#gauto").disabled = ro;
  $("#gSave").style.display = ro ? "none" : "";
  $("#gDel").style.display = (ro || isNew) ? "none" : "";
  $("#gCancel").textContent = ro ? "關閉" : "取消";
  $("#gHint").textContent = ro
    ? "唯讀：釋義取自倉庫，改動請在本機開啟服務後進行"
    : (isNew ? "存後即入表" : "");
  grow($("#gt"));
  $("#gt").focus();
  $("#gt").setSelectionRange($("#gt").value.length, $("#gt").value.length);
}

function closeEdit() {
  $("#ged").classList.remove("on");
  editing = null;
}

async function post(body) {
  try {
    const r = await fetch("api/term", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.ok) { toast("保存失敗：" + (j.error || "")); return false; }
    return true;
  } catch (e) { toast("保存失敗：未連上本地服務"); return false; }
}

function readForm() {
  return {
    k: $("#gk").value.trim(),
    src: (editing && editing.src) || [],
    t: $("#gt").value.trim(),
    aka: $("#gaka").value.split(/[、,，;；]/).map(s => s.trim()).filter(Boolean),
    refs: $("#grefs").value.split(/[、,，;；]/).map(s => s.trim()).filter(Boolean),
    auto: $("#gauto").checked
  };
}

async function save() {
  if (!editing || !LIVE) return;
  const rec = readForm();
  if (!rec.k) { toast("術語不能為空"); return; }
  if (editing.k !== rec.k && TERMS.some(t => t.k === rec.k)) {
    toast("已有同名詞條"); return;
  }
  const op = editing.isNew ? "add" : "update";
  if (LIVE && !await post({ op: op, term: rec, old: editing.k })) return;

  const i = TERMS.findIndex(t => t.k === editing.k);
  if (i >= 0) TERMS[i] = rec; else TERMS.push(rec);
  if (LIVE) await countUses();
  closeEdit();
  render();
  toast(op === "add" ? "已新增" : "已存");
}

$("#gSave").onclick = save;
$("#gCancel").onclick = closeEdit;
$("#gDel").onclick = async () => {
  if (!editing || !LIVE) return;
  if (!confirm("刪去術語「" + editing.k + "」？注文中的鏈接會失效（文字仍在）。")) return;
  if (LIVE && !await post({ op: "delete", term: { k: editing.k } })) return;
  TERMS = TERMS.filter(t => t.k !== editing.k);
  closeEdit();
  render();
  toast("已刪");
};
$("#gq").addEventListener("input", render);
$("#gt").addEventListener("input", () => grow($("#gt")));

(async function boot() {
  TERMS = await loadTerms();
  await countUses();
  render();

  // 靜態託管：無寫接口，整頁轉為唯讀瀏覽
  if (!LIVE) {
    document.body.classList.add("ro");
    const sub = $("#gSub");
    if (sub) {
      sub.innerHTML = "注文中可點之詞，釋義皆在此。留空者標「待撰」，暫不在注文裡加鏈。<br>" +
        "點任一條即展開全文，再點收起。線上為定稿只讀本，改動請在本機服務中進行。";
    }
  }

  const h = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  if (h) {
    const t = TERMS.find(x => x.k === h);
    if (t) {
      const row = document.querySelector('.g-row[data-k="' + h.replace(/"/g, '\\"') + '"]');
      if (row) {
        // 從注文點進來的詞：先就位，再展開，展開區不會把頁面推得亂跳
        try { row.scrollIntoView({ block: "start" }); } catch (e) {}
        toggleRow(row, t);
      }
    } else if (LIVE) {
      openEdit({ k: h, t: "", aka: [], auto: true, refs: [] }, true);
    }
  }
  if (!TERMS.length) {
    $("#gList").innerHTML = '<p class="g-empty">未能讀到術語檔（glossary/terms.json）。請以本地服務開啟本頁。</p>';
  }
})();
})();

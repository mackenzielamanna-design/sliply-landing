/* September Step Challenge */

const SUPABASE_URL = "https://qwodrfmeuoxehunbmfqp.supabase.co";
const SUPABASE_KEY = "sb_publishable_yXnECOMeoMiGJPrEa-SGpA_UXxfV0q5";

const CHALLENGE_START = "2026-09-01";
const CHALLENGE_END = "2026-09-30";
const CHALLENGE_DAYS = 30;
const TEAM_GOAL = 3000000; // 10 people x 10k steps x 30 days
const EMOJIS = ["🚶", "🏃", "⚡", "🔥", "🦶", "👟", "🐢", "🐇", "🌟", "💪"];

const $ = (id) => document.getElementById(id);

let members = [];
let logs = [];
let me = null; // { id, name, emoji }
let chosenEmoji = EMOJIS[0];

/* ---------- helpers ---------- */

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmt(n) {
  return n.toLocaleString("en-US");
}

async function api(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`API ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/* ---------- data ---------- */

async function loadData() {
  [members, logs] = await Promise.all([
    api("step_members?select=id,name,emoji,created_at&order=name.asc"),
    api("step_logs?select=member_id,log_date,steps&order=log_date.asc"),
  ]);
}

function challengeLogs() {
  return logs.filter((l) => l.log_date >= CHALLENGE_START && l.log_date <= CHALLENGE_END);
}

function totalsByMember(rows) {
  const map = new Map();
  for (const l of rows) {
    map.set(l.member_id, (map.get(l.member_id) || 0) + l.steps);
  }
  return map;
}

/* ---------- rendering ---------- */

function renderStatus() {
  const today = localDateStr();
  const el = $("challenge-status");
  if (today < CHALLENGE_START) {
    const days = Math.round(
      (new Date(CHALLENGE_START + "T12:00") - new Date(today + "T12:00")) / 86400000
    );
    el.textContent = `Starts Sept 1 — ${days} day${days === 1 ? "" : "s"} to go. Logs before then are just practice!`;
  } else if (today <= CHALLENGE_END) {
    const day = Math.round(
      (new Date(today + "T12:00") - new Date(CHALLENGE_START + "T12:00")) / 86400000
    ) + 1;
    el.textContent = `Day ${day} of ${CHALLENGE_DAYS} — keep moving!`;
  } else {
    el.textContent = "The challenge has ended — final results below 🏁";
  }
}

function renderIdentity() {
  if (me) {
    $("join-section").classList.add("hidden");
    $("log-section").classList.remove("hidden");
    $("week-section").classList.remove("hidden");
    $("greeting").textContent = `${me.emoji} Hi, ${me.name}!`;
    $("my-member-id").textContent = me.id;
  } else {
    $("join-section").classList.remove("hidden");
    $("log-section").classList.add("hidden");
    $("week-section").classList.add("hidden");
    renderMemberChips();
  }
}

function renderMemberChips() {
  const wrap = $("member-list");
  wrap.innerHTML = "";
  for (const m of members) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "member-chip";
    btn.textContent = `${m.emoji} ${m.name}`;
    btn.addEventListener("click", () => {
      me = m;
      localStorage.setItem("step_member", JSON.stringify(m));
      renderIdentity();
      renderAll();
    });
    wrap.appendChild(btn);
  }
}

function renderEmojiPicker() {
  const row = $("emoji-row");
  row.innerHTML = "";
  for (const e of EMOJIS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "emoji-option";
    btn.textContent = e;
    btn.setAttribute("aria-pressed", String(e === chosenEmoji));
    btn.addEventListener("click", () => {
      chosenEmoji = e;
      renderEmojiPicker();
    });
    row.appendChild(btn);
  }
}

function renderTeam() {
  $("team-section").classList.remove("hidden");
  const rows = challengeLogs();
  const total = rows.reduce((s, l) => s + l.steps, 0);
  const today = localDateStr();
  const todayTotal = logs
    .filter((l) => l.log_date === today)
    .reduce((s, l) => s + l.steps, 0);

  $("team-total").textContent = fmt(total);
  $("team-today").textContent = fmt(todayTotal);

  const pct = Math.min(100, (total / TEAM_GOAL) * 100);
  $("team-progress-fill").style.width = `${pct}%`;
  $("team-progressbar").setAttribute("aria-valuenow", pct.toFixed(0));
  $("goal-caption").textContent =
    `${pct.toFixed(1)}% of the ${fmt(TEAM_GOAL)}-step team goal`;
}

function renderLeaderboard() {
  $("board-section").classList.remove("hidden");
  const today = localDateStr();
  const totals = totalsByMember(challengeLogs());
  const todaySteps = totalsByMember(logs.filter((l) => l.log_date === today));

  $("board-caption").textContent =
    today < CHALLENGE_START
      ? "Totals count Sept 1–30 only — the board resets when the challenge starts."
      : "Totals for Sept 1–30.";

  const ranked = [...members].sort(
    (a, b) => (totals.get(b.id) || 0) - (totals.get(a.id) || 0)
  );

  const list = $("leaderboard");
  list.innerHTML = "";
  const medals = ["🥇", "🥈", "🥉"];
  ranked.forEach((m, i) => {
    const li = document.createElement("li");
    if (me && m.id === me.id) li.classList.add("me");
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = medals[i] || String(i + 1);
    const name = document.createElement("span");
    name.className = "board-name";
    name.textContent = `${m.emoji} ${m.name}`;
    const total = document.createElement("span");
    total.className = "board-total";
    total.textContent = fmt(totals.get(m.id) || 0);
    const todayEl = document.createElement("span");
    todayEl.className = "board-today";
    const t = todaySteps.get(m.id);
    todayEl.textContent = t != null ? `${fmt(t)} today` : "— today";
    li.append(rank, name, total, todayEl);
    list.appendChild(li);
  });

  if (!ranked.length) {
    const li = document.createElement("li");
    li.textContent = "Nobody has joined yet — be the first!";
    list.appendChild(li);
  }
}

function renderWeek() {
  if (!me) return;
  const mine = new Map(
    logs.filter((l) => l.member_id === me.id).map((l) => [l.log_date, l.steps])
  );

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      date: localDateStr(d),
      label: d.toLocaleDateString("en-US", { weekday: "narrow" }),
      steps: mine.get(localDateStr(d)) ?? null,
    });
  }

  const max = Math.max(...days.map((d) => d.steps || 0), 1);
  const todayStr = localDateStr();
  const maxDay = days.reduce((a, b) => ((b.steps || 0) > (a.steps || 0) ? b : a));

  const chart = $("week-chart");
  chart.innerHTML = "";
  for (const d of days) {
    const col = document.createElement("div");
    col.className = "week-col";
    col.title = `${d.date}: ${d.steps != null ? fmt(d.steps) + " steps" : "no log"}`;

    // direct-label only the peak day and today, to avoid label pile-up
    if (d.steps != null && (d === maxDay || d.date === todayStr)) {
      const val = document.createElement("span");
      val.className = "week-value";
      val.textContent = fmt(d.steps);
      col.appendChild(val);
    }

    const bar = document.createElement("div");
    bar.className = "week-bar" + (d.steps == null ? " empty" : "");
    bar.style.height = d.steps != null ? `${Math.max(2, (d.steps / max) * 100)}%` : "2px";
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      `${d.date}: ${d.steps != null ? fmt(d.steps) + " steps" : "no log"}`
    );
    const day = document.createElement("span");
    day.className = "week-day";
    day.textContent = d.label;
    col.append(bar, day);
    chart.appendChild(col);
  }

  const weekTotal = days.reduce((s, d) => s + (d.steps || 0), 0);
  $("week-summary").textContent = `${fmt(weekTotal)} steps in the last 7 days`;
}

function renderOwed() {
  const banner = $("owed-banner");
  if (!me) { banner.classList.add("hidden"); return; }

  const today = localDateStr();
  // owed = challenge days before today with no entry, starting from whichever
  // is later: Sept 1 or the day the member joined
  const member = members.find((m) => m.id === me.id);
  const joined = member?.created_at ? member.created_at.slice(0, 10) : CHALLENGE_START;
  const from = joined > CHALLENGE_START ? joined : CHALLENGE_START;
  const mine = new Set(
    logs.filter((l) => l.member_id === me.id).map((l) => l.log_date)
  );

  const missing = [];
  const cursor = new Date(from + "T12:00");
  while (localDateStr(cursor) < today && localDateStr(cursor) <= CHALLENGE_END) {
    const ds = localDateStr(cursor);
    if (!mine.has(ds)) missing.push(ds);
    cursor.setDate(cursor.getDate() + 1);
  }

  if (!missing.length) {
    banner.classList.add("hidden");
    return;
  }

  banner.classList.remove("hidden");
  $("owed-title").textContent =
    `⏰ You owe the board ${missing.length} day${missing.length === 1 ? "" : "s"} — tap one to fill it in:`;

  const wrap = $("owed-days");
  wrap.innerHTML = "";
  for (const ds of missing) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "owed-day";
    btn.textContent = new Date(ds + "T12:00").toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    });
    btn.addEventListener("click", () => {
      $("log-date").value = ds;
      $("log-steps").focus();
      $("log-form").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    wrap.appendChild(btn);
  }
}

function renderAll() {
  renderStatus();
  renderIdentity();
  renderTeam();
  renderLeaderboard();
  renderWeek();
  renderOwed();
}

/* ---------- actions ---------- */

async function joinTeam(name) {
  try {
    const [created] = await api("step_members", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ name, emoji: chosenEmoji }),
    });
    me = created;
    localStorage.setItem("step_member", JSON.stringify(created));
    members.push(created);
    members.sort((a, b) => a.name.localeCompare(b.name));
    renderAll();
  } catch (err) {
    if (err.status === 409) {
      alert("That name is already on the board — tap it in the list instead!");
    } else {
      alert("Couldn't join right now. Check your connection and try again.");
      console.error(err);
    }
  }
}

async function saveSteps(date, steps) {
  const btn = $("save-btn");
  const fb = $("log-feedback");
  btn.disabled = true;
  fb.textContent = "";
  fb.className = "feedback";
  try {
    await api("step_logs?on_conflict=member_id,log_date", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ member_id: me.id, log_date: date, steps }),
    });
    // update local cache
    const existing = logs.find((l) => l.member_id === me.id && l.log_date === date);
    if (existing) existing.steps = steps;
    else logs.push({ member_id: me.id, log_date: date, steps });
    fb.textContent = `Saved — ${fmt(steps)} steps on ${date} ✅`;
    fb.classList.add("ok");
    $("log-steps").value = "";
    renderAll();
  } catch (err) {
    fb.textContent = "Couldn't save. Check your connection and try again.";
    fb.classList.add("error");
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- init ---------- */

function initForms() {
  const dateInput = $("log-date");
  dateInput.value = localDateStr();
  dateInput.min = "2026-08-01";
  dateInput.max = localDateStr();

  $("join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("join-name").value.trim();
    if (name) joinTeam(name);
  });

  $("log-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = dateInput.value;
    const steps = parseInt($("log-steps").value, 10);
    if (!date || Number.isNaN(steps)) return;
    saveSteps(date, steps);
  });

  $("switch-user").addEventListener("click", () => {
    me = null;
    localStorage.removeItem("step_member");
    renderIdentity();
    renderLeaderboard();
  });
}

async function init() {
  renderEmojiPicker();
  initForms();
  renderStatus();

  const saved = localStorage.getItem("step_member");
  if (saved) {
    try { me = JSON.parse(saved); } catch { me = null; }
  }

  try {
    await loadData();
    // if saved identity no longer exists in DB, forget it
    if (me && !members.some((m) => m.id === me.id)) {
      me = null;
      localStorage.removeItem("step_member");
    }
  } catch (err) {
    $("challenge-status").textContent = "Couldn't reach the team board — check your connection and refresh.";
    console.error(err);
    return;
  }

  renderAll();

  // keep the board fresh if people leave the tab open
  setInterval(async () => {
    try {
      await loadData();
      renderAll();
    } catch { /* transient — next tick will retry */ }
  }, 60000);
}

init();

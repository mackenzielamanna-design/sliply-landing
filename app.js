/* Steply — September Step Challenge */

// Steply has its own Supabase project — nothing shared with any other app.
const SUPABASE_URL = "https://gogdajlwbreorwqonkwy.supabase.co";
const SUPABASE_KEY = "sb_publishable_J9a5uq022f7lGPF38nqjng_KdTEGXBl";

const CHALLENGE_START = "2026-09-01";
const CHALLENGE_END = "2026-09-30";
const CHALLENGE_DAYS = 30;
// The stretch number we'd love to hit: 10 people x 10k steps x 30 days.
// The goal the app actually paces against is built bottom-up from what
// people pledge (see teamGoal), because a target you picked yourself is
// far more binding than one handed to you.
const STRETCH_GOAL = 3000000;
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

function displayName(m) {
  const initial = m.last_name ? ` ${m.last_name[0].toUpperCase()}.` : "";
  return `${m.first_name}${initial}`;
}

/* ---------- auth ---------- */

// The team signs in with their name, not an email, so we synthesize a stable
// address from first + last. Nothing is ever sent to it.
function emailFor(first, last) {
  const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${slug(first)}.${slug(last)}@steply.local`;
}

let session = null;

function saveSession(s) {
  if (!s || !s.access_token) return;
  session = { ...s, expires_at: Date.now() + (s.expires_in ?? 3600) * 1000 };
  localStorage.setItem("steply_session", JSON.stringify(session));
}

function clearSession() {
  session = null;
  localStorage.removeItem("steply_session");
}

async function authFetch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data.error_description || data.msg || data.message || `Auth error ${res.status}`
    );
    err.status = res.status;
    err.code = data.error_code || data.code;
    throw err;
  }
  return data;
}

async function signIn(first, last, password) {
  saveSession(
    await authFetch("/token?grant_type=password", {
      email: emailFor(first, last),
      password,
    })
  );
}

async function signUp(first, last, password, emoji) {
  const data = await authFetch("/signup", {
    email: emailFor(first, last),
    password,
    data: { first_name: String(first).trim(), last_name: String(last).trim(), emoji },
  });
  // With confirmation off, signup returns a session directly; otherwise sign in.
  if (data.access_token) saveSession(data);
  else await signIn(first, last, password);
}

async function refreshSession() {
  if (!session || !session.refresh_token) return false;
  try {
    saveSession(
      await authFetch("/token?grant_type=refresh_token", {
        refresh_token: session.refresh_token,
      })
    );
    return true;
  } catch {
    clearSession();
    return false;
  }
}

async function api(path, options = {}, allowRetry = true) {
  // Refresh a minute before expiry so a long-open tab keeps working.
  if (session && session.expires_at && Date.now() > session.expires_at - 60000) {
    await refreshSession();
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${(session && session.access_token) || SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && allowRetry && session) {
    if (await refreshSession()) return api(path, options, false);
  }
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`API ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/* ---------- data ---------- */

// Sum of everyone's self-set daily pledges, scaled across the challenge.
// Falls back to the stretch number before anyone has committed.
function pledgedDaily() {
  return members.reduce((s, m) => s + (m.daily_goal || 0), 0);
}

function teamGoal() {
  const daily = pledgedDaily();
  return daily > 0 ? daily * CHALLENGE_DAYS : STRETCH_GOAL;
}

async function loadData() {
  [members, logs] = await Promise.all([
    api("step_members?select=id,first_name,last_name,emoji,created_at,daily_goal&order=first_name.asc"),
    api("step_logs?select=member_id,log_date,steps&order=log_date.asc"),
  ]);
}

function dayIndex(ds) {
  return Math.round(
    (new Date(ds + "T12:00") - new Date(CHALLENGE_START + "T12:00")) / 86400000
  );
}

// Challenge days that are fully in the past. Today is excluded everywhere we
// judge people — it isn't over yet, and counting it would invent debt.
function completedDays() {
  const today = localDateStr();
  if (today < CHALLENGE_START) return 0;
  return Math.min(CHALLENGE_DAYS, Math.max(0, dayIndex(today)));
}

function settledLogs() {
  const today = localDateStr();
  return challengeLogs().filter((l) => l.log_date < today);
}

// What you owe your own contract: pledge x days elapsed, minus what you walked.
// Positive = debt, negative = credit. Null if you haven't pledged.
function memberDebt(m, days, rows) {
  if (m.daily_goal == null || days < 1) return null;
  const walked = rows
    .filter((l) => l.member_id === m.id)
    .reduce((s, l) => s + l.steps, 0);
  return m.daily_goal * days - walked;
}

// Consecutive days logged, counting back from today (or yesterday if today
// isn't in yet — the day is still young).
function currentStreak(memberId) {
  const dates = new Set(
    logs.filter((l) => l.member_id === memberId).map((l) => l.log_date)
  );
  const d = new Date();
  if (!dates.has(localDateStr(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (dates.has(localDateStr(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function daysSinceLastLog(memberId) {
  const mine = logs
    .filter((l) => l.member_id === memberId)
    .map((l) => l.log_date)
    .sort();
  if (!mine.length) return null;
  const last = mine[mine.length - 1];
  return Math.round(
    (new Date(localDateStr() + "T12:00") - new Date(last + "T12:00")) / 86400000
  );
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
  const signedIn = !!(session && me);
  $("auth-section").classList.toggle("hidden", signedIn);
  for (const id of ["log-section", "week-section", "pledge-section"]) {
    $(id).classList.toggle("hidden", !signedIn);
  }
  if (signedIn) {
    $("greeting").textContent = `${me.emoji} Hi, ${me.first_name}!`;
    $("my-member-id").textContent = me.id;
  }
}

let authMode = "signin";

function setAuthMode(mode) {
  authMode = mode;
  const up = mode === "signup";
  $("tab-signin").setAttribute("aria-pressed", String(!up));
  $("tab-signup").setAttribute("aria-pressed", String(up));
  $("signup-only").classList.toggle("hidden", !up);
  $("auth-btn").textContent = up ? "Create account" : "Sign in";
  $("auth-intro").textContent = up
    ? "New here? Pick a password you'll remember — there's no email to reset it with."
    : "Welcome back — sign in with your name and password.";
  $("auth-password").setAttribute("autocomplete", up ? "new-password" : "current-password");
  $("auth-feedback").textContent = "";
}

async function submitAuth() {
  const first = $("auth-first").value.trim();
  const last = $("auth-last").value.trim();
  const password = $("auth-password").value;
  const fb = $("auth-feedback");
  const btn = $("auth-btn");
  if (!first || !last || !password) return;

  btn.disabled = true;
  fb.textContent = "";
  fb.className = "feedback";
  try {
    if (authMode === "signup") await signUp(first, last, password, chosenEmoji);
    else await signIn(first, last, password);
    await loadData();
    me = members.find((m) => m.id === session.user.id) || null;
    if (!me) throw new Error("Signed in, but your profile is missing. Tell Mackenzie.");
    $("auth-password").value = "";
    renderAll();
  } catch (err) {
    fb.classList.add("error");
    const msg = String(err.message || "");
    if (/already registered|already exists/i.test(msg)) {
      fb.textContent = "That name already has an account — switch to Sign in.";
    } else if (/invalid login|credentials/i.test(msg)) {
      fb.textContent = "Name or password doesn't match. Check the spelling of both names.";
    } else if (/password/i.test(msg) && /short|least|6/i.test(msg)) {
      fb.textContent = "Password needs to be at least 6 characters.";
    } else {
      fb.textContent = msg || "Something went wrong. Try again.";
    }
    console.error(err);
  } finally {
    btn.disabled = false;
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

  const goal = teamGoal();
  const pct = Math.min(100, (total / goal) * 100);
  $("team-progress-fill").style.width = `${pct}%`;
  $("team-progressbar").setAttribute("aria-valuenow", pct.toFixed(0));
  $("goal-caption").textContent =
    `${pct.toFixed(1)}% of the ${fmt(goal)}-step team goal`;
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
    name.textContent = `${m.emoji} ${displayName(m)}`;
    const streak = currentStreak(m.id);
    if (streak >= 2) {
      const s = document.createElement("span");
      s.className = "streak";
      s.textContent = `🔥${streak}`;
      s.title = `${streak}-day logging streak`;
      name.appendChild(s);
    }
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

function renderPledge() {
  const section = $("pledge-section");
  if (!me) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");

  const mine = members.find((m) => m.id === me.id);
  const input = $("pledge-input");
  if (document.activeElement !== input) {
    input.value = mine?.daily_goal != null ? mine.daily_goal : "";
  }

  // Your own balance against your contract, front and centre
  const days = completedDays();
  const rows = settledLogs();
  const myDebt = mine ? memberDebt(mine, days, rows) : null;
  const debtEl = $("my-debt");
  if (myDebt == null) {
    debtEl.textContent = "";
    debtEl.className = "my-debt";
  } else if (myDebt > 0) {
    const perDay = Math.ceil(myDebt / Math.max(1, CHALLENGE_DAYS - days));
    debtEl.textContent = `📉 You owe your contract ${fmt(Math.round(myDebt))} steps. Clear it with about ${fmt(perDay)} extra a day for the rest of the month.`;
    debtEl.className = "my-debt behind";
  } else if (myDebt === 0) {
    debtEl.textContent = `🤝 Square with your contract — exactly where you said you'd be.`;
    debtEl.className = "my-debt ahead";
  } else {
    debtEl.textContent = `📈 You're ${fmt(Math.round(-myDebt))} steps ahead of your contract. Banked.`;
    debtEl.className = "my-debt ahead";
  }

  const roster = $("pledge-roster");
  roster.innerHTML = "";
  for (const m of members) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "pledge-name";
    name.textContent = `${m.emoji} ${displayName(m)}`;
    const val = document.createElement("span");
    if (m.daily_goal != null) {
      val.className = "pledge-value";
      val.textContent = `${fmt(m.daily_goal)}/day`;
    } else {
      val.className = "pledge-value unset";
      val.textContent = "not committed yet";
    }
    // Pledges are public — that's the commitment. Debt is deliberately NOT
    // shown here: everyone sees only their own balance (see #my-debt above).
    li.append(name, val);
    roster.appendChild(li);
  }

  const daily = pledgedDaily();
  const committed = members.filter((m) => m.daily_goal != null).length;
  const missing = members.length - committed;

  if (daily === 0) {
    $("pledge-summary").textContent =
      `Nobody has committed yet. Until then the app paces against the ${fmt(STRETCH_GOAL)} stretch goal.`;
    return;
  }

  const total = daily * CHALLENGE_DAYS;
  const gap = STRETCH_GOAL - total;
  const parts = [
    `${committed} of ${members.length} committed — ${fmt(daily)} steps/day pledged, or ${fmt(total)} over the month.`,
  ];
  if (missing > 0) {
    parts.push(`${missing} still to go, so this number will climb.`);
  }
  parts.push(
    gap > 0
      ? `That's ${fmt(gap)} short of the ${fmt(STRETCH_GOAL)} stretch goal — about ${fmt(Math.ceil(gap / CHALLENGE_DAYS))} more steps/day to find.`
      : `That clears the ${fmt(STRETCH_GOAL)} stretch goal by ${fmt(-gap)}. 🎉`
  );
  $("pledge-summary").textContent = parts.join(" ");
}

async function savePledge(value) {
  const btn = $("pledge-btn");
  const fb = $("pledge-feedback");
  btn.disabled = true;
  fb.textContent = "";
  fb.className = "feedback";
  try {
    await api(`step_members?id=eq.${encodeURIComponent(me.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ daily_goal: value }),
    });
    const mine = members.find((m) => m.id === me.id);
    if (mine) mine.daily_goal = value;
    me.daily_goal = value;
    fb.textContent = `Committed to ${fmt(value)} steps a day 🤝`;
    fb.classList.add("ok");
    renderAll();
  } catch (err) {
    fb.textContent = "Couldn't save your commitment. Check your connection and try again.";
    fb.classList.add("error");
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

// Catch a quiet drop-out while the days lost are still recoverable.
function renderAlerts() {
  const section = $("alert-section");
  const list = $("alert-list");
  const today = localDateStr();

  if (today < CHALLENGE_START || !members.length) {
    section.classList.add("hidden");
    return;
  }

  const days = completedDays();
  const rows = settledLogs();
  const teamAvg =
    rows.length > 0 ? rows.reduce((s, l) => s + l.steps, 0) / rows.length : 8000;

  const quiet = [];
  for (const m of members) {
    const since = daysSinceLastLog(m.id);
    // never logged at all, or silent for 3+ days
    if (since == null) quiet.push({ m, since: days, never: true });
    else if (since >= 3) quiet.push({ m, since, never: false });
  }
  quiet.sort((a, b) => b.since - a.since);

  if (!quiet.length) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  list.innerHTML = "";
  for (const q of quiet) {
    const li = document.createElement("li");
    const rate = q.m.daily_goal ?? Math.round(teamAvg);
    const cost = rate * q.since;
    const name = document.createElement("span");
    name.className = "alert-name";
    name.textContent = `${q.m.emoji} ${displayName(q.m)}`;
    const detail = document.createElement("span");
    detail.className = "alert-detail";
    detail.textContent = q.never
      ? `never logged · ~${fmt(cost)} missing`
      : `quiet ${q.since} days · ~${fmt(cost)} missing`;
    li.append(name, detail);
    list.appendChild(li);
  }
}

// Team analytics: what it would actually take to win from here.
// Pace is measured over COMPLETED days only — today is still in progress and
// counting it would drag every average down and make us look behind.
function renderStrategy() {
  const section = $("strategy-section");
  const today = localDateStr();
  const dayIndex = (ds) =>
    Math.round((new Date(ds + "T12:00") - new Date(CHALLENGE_START + "T12:00")) / 86400000);

  if (today < CHALLENGE_START || !members.length) {
    section.classList.add("hidden");
    return;
  }

  const completedDays = Math.min(CHALLENGE_DAYS, Math.max(0, dayIndex(today)));
  if (completedDays < 1) {
    section.classList.add("hidden");
    return;
  }
  const remainingDays = Math.max(0, CHALLENGE_DAYS - completedDays);

  const done = challengeLogs().filter((l) => l.log_date < today);
  const stepsSoFar = done.reduce((s, l) => s + l.steps, 0);
  const avgPerDay = stepsSoFar / completedDays;
  const projected = stepsSoFar + avgPerDay * remainingDays;
  const goal = teamGoal();
  const neededPerDay = remainingDays > 0 ? (goal - stepsSoFar) / remainingDays : 0;

  section.classList.remove("hidden");

  // Headline verdict
  const verdict = $("pace-verdict");
  verdict.className = "verdict";
  if (remainingDays === 0) {
    verdict.textContent =
      stepsSoFar >= goal
        ? `🏆 Final: ${fmt(stepsSoFar)} steps — goal smashed!`
        : `🏁 Final: ${fmt(stepsSoFar)} steps, ${fmt(goal - stepsSoFar)} short.`;
    verdict.classList.add(stepsSoFar >= goal ? "ahead" : "behind");
  } else if (projected >= goal) {
    verdict.textContent =
      `✅ On pace to finish around ${fmt(Math.round(projected))} — that's ${fmt(Math.round(projected - goal))} past the goal. Hold this pace.`;
    verdict.classList.add("ahead");
  } else {
    verdict.textContent =
      `⚠️ On pace to finish around ${fmt(Math.round(projected))} — ${fmt(Math.round(goal - projected))} short. Here's where to find it:`;
    verdict.classList.add("behind");
  }

  $("pace-current").textContent = fmt(Math.round(avgPerDay));
  $("pace-needed").textContent = remainingDays > 0 ? fmt(Math.max(0, Math.round(neededPerDay))) : "—";

  // Actionable levers, biggest first
  const list = $("insights");
  list.innerHTML = "";
  const add = (icon, html) => {
    const li = document.createElement("li");
    const ic = document.createElement("span");
    ic.className = "icon";
    ic.textContent = icon;
    const txt = document.createElement("span");
    txt.innerHTML = html;
    li.append(ic, txt);
    list.appendChild(li);
  };

  // 1. Participation — the biggest and cheapest lever
  const possible = members.length * completedDays;
  const filled = done.length;
  const missed = possible - filled;
  const rate = possible > 0 ? (filled / possible) * 100 : 0;
  const avgPerLog = filled > 0 ? stepsSoFar / filled : 0;
  if (missed > 0) {
    add("🕳️", `<strong>${missed} unlogged day${missed === 1 ? "" : "s"}</strong> across the team — roughly <strong>${fmt(Math.round(missed * avgPerLog))} steps</strong> missing from our total. Participation is ${rate.toFixed(0)}%; chasing those logs is the cheapest win available.`);
  } else {
    add("💯", `<strong>100% participation</strong> — every teammate has logged every day. That alone beats most teams.`);
  }

  // 2. Are people keeping their own promises? Counted, not named — the point
  // is to size the gap, not to put anyone on blast.
  const pledgers = members.filter((m) => m.daily_goal != null);
  if (pledgers.length) {
    let behindCount = 0;
    let shortfall = 0;
    for (const m of pledgers) {
      const theirs = done.filter((l) => l.member_id === m.id);
      const theirAvg = theirs.reduce((s, l) => s + l.steps, 0) / completedDays;
      if (theirAvg < m.daily_goal) {
        behindCount++;
        shortfall += m.daily_goal - theirAvg;
      }
    }
    if (behindCount > 0) {
      add("🤝", `<strong>${behindCount} of ${pledgers.length}</strong> ${behindCount === 1 ? "person is" : "people are"} running below the number they committed to — <strong>${fmt(Math.round(shortfall))} steps/day</strong> short between them. Everyone picked their own target, so this is the fairest gap to chase.`);
    } else {
      add("🤝", `<strong>Everyone is hitting the number they committed to.</strong> Hold this and the goal takes care of itself.`);
    }
  }

  // 3. The small-ask lever
  if (remainingDays > 0) {
    const bump = members.length * 1000 * remainingDays;
    add("➕", `If <strong>everyone</strong> added just <strong>1,000 steps a day</strong> (about a 10-minute walk) for the remaining ${remainingDays} day${remainingDays === 1 ? "" : "s"}, that's <strong>${fmt(bump)} extra steps</strong> — spread across ten people it's far easier than asking one person to go hard.`);
  }

  // 4. Where the headroom is — aggregated, not named, so nobody gets called out
  const perMember = new Map();
  for (const l of done) {
    if (!perMember.has(l.member_id)) perMember.set(l.member_id, []);
    perMember.get(l.member_id).push(l.steps);
  }
  let headroom = 0;
  for (const [, vals] of perMember) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const best = Math.max(...vals);
    headroom += Math.max(0, best - avg);
  }
  if (headroom > 0 && remainingDays > 0) {
    add("📈", `Everyone's <strong>average is ${fmt(Math.round(headroom))} steps/day below their own personal best</strong> combined. Nobody needs to do anything they haven't already done once — just repeat good days more often.`);
  }

  // 5. Weakest weekday — only once there's enough data to mean anything
  const distinctDays = new Set(done.map((l) => l.log_date)).size;
  if (distinctDays >= 7) {
    const byDow = new Map();
    for (const l of done) {
      const dow = new Date(l.log_date + "T12:00").getDay();
      if (!byDow.has(dow)) byDow.set(dow, []);
      byDow.get(dow).push(l.steps);
    }
    let worst = null;
    for (const [dow, vals] of byDow) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (!worst || avg < worst.avg) worst = { dow, avg };
    }
    if (worst) {
      const name = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][worst.dow];
      add("📉", `<strong>${name} are our weakest day</strong> (${fmt(Math.round(worst.avg))} avg per person). That's the easiest place to claw back steps.`);
    }
  }
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
  renderPledge();
  renderAlerts();
  renderStrategy();
}

/* ---------- actions ---------- */

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

  $("tab-signin").addEventListener("click", () => setAuthMode("signin"));
  $("tab-signup").addEventListener("click", () => setAuthMode("signup"));

  $("auth-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitAuth();
  });

  $("log-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const date = dateInput.value;
    const steps = parseInt($("log-steps").value, 10);
    if (!date || Number.isNaN(steps)) return;
    saveSteps(date, steps);
  });

  $("pledge-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = parseInt($("pledge-input").value, 10);
    if (Number.isNaN(v) || v < 0) return;
    savePledge(v);
  });

  $("switch-user").addEventListener("click", () => {
    clearSession();
    me = null;
    members = [];
    logs = [];
    setAuthMode("signin");
    renderAll();
  });
}

function restoreSession() {
  const saved = localStorage.getItem("steply_session");
  if (!saved) return;
  try {
    const s = JSON.parse(saved);
    if (s && s.access_token && s.refresh_token) session = s;
  } catch {
    clearSession();
  }
}

async function init() {
  renderEmojiPicker();
  setAuthMode("signin");
  initForms();
  renderStatus();
  restoreSession();

  if (!session) {
    renderIdentity();
    return;
  }

  // A stored token may be stale after a long gap; refresh before trusting it.
  if (session.expires_at && Date.now() > session.expires_at - 60000) {
    await refreshSession();
  }

  try {
    if (session) {
      await loadData();
      me = members.find((m) => m.id === session.user.id) || null;
      if (!me) clearSession();
    }
  } catch (err) {
    // 401 means the session is dead; anything else is a network problem.
    if (err.status === 401) clearSession();
    else $("challenge-status").textContent = "Couldn't reach the board — check your connection and refresh.";
    console.error(err);
  }

  renderAll();

  // Keep the board fresh if someone leaves the tab open all day.
  setInterval(async () => {
    if (!session) return;
    try {
      await loadData();
      renderAll();
    } catch { /* transient — the next tick retries */ }
  }, 60000);
}

init();

/* Steply — September Step Challenge */

const SUPABASE_URL = "https://qwodrfmeuoxehunbmfqp.supabase.co";
const SUPABASE_KEY = "sb_publishable_yXnECOMeoMiGJPrEa-SGpA_UXxfV0q5";

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
    api("step_members?select=id,name,emoji,created_at,daily_goal&order=name.asc"),
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
    name.textContent = `${m.emoji} ${m.name}`;
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
    name.textContent = `${m.emoji} ${m.name}`;
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
    localStorage.setItem("step_member", JSON.stringify(me));
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
    name.textContent = `${q.m.emoji} ${q.m.name}`;
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

  $("pledge-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = parseInt($("pledge-input").value, 10);
    if (Number.isNaN(v) || v < 0) return;
    savePledge(v);
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

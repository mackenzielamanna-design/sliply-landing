# 👟 September Step Challenge

A tiny web app for our 10-person team step challenge (Sept 1–30). Everyone logs
their daily steps from their phone, and the app shows a live leaderboard, the
team's progress toward a shared goal, and your own last-7-days chart.

No accounts or passwords — you pick your name once and it's remembered on your
device. Steps are on the honor system. 😉

## How it works

- **Frontend:** plain HTML/CSS/JS (`index.html`, `styles.css`, `app.js`) — no build step.
- **Backend:** Supabase (Postgres + REST). Two tables: `step_members` and `step_logs`.
  One row per person per day; re-saving a day just updates it.

## Hosting

It's a static site, so any static host works. Easiest: enable **GitHub Pages**
for this repo (Settings → Pages → deploy from branch), then share the URL with
the team. Everyone can "Add to Home Screen" on their phone so it feels like an app.

## Changing the settings

At the top of `app.js`:

| Constant | Meaning | Default |
|---|---|---|
| `CHALLENGE_START` / `CHALLENGE_END` | Challenge window | Sept 1–30, 2026 |
| `TEAM_GOAL` | Shared team step goal | 3,000,000 (10 people × 10k × 30 days) |
| `EMOJIS` | Avatar choices | 🚶 🏃 ⚡ 🔥 … |

## Automatic sync from iPhone (Apple Health)

The site includes step-by-step instructions in the "Sync steps from your phone"
section. The endpoint details for the Shortcuts **Get Contents of URL** action:

- **URL:** `https://qwodrfmeuoxehunbmfqp.supabase.co/rest/v1/step_logs?on_conflict=member_id,log_date`
- **Method:** POST
- **Headers:**
  - `apikey`: `sb_publishable_yXnECOMeoMiGJPrEa-SGpA_UXxfV0q5`
  - `Authorization`: `Bearer sb_publishable_yXnECOMeoMiGJPrEa-SGpA_UXxfV0q5`
  - `Content-Type`: `application/json`
  - `Prefer`: `resolution=merge-duplicates`
- **JSON body:**

```json
{
  "member_id": "<your member ID — shown in the sync section of the app after you join>",
  "log_date": "<Current Date, formatted yyyy-MM-dd>",
  "steps": "<step sum from Find Health Samples>"
}
```

(The `apikey` above is the project's *publishable* key — it's designed to be
public, and the database only allows reading and upserting step logs with it.)

Android has no built-in Shortcuts equivalent for health data, so Android
teammates log manually — it's two taps.

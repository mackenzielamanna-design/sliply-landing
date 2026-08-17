# 👟 Steply

Steply is a tiny web app for our 10-person team step challenge (Sept 1–30). Everyone logs
their daily steps from their phone, and the app shows a live leaderboard, the
team's progress toward a shared goal, and your own last-7-days chart.

Everyone signs in with their **first name, last name, and a password**. The
database enforces that you can only write your own steps and your own pledge —
you can see the whole team's board, but you can't edit anyone else's row.
Step counts themselves are still on the honor system. 😉

## How it works

- **Frontend:** plain HTML/CSS/JS (`index.html`, `styles.css`, `app.js`) — no build step.
- **Backend:** Supabase (Postgres + REST + Auth) in a project dedicated to Steply
  (`gogdajlwbreorwqonkwy`) — deliberately separate from any other app, so the
  logins and data can't touch each other. Two tables: `step_members` (one row per
  account, created automatically on sign-up) and `step_logs` (one row per person
  per day; re-saving a day updates it).

## Accounts

Sign-up asks for first name, last name, and a password. Because the team logs in
by name rather than email, the app synthesizes a stable address
(`first.last@steply.local`) behind the scenes — nothing is ever mailed to it, and
a database trigger marks it confirmed on creation so sign-in works immediately.

**There is no password reset** — there's no real inbox to send one to. If someone
forgets theirs, reset it directly:

```sql
update auth.users
set encrypted_password = crypt('newpassword', gen_salt('bf'))
where email = 'first.last@steply.local';
```

If sign-up is ever blocked (for example if email confirmations get switched on in
the dashboard), you can create an account by hand:

```sql
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
  'authenticated', 'first.last@steply.local', crypt('theirpassword', gen_salt('bf')),
  '{"provider":"email"}',
  '{"first_name":"First","last_name":"Last","emoji":"🚶"}',
  now(), now()
);
```

The profile row is created automatically by a trigger.

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

Now that Steply has real logins, a Shortcut has to sign in before it can write —
the database rejects anything without a valid user token. That makes this two
"Get Contents of URL" actions instead of one.

**Step 1 — get a token.**

- **URL:** `https://gogdajlwbreorwqonkwy.supabase.co/auth/v1/token?grant_type=password`
- **Method:** POST
- **Headers:** `apikey`: `sb_publishable_J9a5uq022f7lGPF38nqjng_KdTEGXBl`, `Content-Type`: `application/json`
- **Body (JSON):** `{"email": "first.last@steply.local", "password": "yourpassword"}`

Use your own name in the address, lowercase and without punctuation — Mackenzie
Lamanna becomes `mackenzie.lamanna@steply.local`. Then add a **Get Dictionary
Value** action for the key `access_token`.

**Step 2 — write the steps.**

- **URL:** `https://gogdajlwbreorwqonkwy.supabase.co/rest/v1/step_logs?on_conflict=member_id,log_date`
- **Method:** POST
- **Headers:**
  - `apikey`: `sb_publishable_J9a5uq022f7lGPF38nqjng_KdTEGXBl`
  - `Authorization`: `Bearer ` followed by the `access_token` from step 1
  - `Content-Type`: `application/json`
  - `Prefer`: `resolution=merge-duplicates`
- **Body (JSON):**

```json
{
  "member_id": "<your member ID — shown in the sync section of the app once you sign in>",
  "log_date": "<Current Date, formatted yyyy-MM-dd>",
  "steps": "<step sum from Find Health Samples>"
}
```

The `apikey` above is the project's *publishable* key — it is designed to be
public and grants nothing on its own; every write still needs your personal
token from step 1, and that token only ever lets you write your own rows.

Your Shortcut will hold your password, so keep it on your own phone.

Android has no built-in Shortcuts equivalent for health data, so Android
teammates log manually — it's two taps.

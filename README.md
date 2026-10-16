# CareerPulse – Job Tracker (local prototype)

CareerPulse reads your Gmail (read-only), uses **Google Gemini** to spot real job-application updates
(application confirmations, assessments, interviews, offers, rejections), and keeps a **Kanban board** of your
applications up to date automatically.

> Single-user prototype that runs on your laptop. Email bodies are **never stored**. Only the extracted fields
> (company, role, stage, date, link, one-line summary) and the Gmail message ID are saved.

```
Gmail ──► gmailService (OAuth, fetch, MIME → text)
            │
            ▼
        classifier (Gemini JSON mode, few-shot, rate-limited + retries)
            │
            ▼
        syncService ──► matcher (fuzzy company/role match, forward-only stages)
            │
            ▼
        MongoDB: Application · ProcessedEmail · StageHistory · GoogleToken
            │
            ▼
        Express REST API ◄──► React (Vite) dashboard
```

## Tech stack
| Layer | Tools |
|---|---|
| Backend | Node.js 18+, Express, ES modules, dotenv, cors |
| Database | MongoDB + Mongoose (local or Atlas free tier) |
| Gmail | `googleapis`, scope `gmail.readonly` |
| AI | `@google/genai`, model from `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) with automatic fallback models |
| Frontend | React 18 + Vite, `@hello-pangea/dnd`, `recharts`, plain CSS |

## Project structure
```
├── package.json            # root: "dev" runs server + client together (concurrently)
├── .env.example            # copy to .env
├── credentials.json        # your Google OAuth client (git-ignored)
├── server/
│   ├── index.js            # Express app + MongoDB connection
│   ├── config/index.js     # loads ../.env, all settings in one place
│   ├── models/             # Application, ProcessedEmail, StageHistory, GoogleToken
│   ├── services/
│   │   ├── gmailService.js # OAuth + reading emails
│   │   ├── classifier.js   # Gemini classification
│   │   ├── matcher.js      # fuzzy matching, platform detection, stage rules
│   │   └── syncService.js  # fetch → classify → store
│   ├── routes/             # auth.js, applications.js, sync.js, insights.js
│   └── scripts/testClassifier.js
└── client/                 # React dashboard (Vite)
```

---

## Setup and first run

### 0. Prerequisites
- Node.js 18.18+ (`node -v`)
- MongoDB: either local (`mongodb://localhost:27017/careerpulse`) or a free Atlas cluster connection string
- `credentials.json` (Google OAuth client) in the **project root**
- A Gemini API key from <https://aistudio.google.com/apikey>

### About your OAuth client (Desktop app vs Web application)
Your existing **Desktop app** client works as it is. Google lets Desktop clients redirect to any
`http://localhost:<port>/<path>` (the "loopback" flow), so the callback
`http://localhost:5000/api/auth/google/callback` is accepted without registering anything.

If you ever get **`Error 400: redirect_uri_mismatch`**, create a Web client instead:
1. Google Cloud Console → **APIs & Services → Credentials → + Create credentials → OAuth client ID**
2. Application type: **Web application**, name: `CareerPulse local`
3. **Authorized JavaScript origins:** `http://localhost:5173`
4. **Authorized redirect URIs:** `http://localhost:5000/api/auth/google/callback`
   (if you change `PORT` in `.env`, use that port here)
5. Create → **Download JSON** → save it as `credentials.json` in the project root (replace the old one).
   The app reads both formats (`"installed"` or `"web"`).

### 1. Install everything
```bash
npm run install:all
```
(The first time, run `npm install` first if `install:all` isn't found. It installs root, `server/`, and `client/`.)

### 2. Create and fill in `.env`
```powershell
Copy-Item .env.example .env      # PowerShell   (macOS/Linux/Git Bash: cp .env.example .env)
```
Edit `.env` and set at least:
```
GEMINI_API_KEY=<your key>
MONGODB_URI=mongodb://localhost:27017/careerpulse     # or your Atlas URI
```

### 3. Check that your Gemini key works (classifier accuracy test)
```bash
npm run test:classifier
```
This runs 10 realistic sample emails (Naukri, TCS/HackerRank, Infosys, LinkedIn alerts, foundit, offer letter,
Quess…) through Gemini and prints predicted vs expected stage plus overall accuracy. It takes about 45 seconds because of the
4-second free-tier delay. No database or Gmail needed.

### 4. Start the app
```bash
npm run dev
```
- API: <http://localhost:5000> (health check: <http://localhost:5000/api/health>)
- Dashboard: <http://localhost:5173>

### 5. Connect Gmail
Open <http://localhost:5173>, then click **Connect Gmail**, pick your test-user account, and allow read-only access.
Because the consent screen is in *Testing* mode, Google shows an "unverified app" warning: click
**Continue**. You'll land back on the dashboard with your email shown in the header.

### 6. Run your first sync
Click **Sync Gmail**. The server searches the last 30 days, classifies up to 50 new emails (about 4 seconds each),
and shows a summary banner when it's done. Each email is only processed once, so later syncs are quick.

You can also trigger it from a terminal:
```bash
curl -X POST http://localhost:5000/api/sync -H "Content-Type: application/json" -d "{\"days\":30,\"max\":20}"
```

---

## Dashboard pages
- **/** – metrics and the Kanban board. The toolbar has search, sort (latest update, upcoming event, company, oldest) and filters for platform, source and time. Settings live in the URL, so a refresh or bookmark keeps them. Cards created or changed by the last sync are marked **New** and float to the top with the default sort.
- **/insights** – totals and per-platform response rates.
- **/activity** – the last 100 emails CareerPulse looked at, filterable by result.

## How syncing works
- **Runs in the background.** The dashboard polls `/api/sync/status` and shows a progress overlay; a page refresh picks the running sync back up.
- **Incremental.** After a sync that left nothing behind, the next one only searches Gmail from an hour before it started. If a sync stops early or hits errors, the next one goes back over the full `SYNC_DAYS` window, so nothing is skipped.
- **Auto-sync.** Opening the dashboard more than 6 hours after the last sync starts a quick incremental sync on its own.
- **Cheap on quota.** Pure job-alert senders are excluded in the Gmail search, other obvious alerts are skipped by rules, new messages in the same thread are classified together, and the rest go to Gemini 10 per request.

## Accounts (sign in with Google)
There are no passwords: **the Gmail account you sign in with is your CareerPulse account.**
- Each Gmail address gets its own private board, sync progress and history. Accounts never see each other's data.
- The account menu (top right) has **Switch Gmail account**, **Sign out**, and **Disconnect Gmail & sign out**. Your data stays saved and is there again when you sign back in.
- Sessions are stored in MongoDB (`sessions` collection) and signed with `SESSION_SECRET`, so you stay signed in across restarts for 30 days.
- **Adding another Gmail:** while the OAuth app is in *Testing* mode, Google only lets listed accounts sign in. Go to Google Cloud Console → **Google Auth Platform → Audience → Test users → + Add users**, add the address, then use **Switch Gmail account**.
- Upgrading from the single-user version: on first start, all existing data is assigned to the Gmail account that was connected (`server/scripts/migrateToMultiUser.js`, runs automatically and only once).

## How the AI pipeline decides things
- **Search query:** `newer_than:30d (interview OR assessment OR shortlisted OR "your application" OR "regret to inform" OR offer OR "thank you for applying" OR "next round" OR "test link")`
- **Classifier:** sends sender, subject, date, and the first 1,500 characters of the body. Gemini returns JSON
  (`is_job_related, company, role, stage, event_date, link, summary, confidence`). Job alerts and newsletters → not job related.
- **Confidence < 0.6** → ignored, but still recorded in `ProcessedEmail` so it isn't re-sent to Gemini.
- **Matching:** company names are normalised (removes "Pvt Ltd", "Limited", "Technologies", "India"…) and compared
  with Levenshtein similarity ≥ 0.8. If a role is given, a card with the same role is preferred. A different role at
  the same company becomes a new card.
- **Stages only move forward:** Applied → Assessment → Interview → Offer. *Rejected* can happen at any stage.
  Emails are processed oldest-first. Manual drag-and-drop can move a card anywhere.
- **Platform** is inferred from the sender: naukri.com → Naukri, linkedin.com → LinkedIn, foundit.in → foundit,
  other company domains → company site.
- Every stage change is logged in `StageHistory` (`changedBy: "ai" | "manual"`).

## API reference
| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/google` | Redirect to Google consent |
| GET | `/api/auth/google/callback` | OAuth callback (saves tokens) |
| GET | `/api/auth/status` | `{ loggedIn, email, connected, needsReconnect }` |
| POST | `/api/auth/logout` | Sign out (data and Gmail connection stay saved) |
| POST | `/api/auth/disconnect` | Forget this account's Gmail tokens and sign out |
| POST | `/api/sync` | Start a background sync (returns the job; one per account at a time) |
| GET | `/api/sync/status` | `{ job: { status, phase, done, total, percent, summary, error }, lastSyncAt, lastCompleteSyncAt }` |
| GET | `/api/applications` | All applications |
| POST | `/api/applications` | Add manually `{ company, role, stage, platform }` |
| PATCH | `/api/applications/:id` | Update fields/stage (logged as manual) |
| DELETE | `/api/applications/:id` | Delete |
| GET | `/api/applications/:id/history` | Stage timeline |
| GET | `/api/activity?limit=20` | Most recently processed emails, up to 100 (AI results only, no email content) |

## Configuration (`.env`)
| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | – | Gemini key (required) |
| `SESSION_SECRET` | – | Long random string that signs the login cookie (required; changing it signs everyone out) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Main model (free-tier quotas are per model per day; `gemini-2.5-flash` allows only 20/day) |
| `GEMINI_FALLBACK_MODELS` | – | Comma-separated backups used automatically when a model hits its daily quota or is overloaded |
| `MONGODB_URI` | `mongodb://localhost:27017/careerpulse` | Database |
| `PORT` | `5000` | API port |
| `CLIENT_URL` | `http://localhost:5173` | Dashboard URL (CORS, post-login redirect, Vite port) |
| `SYNC_DAYS` | `30` | Gmail search window |
| `SYNC_MAX_EMAILS` | `300` | New emails handled per sync (the banner shows how many are still waiting) |
| `GEMINI_BATCH_SIZE` | `10` | Emails per Gemini request (the free tier counts requests, so batching = ~10x more per day) |
| `GEMINI_DELAY_MS` | `4000` | Delay between Gemini requests |
| `GEMINI_MAX_RETRIES` | `4` | Retries on 429/quota (exponential backoff) |
| `MIN_CONFIDENCE` | `0.6` | Minimum confidence to update the board |

## Troubleshooting
- **"Reconnect Gmail" appears after about a week:** refresh tokens for apps in *Testing* mode expire after 7 days. Click
  **Reconnect Gmail**.
- **`Port 5173 is already in use`:** another app is using that port. Set `CLIENT_URL=http://localhost:5174` in `.env`
  (Vite follows it). If you use a Web OAuth client, add that origin in Cloud Console too.
- **`Could not connect to MongoDB`:** start MongoDB, or check the Atlas URI and make sure your IP is allowed under *Network Access*.
- **Classifier says "Gemini rejected the request":** check `GEMINI_API_KEY` and that `GEMINI_MODEL` is a current model name
  (see <https://ai.google.dev/gemini-api/docs/models>).
- **Lots of 429 retries / "Partial sync":** the free tier has per-model daily limits (see <https://aistudio.google.com/rate-limit>). Add more models to `GEMINI_FALLBACK_MODELS`, lower `SYNC_MAX_EMAILS`, or just sync again tomorrow – unprocessed emails are picked up automatically.

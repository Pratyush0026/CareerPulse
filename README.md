# CareerPulse – Job Tracker (local prototype)

CareerPulse reads your Gmail (read-only), uses **Google Gemini** to spot real job-application updates
(application confirmations, assessments, interviews, offers, rejections), and keeps a **Kanban board** of your
applications up to date automatically.

> Local prototype. Each Google account you sign in with has its own separate data. Email bodies are **never stored**. Only the extracted fields
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
| Document Parsing | `pdf-parse`, `mammoth`, `multer` (in-memory processing, zero file retention) |
| Frontend | React 18 + Vite, `@hello-pangea/dnd`, `recharts`, plain CSS |

## Project structure
```
├── package.json            # root: "dev" runs server + client together, "lint" runs ESLint
├── eslint.config.js        # lint rules for client and server
├── .env.example            # copy to .env
├── credentials.json        # your Google OAuth client (git-ignored)
├── server/
│   ├── index.js            # Express app + MongoDB connection
│   ├── config/index.js     # loads ../.env, all settings in one place
│   ├── models/             # Application, ProcessedEmail, StageHistory, GoogleToken, User,
│   │                       # CareerProfile, ProfileRevision, SkillEvidence, JobOpportunity,
│   │                       # Recommendation, InterviewReflection, Experiment, Migration
│   ├── middleware/         # requireLogin.js, aiLimit.js
│   ├── services/
│   │   ├── gemini.js       # shared Gemini client: spacing, retries, fallback models, daily limit
│   │   ├── gmailService.js # OAuth + reading emails
│   │   ├── classifier.js   # Gemini classification
│   │   ├── matcher.js      # fuzzy matching, platform detection, stage rules
│   │   ├── emailFilter.js  # skips newsletters and job alerts before they reach the AI
│   │   ├── syncService.js  # fetch → classify → store
│   │   ├── syncJobs.js     # background sync jobs and their progress
│   │   ├── resumeParser.js # PDF & DOCX in-memory text extraction
│   │   ├── careerDnaService.js, profileInput.js  # resume extraction, profile validation
│   │   ├── evidenceEngine.js, skillNormalizer.js # skill evidence
│   │   ├── jobDnaService.js, jobFit.js           # job requirements and fit scoring
│   │   └── recommendations.js, interviews.js, experiments.js # action plan
│   ├── routes/             # auth, applications, sync, activity, careerDna, jobDna, actionPlan
│   ├── scripts/            # startup migrations, testClassifier.js
│   └── tests/              # careerDna.test.js
└── client/                 # React dashboard (Vite)
    └── src/
        ├── pages/          # DashboardPage, InsightsPage, ActivityPage, CareerDnaPage
        └── components/     # UI components & career-dna/ subcomponents
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
- **/career-dna** – Career DNA: your professional profile, the evidence behind each skill, and job fit checks. See below.
- **/insights** – totals and per-platform response rates.
- **/activity** – the last 100 emails CareerPulse looked at, filterable by result.

## Career DNA
Career DNA builds a profile you can check and correct, and keeps track of *why* it believes each thing.

**Profile (Phase 1)**
- Upload a PDF or DOCX resume (5 MB max) or build the profile by hand. The file is checked by type, extension and its
  first bytes, parsed in memory and never saved. Scanned or image-only PDFs are rejected with a clear message.
- The resume text is sent to Gemini, which returns a draft. Nothing is saved until you review it. Everything taken from the
  resume starts **unconfirmed** – skills, roles and AI-inferred interests only count as confirmed once you confirm them.
- Missing facts stay missing: no guessed years of experience, no links that aren't in the resume.
- Uploading a newer resume merges new roles, projects and skills into your profile; your goals and confirmations are kept.
- Completeness measures how filled-in the profile is, not how employable you are.

**Skills & evidence (Phase 2)**
- Each skill gets an evidence level: *Assessment-validated*, *Supported by a project or experience*, *User-confirmed*,
  *Mentioned* (only on the resume) or *Needs more evidence*. "Why this level?" shows the records behind it.
- A role only counts as evidence when its description or a bullet mentions the skill – not the job title alone.
  Matching knows aliases (React.js = React) but keeps different technologies apart, and ignores everyday words ("go", "express").
- You can mark profile-derived evidence as wrong (it stays rejected across rebuilds) or add your own. Assessments can't be
  self-declared.

**Job fit (Phase 3)**
- Paste a job description, optionally linked to one of your tracked applications. Gemini separates required from
  nice-to-have requirements; the comparison with your profile is plain code, so the same input always gives the same result.
- Each requirement shows its evidence, quality, what's missing and a next step. No evidence is never treated as a gap.
  Years of experience come from real dates (overlaps counted once) – if dates are missing it says so instead of guessing.
- Skills match however they're written: versions ("IIB 10"), vendor names ("IBM MQ" / "WebSphere MQ"), abbreviations
  ("IBM Integration Bus (IIB)") and either/or requirements ("Web Services (REST/SOAP)"). A role that describes the
  work counts even if the skill isn't in your skills list; a line that only touches on it ("batch APIs" for "Batch Job
  Development") counts as partial and is quoted. Jobs that only accept certain institutions are left for you to judge.
- **Coverage score:** shown in a project/role = 100%, confirmed or listed = 55%, unclear = 35%, none = 0%; required items
  weigh 3×. Fewer than 3 requirements gives "Insufficient data". It is not a probability of being hired. A low score
  is "Limited Evidence" unless something on the profile actually contradicts the job ("Significant Mismatch").
- You can correct any requirement (and undo it). Corrections survive recalculation.
- Saved analyses are recalculated automatically when your profile or evidence changes (no AI call). Pasting the same
  description again reuses the stored requirements instead of calling Gemini.
- **History:** every profile save is kept as a read-only copy (`profilerevisions` collection), and each saved job keeps
  its last 100 score changes with the reason (profile change, evidence change, correction). Nothing past is rewritten,
  so a future timeline can show real progress. Data from before history existed starts with one "baseline" entry.

**Action plan** (the third Career DNA tab) turns all of this into next steps. Suggestions are plain code, so every
reason they give comes from stored records; the only AI call is the optional one on interview notes below.
- **Suggestions** come from four places: skills your saved jobs keep asking for that your profile doesn't show yet
  (using the same verdicts as Job fit, including your corrections), interviews and assessments coming up on your board,
  areas you asked to practise in your interview notes, and missing basics (no target role, fewer than 3 saved jobs).
  Each one shows why it exists ("asked for in 4 of your 6 saved jobs"), how sure that is, the effort, and when it
  counts as done.
- **Your decisions stick.** Accept, snooze for a week, dismiss, mark done or report as wrong. Dismissed and reported
  suggestions never come back, and decided ones are never rewritten. When a reason goes away, an accepted step is
  flagged so you can close it and an untouched suggestion simply disappears. Marking something done never changes your
  skill evidence.
- Suggestions are split into High / Medium / Low priority tabs; High opens first (or the first tab with anything in it).
- **Interview notes** are optional and asked for after interviews (assessments rarely come with feedback): topics, hard
  questions, the interviewer's feedback and areas to practise. Only the areas you list become practice tasks; a
  rejection is never read as anything. Topics that came up in more than one interview are shown with how many.
- **Suggest what to work on** (per note, only when you click it) sends that one interview's notes to Gemini for themes
  and up to 4 practice ideas, each with a concrete exercise. Every idea must quote the note lines it came from; anything
  that can't be traced back is dropped, and the wording never judges how the interview went. Nothing becomes a task
  until you press "Add to practice list", and then the suggested exercise becomes that task's finish line. Results are
  saved and only recalculated when the topics, questions or feedback change.
- **Experiments** compare your response rate or interview rate before vs during a change, or between two platforms
  (e.g. referral vs Naukri), using your own board. Results show sample sizes, say "not enough applications yet" below
  10 per group, and always note that it isn't a controlled test. Finishing an experiment freezes its result.
- Dates come from the first email about each application, not when it was imported. Cards from before that was
  recorded use their import date, so older experiment baselines are approximate.

**Privacy & limits**
- Resume and job description text go to Google Gemini only to extract structure; nothing is used across accounts.
- What is kept: the structured profile you saved (never the resume file or its text), evidence records, and the job
  descriptions you paste (so they can be recalculated without calling Gemini again).
- **Delete Career DNA** removes the profile, its history, all evidence, job analyses, suggestions, interview notes and
  experiments for the signed-in account only. Disconnecting Gmail does not delete anything. Deleting an application keeps
  its job analysis and interview notes, just unlinked.
- AI endpoints are limited to one request at a time per account and 15 per 10 minutes. On top of that, all AI use
  (sync included) stops at `GEMINI_DAILY_REQUEST_LIMIT` requests a day; `/api/health` shows today's count.
- These limits and caches live in the server's memory: fine for one server, but they reset on restart and would need
  a shared store (e.g. MongoDB or Redis) if the API ever runs as several instances.
- `server/scripts/migrateCareerDna.js` runs on start and upgrades data from earlier versions (e.g. resume skills that were
  auto-confirmed are reset to unconfirmed).

**Tests:** `npm run test:career-dna` (Node's test runner + an in-memory MongoDB; no Gemini or Gmail calls). Covers file
validation, AI output validation, account isolation, deletion, corrections surviving rebuilds, duplicate prevention,
history and the daily AI limit, the fit maths, and the action plan (suggestion sources, every decision, notes,
experiments and their sample-size warnings). `npm run lint` checks client and server code with ESLint.

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
| GET | `/api/career-dna` | Fetch authenticated user's Career Profile |
| POST | `/api/career-dna/parse-resume` | Read a resume (multipart `resume`, PDF/DOCX) and return an unconfirmed draft – nothing is saved |
| PUT | `/api/career-dna` | Save the profile (whitelisted fields only); rebuilds evidence and job fit |
| DELETE | `/api/career-dna` | Delete the profile, evidence and job analyses for this account |
| GET | `/api/career-dna/evidence` | Overview of all skills with evidence levels, provenance, and stats |
| GET | `/api/career-dna/evidence/:skillName` | Detailed evidence records and provenance for a specific skill |
| POST | `/api/career-dna/evidence` | Add your own evidence (project, role, interview feedback, other – not assessments) |
| PATCH | `/api/career-dna/evidence/:id` | `{ status: "active" \| "rejected", notes }` – mark evidence wrong or restore it |
| DELETE | `/api/career-dna/evidence/:id` | Delete evidence you added (profile-derived evidence is marked wrong instead) |
| POST | `/api/career-dna/evidence/rebuild` | Force re-sync evidence engine from current profile |
| GET | `/api/career-dna/jobs?limit=50&offset=0` | Saved analyses with their scores |
| GET | `/api/career-dna/jobs/applications` | Get candidate's tracked applications for linking with job descriptions |
| GET | `/api/career-dna/jobs/:id` | Full Job DNA requirements, explainable fit breakdown, and tailoring suggestions |
| POST | `/api/career-dna/jobs/analyze` | `{ company, role, rawJobDescription, applicationId }` – the application must be yours; a repeated description is reused |
| GET | `/api/career-dna/jobs/patterns` | Skills that recur across your saved jobs (needs 3+ saved jobs) |
| PATCH | `/api/career-dna/jobs/:id/override` | `{ matchId, userStatus, userNote }` – correct a requirement; `userStatus: null` undoes it |
| DELETE | `/api/career-dna/jobs/:id` | Delete analyzed job opportunity record |
| GET | `/api/career-dna/plan/recommendations` | Recalculates and returns `{ active, history }` |
| PATCH | `/api/career-dna/plan/recommendations/:id` | `{ action: accept \| snooze \| dismiss \| complete \| incorrect \| reopen, note?, snoozeDays? }` |
| GET | `/api/career-dna/plan/interviews` | Rounds waiting for notes, saved notes and recurring topics |
| PUT | `/api/career-dna/plan/interviews/:applicationId` | `{ topics, difficultQuestions, feedback, practiceAreas }` – one set of notes per application |
| POST | `/api/career-dna/plan/interviews/:id/suggestions` | AI practice suggestions from one set of notes (rate-limited; reused while the notes are unchanged) |
| DELETE | `/api/career-dna/plan/interviews/:id` | Delete interview notes |
| GET | `/api/career-dna/plan/experiments` | Experiments with live (running) or frozen (finished) results |
| POST | `/api/career-dna/plan/experiments` | `{ template, hypothesis, action, metric, comparison, platforms?, startDate, endDate }` |
| PATCH | `/api/career-dna/plan/experiments/:id` | `{ action: finish \| abandon, observedOutcome? }` |
| DELETE | `/api/career-dna/plan/experiments/:id` | Delete an experiment |

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
| `GEMINI_DELAY_MS` | `4000` | Delay between Gemini requests (a paid key is fine with `1000`) |
| `GEMINI_DAILY_REQUEST_LIMIT` | `500` | Most Gemini requests per day, retries included. AI features pause with a message once reached |
| `GEMINI_MAX_RETRIES` | `4` | Retries on 429/quota (exponential backoff) |
| `MIN_CONFIDENCE` | `0.6` | Minimum confidence to update the board |

## Troubleshooting
- **"Reconnect Gmail" appears after about a week:** refresh tokens for apps in *Testing* mode expire after 7 days. Click
  **Reconnect Gmail**.
- **`Port 5173 is already in use`:** another app is using that port. Set `CLIENT_URL=http://localhost:5174` in `.env`
  (Vite follows it). If you use a Web OAuth client, add that origin in Cloud Console too.
- **`Could not connect to MongoDB`:** start MongoDB, or check the Atlas URI and make sure your IP is allowed under *Network Access*.
- **"The CareerPulse API isn't running yet":** the API is starting (a few seconds) or has stopped; the server terminal says
  why. `npm run dev` restarts the API with nodemon, which only reacts to real file edits. Node's own `--watch` was
  dropped because on Windows it also restarts when files are merely read, which kept killing the API on startup.
- **`Port 5000 is already in use`:** another copy of the API is still running. Close it, or set a different `PORT` in `.env`.
- **Classifier says "Gemini rejected the request":** check `GEMINI_API_KEY` and that `GEMINI_MODEL` is a current model name
  (see <https://ai.google.dev/gemini-api/docs/models>).
- **Lots of 429 retries / "Partial sync":** the free tier has per-model daily limits (see <https://aistudio.google.com/rate-limit>). Add more models to `GEMINI_FALLBACK_MODELS`, lower `SYNC_MAX_EMAILS`, or just sync again tomorrow – unprocessed emails are picked up automatically.

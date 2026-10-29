# ScoutConnect: Football Talent Identification & Roster Management

| | |
|---|---|
| **Walkthrough video** | |
| **Technical report (PDF)** | |
| **Live API** | https://scoutconnect.onrender.com/api/health (free tier: the first request after idle can take about 30 seconds) |

## 1. Overview

ScoutConnect is an offline-first mobile app that connects grassroots football clubs with talent scouts. The players are
young people, so privacy and safeguarding shape the whole design.

* **Coaches** record evaluations, match statistics and achievements on the pitch with no signal. Records are stored on
  the phone and synchronised when a connection returns.
* **Scouts** browse a minimised, consent-gated view of athletes, filter and sort them, keep a private shortlist with
  notes, download a PDF report, and ask a club for contact. Scouts must be **accredited by an administrator** first.
* **Clubs** can be verified by an administrator. The club owner decides whether a scout may learn an athlete's full
  name and the club's contact details.
* **Administrators** review club verification requests, scout accreditation applications and reports about profiles.

### Feature summary

| Area | What it does |
|---|---|
| Sign-in | Supabase Auth (email and password, Google). The server verifies the token and creates the profile on first sign-in. |
| Coach: evaluations | Five-stage evaluation form with drafts, ratings (1-5) for technical, physical and coaching, and measurements (30m and 10m sprint, bleep level, height, weight, dominant foot). |
| Coach: offline sync | SQLite on the device; automatic sync when the network returns; idempotent, per-item results. |
| Coach: roster | Search, filter by position, edit and remove athletes, record **guardian consent**, view and edit match stats and achievements. |
| Coach: club | Club details, membership approvals, **verification request** with documents, scout contact requests to answer. |
| Scout: accreditation | Application with documents; browsing is locked until an administrator approves. |
| Scout: discover | Compact athlete list, a filter and sort sheet (position, age band, verified clubs, overall rating, ball control, 30m sprint, evaluation type, recency, match stats) and removable filter chips. |
| Scout: athlete profile | Coach ratings, test results, match record, trophies, physical profile, development curve, PDF report, report-a-concern. |
| Scout: shortlist | Search, sort, private notes, remove. |
| Scout: contact requests | Ask the club; the answer, and the club's contact details, appear in the Requests tab only if accepted. |
| Administrator | Queues for club verification, scout accreditation and reports; can hide an athlete from scouts. |

## 2. Technology and versions

| Layer | Technology |
|---|---|
| Mobile app | React Native 0.86, React 19.2, **Expo SDK 57**, Expo Router 57 (file-based navigation), TypeScript 6 |
| On-device storage | `expo-sqlite` (offline queue and drafts), `expo-secure-store` |
| Charts and PDF | `react-native-chart-kit`, `react-native-svg`, `expo-print`, `expo-sharing` |
| Backend | Node.js, **Express 5**, Sequelize 6 (ORM), `jsonwebtoken` |
| Database | PostgreSQL on **Supabase** (session pooler) |
| Auth and storage | Supabase Auth (ES256 tokens verified against the project's JWKS), Supabase Storage (private photo bucket) |
| Email | Resend (optional) |
| Hosting | Render (API), Supabase (database, auth, storage) |
| Testing | Node's built-in test runner (`node --test`) for both packages |

Developed and tested with Node.js 24.22 and npm 11.19. Node 20 or newer should work. Exact package versions are in
the two `package.json` files.

## 3. Architecture

```
 Phone (Expo / React Native)                       Cloud
 ┌──────────────────────────────┐        ┌──────────────────────────────────┐
 │ Screens (src/app)            │  HTTPS │ Render: Express API              │
 │  coach / scout / admin       │ ─────► │  middleware: token + role guards │
 │ Components, pure lib modules │  JWT   │  routes ► services ► lib rules   │
 │ SQLite offline queue ────────┼─ sync ►│  Sequelize models                │
 └───────────────┬──────────────┘        └───────────────┬──────────────────┘
                 │ sign-in                                │ SQL / signed URLs
                 ▼                                        ▼
         Supabase Auth ◄──── JWKS keys ─────── Supabase Postgres + Storage
```

**Request path on the server:** `routes/*` (HTTP only) call `middleware/auth` (who is calling, what they may do),
`services/*` (behaviour shared between routes) and `lib/*` (pure rules that are unit-tested without a database).

### Repository structure

```
ScoutConnect-mobile_app/
├── README.md
├── Assets/                       Figma mock-ups, style guide, database diagram
├── scoutconnect-backend/
│   ├── server.js                 Composition root: builds the app, mounts routers, starts the server
│   ├── config/                   database.js (Sequelize), supabase.js
│   ├── middleware/auth.js        Token verification, role / club-owner / approved-scout guards, search rate limit
│   ├── routes/                   HTTP endpoints, one file per area
│   │   ├── public.js             health check, public club list
│   │   ├── sync.js               idempotent offline sync
│   │   ├── account.js            /me and profile edits
│   │   ├── club.js               club details, membership approvals
│   │   ├── roster.js             roster, athlete / evaluation / match stat / achievement edits
│   │   ├── verification.js       club verification (owner request + admin review)
│   │   ├── accreditation.js      scout accreditation (application + admin review)
│   │   ├── players.js            scout search and athlete detail, coach athlete detail
│   │   ├── shortlist.js          scout shortlist and notes
│   │   ├── contactRequests.js    contact requests (scout side + club owner side)
│   │   └── reports.js            reports about profiles + admin review, hide / unhide athlete
│   ├── services/                 notifications.js, provisioning.js, scoutData.js
│   ├── lib/                      Pure, unit-tested rules: auth, scouts (privacy rules), verification, profile,
│   │                             reports, photos, emails, notify, membership, query
│   ├── models/index.js           Sequelize models and associations
│   └── test/                     Unit and route-level tests
└── scoutconnect-frontend/
    ├── database.ts               SQLite schema and the offline queue
    ├── src/app/                  Screens (Expo Router): index (sign-in), coach/, scout/, admin/
    ├── src/components/           Reusable UI: FormSheet, ScoutPlayerRow, VerificationCard, DocumentAttachments ...
    ├── src/lib/                  api client, ratings, discoverFilters, report (PDF HTML), age, consent ...
    │                             (pure modules have *.test.mjs files beside them)
    └── src/constants/            design system, positions
```

## 4. Getting started

### Prerequisites

* Node.js 20+ and npm
* A PostgreSQL database (a free Supabase project works) and a Supabase project for authentication
* For the phone: the Expo Go app, or an Android emulator / iOS simulator

### Backend

```bash
cd scoutconnect-backend
npm install
cp .env.example .env        # then fill in the values (Windows PowerShell: Copy-Item .env.example .env)
npm start                   # nodemon server.js, listens on PORT (default 5000)
```

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (**required**). Tables are created on start. |
| `SUPABASE_URL` | Project URL, used to fetch the signing keys that verify sign-in tokens |
| `SUPABASE_JWT_SECRET` | Verifying tokens signed with the older HS256 method (optional if the project uses ES256) |
| `JWT_SECRET` | Signing synced evaluations. Set a long random value. |
| `SUPABASE_SERVICE_ROLE_KEY` | Athlete photos: lets the server make short-lived signed links. Without it no photos show. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email notifications. Without them everything works but nobody is emailed. |
| `ADMIN_NOTIFY_EMAIL` | Where administrator notifications are sent (comma separated) |
| `PORT` | Listening port |

Never commit `.env`; it is ignored by git.

### Mobile app

```bash
cd scoutconnect-frontend
npm install
cp .env.example .env        # EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start -c
```

Scan the QR code with Expo Go, or press `a` for an Android emulator. By default the app talks to the deployed API
(`https://scoutconnect.onrender.com/api`); set `EXPO_PUBLIC_API_URL` to point it at your own backend. If a native
module is missing in Expo Go, create a development build with `npx expo run:android`.

### Accounts

| Role | How to get one |
|---|---|
| Coach | Register in the app and choose a club (a new club makes you its owner; joining an existing one waits for the owner's approval) |
| Scout | Register in the app, then apply for accreditation on the Discover tab |
| Administrator | In the Supabase dashboard, open the user and set `app_metadata` to `{"role": "admin"}` |

_Test accounts for markers: **[add one coach, one scout and one administrator login here]**_

## 5. Testing

```bash
cd scoutconnect-backend  && npm test    # 120 tests
cd scoutconnect-frontend && npm test    # 50 tests
cd scoutconnect-frontend && npx tsc --noEmit    # type check
```

* **Unit tests** cover the pure rules: token verification, the scout privacy view, consent and age rules, club
  verification checklist, report validation, photo signing, email content, rating maths, filter logic, PDF report
  content.
* **Route-level (integration) tests** call the real Express app over HTTP with in-memory stand-ins for the database
  models. They check authentication, role and membership gating, idempotent sync, accreditation, consent-gated search,
  contact-request cooldowns and the release of identity and contact details only after acceptance.

## 6. Design decisions and technical highlights

**Separation of concerns.** Screens only render and call the API; pure modules hold the rules and are testable
without React Native; the server keeps HTTP handling (`routes`), access control (`middleware`), shared behaviour
(`services`) and domain rules (`lib`) apart. `server.js` only wires them together.

**Encapsulation and abstraction.** The shape a scout may receive is produced in one place
(`lib/scouts.js: toScoutAthlete`), field by field, so a new database column can never leak by accident. Email and photo
providers are created by factories (`createNotifier`, `createPhotoSigner`) and swapped for fakes in tests.

**Reuse.** Shared UI such as `FormSheet`, `ScoutPlayerRow` and `DocumentAttachments`; shared server helpers such as
`lib/query.js` and `services/scoutData.js`.

**Algorithms and problem solving**

| Problem | Solution | Where |
|---|---|---|
| Records created offline must not be duplicated or lost when the connection drops mid-sync | Each record carries a device-generated `clientId`; the server confirms duplicates, commits each item in its own transaction and reports skipped items instead of dropping them | `routes/sync.js`, `database.ts` |
| Matching an offline record to the right athlete | Server id first (survives renames), then normalised name plus date of birth | `routes/sync.js: resolveAthlete` |
| Showing children's data safely | Consent gate with a grace period, masked name, age instead of date of birth, height and weight and club contact only after the club accepts | `lib/scouts.js` |
| "Under N" and age bands | Date-of-birth cutoff calculation, including the 29 February case | `lib/scouts.js: dobCutoffForUnder` |
| Ratings from old and new evaluations | Pillar scores normalised to one scale; unrated pillars stay empty instead of being guessed | `src/lib/ratings.ts` |
| Filters that run on the phone but results come in pages | Keep loading pages until enough athletes match | `src/app/scout/index.tsx` and `src/lib/discoverFilters.ts` |
| Pages must never repeat or skip athletes | Fixed sort order that always ends with the id | `routes/players.js` |
| Scraping protection | Search limit counted from a database access log, so it survives restarts | `middleware/auth.js`, `services/scoutData.js` |
| Repeated pestering | 30-day cooldown after a decline plus a daily request limit | `routes/contactRequests.js`, `lib/scouts.js` |

**Security and privacy.** Sign-in tokens are verified locally against the project's published keys with the issuer
pinned; administrator status can only come from `app_metadata`, which users cannot edit; athletes are hidden from scouts until a guardian's consent
is recorded; photos are private and served as one-hour signed links; scouts need administrator approval; every
scout search is logged and the log is pruned after 90 days; secrets are read from environment variables only.

## 7. Deployment

* **Database, auth, storage:** Supabase.
* **API:** a Render web service from the `scoutconnect-backend` folder (build command `npm install`, start command
  `node server.js`), with the environment variables above. `/api/health` needs no database and is suitable for uptime pings.
* **Android build:** `npx eas-cli@latest build -p android --profile preview` from `scoutconnect-frontend` (needs an
  `eas.json` whose preview profile sets `"android": { "buildType": "apk" }`).

## 8. Scope notes and known limitations

* Email notifications switch on only when the key is configured; everything else works without
  it.
* The signature stored with each synced evaluation is created on the server but there is not yet an endpoint that
  verifies it.
* The app targets phones (Android and iOS through Expo); the web build is not a supported target.
* Design mock-ups and the database diagram are in `Assets/`.

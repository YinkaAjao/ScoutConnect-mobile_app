# ScoutConnect mobile app

The React Native (Expo SDK 57) client for ScoutConnect. See the [project README](../README.md) for the overview,
architecture, environment variables and how the app talks to the backend.

```bash
npm install
cp .env.example .env     # EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start -c        # scan the QR code with Expo Go
npm test                 # unit tests for the pure modules in src/lib
npx tsc --noEmit         # type check
```

| Folder | Contents |
|---|---|
| `src/app/` | Screens, using Expo Router file-based navigation: `index` (sign-in), `coach/`, `scout/`, `admin/` |
| `src/components/` | Reusable UI such as `FormSheet`, `ScoutPlayerRow`, `VerificationCard` |
| `src/lib/` | API client and pure logic (ratings, filters, PDF report, age, consent); tests sit beside the code |
| `src/constants/` | Design system and position lists |
| `database.ts` | SQLite schema and the offline queue |

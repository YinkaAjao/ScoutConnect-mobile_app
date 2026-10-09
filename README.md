# ScoutConnect: Football Talent Identification & Roster Management
## Video link: https://youtu.be/Blgx8hFiS6s 

## 1. Project Description
ScoutConnect is an offline-first mobile application designed to bridge the gap between grassroots football development and professional talent identification. Built specifically for environments with unreliable internet access (such as open-field pitches), it provides two distinct, role-based experiences:
*   **Coaches** can log player evaluations, match statistics, and achievements locally on the sidelines without an internet connection. The application intelligently caches this data and synchronizes it to the cloud once a network connection is restored.
*   **Scouts** utilize a centralized, paginated database to filter talent by position, analyze historical development curves, and curate localized shortlists for recruitment.

## 2. System Architecture & Tool Selection
*   **Frontend UI & Navigation:** React Native integrated with Expo Router for role-based Bottom Tabs and Stack Navigation.
*   **Local Data Caching:** SQLite (Enabling true offline-first capability and local state persistence).
*   **Backend REST API:** Node.js powered by Express.js.
*   **Cloud Database:** PostgreSQL hosted on Supabase.
*   **ORM & Data Modeling:** Sequelize for schema definition and query building.
*   **Authentication & Security:** JSON Web Tokens (JWT) combined with `expo-secure-store` for encrypted session management.
*   **Cloud Deployment:** Render (Backend API web service).

## 3. Environment Setup & Evaluation Instructions
This repository contains both the frontend and backend source code. **The backend API and PostgreSQL database are fully deployed and live**, meaning you do not need to configure local databases or `.env` files to test the application.

### Running the Mobile Application
To evaluate the frontend interface and its connection to the live backend:

1. Navigate to the frontend directory: `cd frontend`
2. Install the required dependencies: `npm install`
3. Start the Expo development server: `npx expo start -c`
4. **To view the app:**
   * **Physical Device (Recommended):** Install the [Expo Go](https://expo.dev/go) app on an iOS or Android device and scan the QR code generated in the terminal.
   * **Emulator:** Press `a` in the terminal to launch the Android Emulator.

*Note: The frontend is pre-configured to communicate with the deployed Render API (`https://scoutconnect.onrender.com/`). Simply register a new Coach or Scout account within the app to begin testing.*

### Reviewing the Backend Code
The backend logic (including the intelligent offline-sync conflict resolution and media upload routing) is located in the `/backend` directory. Because the application is already deployed via Render, there is no need to run this directory locally. Evaluators can review `server.js` and the `/models` directory to assess the server-side logic and database schemas.

## 4. Designs & Navigation Layout
*(Please refer to the `/assets` directory in this repository for Figma mockups and database schema diagram).*

The application utilizes a strict role-based routing architecture:
*   **Auth Flow:** Validates credentials via the live backend and routes users to specific interface environments based on their JWT role payload.
*   **Coach Layout:** Tab-based navigation prioritizing rapid data entry (`Evaluation`, `Stats`, `Medals`) with drill-down capabilities into specific athlete histories (`/coach/player/[id]`).
*   **Scout Layout:** Discovery feed with dynamic search filtering and a dedicated Shortlist management view.

## 5. Deployment Infrastructure
*   **Database:** Deployed to **Supabase** utilizing their IPv4 session pooler for secure, scalable relational data storage.
*   **Backend API:** Deployed as a web service on **Render**. 
*   **Mobile App:** The frontend is configured for packaging via **Expo Application Services (EAS)** for eventual `.apk` (Android) and TestFlight (iOS) distribution.

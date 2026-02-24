# Elite Coach — AI-Powered Fat Loss & Performance Tracker

A Progressive Web App (PWA) for tracking weight, nutrition, training, and getting AI coaching analysis powered by Claude.

## Features

- **Daily Check-ins** — Log MFP nutrition totals, weight, steps, sleep, stress, energy
- **Adherence Scoring** — Automated 0-100% scoring based on calorie/protein/workout/step compliance
- **Weight Tracking** — 7-day rolling averages, trend charts, weekly comparisons, goal reference line
- **TDEE Recalibration** — Data-driven metabolic rate estimation from 14+ days of weight data
- **Training Programs** — Auto-generated Full Body / Upper-Lower / PPL with progression tracking
- **AI Coaching** — Daily analysis and weekly performance reviews powered by Claude
- **Plateau Detection** — Automated plateau protocol with adjustment recommendations
- **Diet Break Logic** — Triggers recommendations after 8+ weeks in deficit

## Deploy to Vercel (15 minutes)

### Prerequisites
- A [GitHub](https://github.com) account (free)
- A [Vercel](https://vercel.com) account (free — sign up with GitHub)
- Optionally: An [Anthropic API key](https://console.anthropic.com) for AI coaching features

### Step 1: Push to GitHub

**Option A — Using GitHub.com (no terminal needed):**
1. Go to [github.com/new](https://github.com/new)
2. Name the repo `elite-coach` (keep it private if you prefer)
3. Click **Create repository**
4. Click **"uploading an existing file"** link
5. Drag and drop ALL the project files/folders
6. Click **Commit changes**

**Option B — Using terminal:**
```bash
cd elite-coach-pwa
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/elite-coach.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import** next to your `elite-coach` repo
3. Framework Preset should auto-detect as **Vite**
4. Click **Deploy**
5. Wait ~60 seconds for build to complete
6. You'll get a URL like `elite-coach-xyz.vercel.app`

### Step 3: Install on Your Phone

**iPhone:**
1. Open your Vercel URL in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add**

**Android:**
1. Open your Vercel URL in Chrome
2. Tap the **three dots** menu
3. Tap **Add to Home Screen** or **Install app**
4. Tap **Install**

The app now launches full-screen like a native app.

### Step 4: Enable AI Coaching (Optional)

1. Open the app
2. Go to **SETUP** tab
3. Under **AI Coaching**, paste your Anthropic API key
4. Click **SAVE**

Your API key is stored only in your browser's local storage — it never leaves your device except to call the Anthropic API directly.

## Updating the App

Any changes you push to GitHub will auto-deploy to Vercel within ~30 seconds. Your phone will pick up the update next time you open the app.

## Data Storage

All data is stored in your browser's localStorage. This means:
- Data persists between sessions
- Data stays on your device
- Clearing browser data will erase your coaching data
- Data does not sync between devices

For multi-device sync, you'd need to add a database backend (Supabase recommended for a future upgrade).

## Tech Stack

- **React 18** + **Vite** (build tooling)
- **Recharts** (charts)
- **vite-plugin-pwa** (PWA/offline support)
- **Anthropic Claude API** (AI coaching)
- **localStorage** (data persistence)

## Project Structure

```
elite-coach-pwa/
├── index.html          # Entry point with mobile meta tags
├── package.json        # Dependencies
├── vite.config.js      # Vite + PWA plugin config
├── public/
│   ├── favicon.svg     # Browser favicon
│   ├── icon-192.png    # PWA icon (192x192)
│   └── icon-512.png    # PWA icon (512x512)
└── src/
    ├── main.jsx        # React entry
    └── App.jsx         # Full application
```

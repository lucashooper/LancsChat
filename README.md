# LancsChat

Real-time chat platform for Lancaster University students.

## Features

- **Supabase Auth** — Lancaster email verification via Supabase
- **Public chat rooms** — General, Confessions, Academic, and more
- **Direct messages** — Click any username to start a private conversation
- **Message pinning** — Admins can pin messages (Discord-style)
- **Reactions & replies** — React with emojis, reply to messages
- **Admin panel** — Ban users, delete messages, manage reports
- **Real-time** — Powered by Socket.IO
- **Modern dark UI** — Sleek, Instagram-inspired design

## Tech Stack

- **Frontend**: React + TypeScript + Vite + Lucide Icons
- **Backend**: Node.js + Express + Socket.IO
- **Database**: SQLite (via better-sqlite3)
- **Auth**: Supabase (email/password with JWT)

---

## Local Development

### Prerequisites
- Node.js 18+
- A Supabase project (free tier works)

### 1. Install dependencies
```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

**`server/.env`**:
```env
PORT=3001
CLIENT_URL=http://localhost:5174
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
```

**`client/.env`** (create this file):
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=http://localhost:3001
```

### 3. Run
```bash
# Terminal 1 — Backend
cd server && node index.js

# Terminal 2 — Frontend
cd client && npm run dev
```

Open http://localhost:5174

---

## Deployment Guide

LancsChat has two parts that need to be deployed separately:
1. **Frontend (static site)** → Netlify
2. **Backend (Node.js server)** → Railway, Render, or Fly.io

### Step 1: Deploy the Backend (e.g., Render.com)

1. Create a new **Web Service** on [render.com](https://render.com)
2. Connect your GitHub repo
3. Settings:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
4. Add **Environment Variables**:
   - `PORT` = `3001` (or leave blank, Render assigns one)
   - `CLIENT_URL` = `https://your-app.netlify.app` (your Netlify URL)
   - `SUPABASE_JWT_SECRET` = your Supabase JWT secret (found in Supabase → Settings → API → JWT Secret)
5. Deploy and note the URL (e.g., `https://lancschat-server.onrender.com`)

### Step 2: Deploy the Frontend (Netlify)

1. Go to [netlify.com](https://netlify.com) → New Site → Import from Git
2. Connect your GitHub repo
3. **Build Settings**:
   - **Base directory**: `client`
   - **Build command**: `npm run build`
   - **Publish directory**: `client/dist`
4. Add **Environment Variables** (Site Settings → Environment Variables):
   - `VITE_SUPABASE_URL` = `https://your-project.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
   - `VITE_API_URL` = `https://lancschat-server.onrender.com/api` (your deployed server URL + `/api`)
   - `VITE_WS_URL` = `https://lancschat-server.onrender.com` (your deployed server URL, no `/api`)
5. Deploy

### Step 3: Update `api.ts` for production

The `client/src/api.ts` file currently has hardcoded localhost URLs. Update it to use environment variables:

```typescript
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
```

### Step 4: Update Supabase Settings

In your Supabase dashboard:
1. **Authentication → URL Configuration**:
   - Site URL: `https://your-app.netlify.app`
   - Redirect URLs: Add `https://your-app.netlify.app/reset-password`
2. **Authentication → Email Templates**: Use your custom templates from `email-templates/`

### Step 5: Update CORS on the server

Make sure `server/.env` has `CLIENT_URL` set to your Netlify URL so CORS allows requests from your frontend.

---

## Project Structure

```
LancsChat/
├── server/
│   ├── index.js          # Express + Socket.IO server
│   ├── db.js             # SQLite schema and seed data
│   └── .env              # Server config
├── client/
│   ├── src/
│   │   ├── App.tsx               # Root component & routing
│   │   ├── api.ts                # API helper (REST calls)
│   │   ├── lib/supabase.ts       # Supabase client
│   │   ├── context/
│   │   │   ├── AuthContext.tsx    # Auth state & user management
│   │   │   └── SocketContext.tsx  # WebSocket connection
│   │   └── pages/
│   │       ├── AuthPage.tsx      # Login / Register / Reset Password
│   │       ├── ChatPage.tsx      # Main chat (rooms, DMs, messages)
│   │       ├── ChatPage.css      # Chat styles
│   │       └── SettingsPage.tsx  # User profile settings
│   └── index.html
├── email-templates/
│   ├── confirm-signup.html       # Email verification template
│   └── reset-password.html       # Password reset template
├── supabase/                     # SQL migrations for Supabase
└── README.md
```

---

## Admin

The admin email is configured in `server/index.js` as `ADMIN_EMAIL`. The first user to register with this email gets admin privileges. Admins can:
- Pin/unpin messages
- Delete any message
- Ban/unban users
- View reports
- Access the admin panel via the Shield icon in the sidebar

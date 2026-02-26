# LancsChat

Anonymous chat platform exclusively for Lancaster University students.

## Features

- **University-verified** — Only `@lancaster.ac.uk` emails can register
- **Anonymous profiles** — Random animal names and colors, no real identity exposed
- **Public chat rooms** — General, Confessions, Dating, Academic, and more
- **Anonymous DMs** — Click any username in a room to start a private conversation
- **Real-time messaging** — Powered by Socket.IO
- **Modern dark UI** — Sleek, Instagram-inspired design

## Tech Stack

- **Frontend**: React + TypeScript + Vite + TailwindCSS + Lucide Icons
- **Backend**: Node.js + Express + Socket.IO
- **Database**: SQLite (via better-sqlite3)
- **Auth**: JWT + email verification (6-digit codes)

## Getting Started

### Prerequisites
- Node.js 18+

### Install dependencies
```bash
cd server && npm install
cd ../client && npm install
```

### Configure email (optional for dev)
Edit `server/.env` with your SMTP credentials for real email sending.
In development, verification codes are printed to the server console.

### Run
```bash
# Terminal 1 — Backend
cd server && node index.js

# Terminal 2 — Frontend
cd client && npm run dev
```

Open http://localhost:5173

### Dev Note
In development mode, the email verification code is printed directly to the server console — no real email is sent. Look for the `📧 VERIFICATION CODE` log.

## Project Structure

```
LancsChat/
├── server/
│   ├── index.js        # Express + Socket.IO server
│   ├── auth.js         # Registration, login, email verification
│   ├── db.js           # SQLite schema and seed data
│   └── .env            # Server config
├── client/
│   ├── src/
│   │   ├── App.tsx             # Root component
│   │   ├── api.ts              # API helper
│   │   ├── context/
│   │   │   ├── AuthContext.tsx  # Auth state
│   │   │   └── SocketContext.tsx# WebSocket state
│   │   └── pages/
│   │       ├── AuthPage.tsx    # Login/Register/Verify
│   │       └── ChatPage.tsx    # Main chat interface
│   └── index.html
└── README.md
```

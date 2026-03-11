# 🔗 URL Shortener

A simple URL shortener with a clean UI, custom aliases, and click tracking.

## 📁 Project Structure

```
url-shortener/
├── index.js          ← Express server (backend)
├── package.json      ← Dependencies
└── public/
    ├── index.html    ← Frontend UI
    └── 404.html      ← Not found page
```

## 🚀 How to Run

### 1. Install Node.js
Download from https://nodejs.org (v16+ recommended)

### 2. Install dependencies
```bash
cd url-shortener
npm install
```

### 3. Start the server
```bash
npm start
```

### 4. Open in browser
Go to: http://localhost:3000

---

## ✨ Features
- Shorten any URL instantly
- Custom aliases (e.g. `localhost:3000/my-link`)
- Click tracking per link
- View all created links
- Clean dark UI

## 🔄 Dev Mode (auto-restart on save)
```bash
npm run dev
```

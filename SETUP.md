# SpendIQ v3.0 — Setup Guide

## 1. Install new Python dependencies
```
pip install flask-limiter firebase-admin bleach
```
Or install everything fresh:
```
pip install -r requirements.txt
```

---

## 2. Firebase Setup (15 minutes)

### Step 1 — Create Firebase project
1. Go to https://console.firebase.google.com
2. Click "Add project" → name it "SpendIQ"
3. Disable Google Analytics (not needed) → Create project

### Step 2 — Enable Google Sign-In
1. In Firebase Console → Authentication → Sign-in method
2. Enable "Google" → add your support email → Save

### Step 3 — Get your web app config (for app.js)
1. Project Settings (gear icon) → Your apps → Add app → Web (</>)
2. Register app name "SpendIQ Web"
3. Copy the firebaseConfig object
4. Open app.js → find `const firebaseConfig = {` → paste your values

### Step 4 — Get service account key (for app.py)
1. Project Settings → Service accounts
2. Click "Generate new private key" → Download JSON
3. Rename it to `firebase-credentials.json`
4. Put it in your project root: C:\Users\DELL\Downloads\project1\

### Step 5 — Add to .env
```
GROQ_API_KEY=your_groq_key_here
FIREBASE_CREDENTIALS_PATH=firebase-credentials.json
```

---

## 3. Run the app
```
cd C:\Users\DELL\Downloads\project1
python app.py
```

Open http://localhost:5000

---

## What was added in v3.0

### Rate Limiting (flask-limiter)
- /upload     → 20 requests/hour per IP
- /chat       → 30 requests/hour per IP  (protects Groq API costs)
- /forecast   → 30 requests/hour per IP
- /predict    → 100 requests/hour per IP
- /health     → 60 requests/minute per IP
- Returns HTTP 429 with a friendly error message when exceeded

### Firebase Auth (optional — guest mode works without it)
- Google Sign-In button in header
- "Continue as Guest" button — no login required
- Logged-in users get their Firebase UID tagged on uploads
- Token auto-refreshes every 55 minutes
- All API calls send Authorization: Bearer <token> when logged in
- Backend verifies token and sets g.user_id / g.is_guest

### Input Validation & Sanitization
Backend (app.py):
- File type whitelist: .pdf, .csv, .txt only
- File size limit: 10MB max
- Empty file check
- All text inputs cleaned with bleach (strips HTML/scripts)
- Transaction descriptions sanitized (removes special chars)
- Budget values validated (numeric, 0–1 crore range)
- Transaction list capped at 2000 entries
- Chat input capped at 500 characters
- AI responses sanitized before returning
- Directory traversal prevention on static file serving
- debug=False in production

Frontend (app.js):
- File type + size validation before upload
- Chat input sanitized (strips HTML tags)
- Budget inputs validated (numeric range)
- All rendered content escaped via escapeHtml()
- Rate limit errors shown as friendly messages

---

## Guest vs Signed-In users

| Feature         | Guest | Signed In |
|-----------------|-------|-----------|
| Upload PDF      | ✅    | ✅        |
| AI Chat         | ✅    | ✅        |
| Budget Planner  | ✅    | ✅        |
| Data persists   | ❌    | ❌ (add DB later) |
| User identified | ❌    | ✅ (UID tagged) |

Data persistence (saving uploads between sessions) requires adding a
database (Supabase/PostgreSQL). That's the next step after this.

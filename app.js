/**
 * SpendIQ v3.1 — Frontend JavaScript
 * Firebase config loaded from backend /config (keys stay in .env)
 */

const BACKEND = "http://localhost:5000";
let allTransactions = [];
let currentUser     = null;
let authToken       = null;
let analytics       = null;
let firebaseReady   = false;

// ── DOM References ──
const fileInput    = document.getElementById("file");
const parseBtn     = document.getElementById("parse");
const exampleBtn   = document.getElementById("example");
const statusEl     = document.getElementById("status");
const creditsEl    = document.getElementById("credits");
const debitsEl     = document.getElementById("debits");
const netEl        = document.getElementById("net");
const txcountEl    = document.getElementById("txcount");
const txTableBody  = document.querySelector("#txTable tbody");
const catlistEl    = document.getElementById("catlist");
const insightEl    = document.getElementById("insight");
const pie          = document.getElementById("pie");
const legendEl     = document.getElementById("legend");
const backendBadge = document.getElementById("backend-status");

// ─────────────────────────────────────────────────────────────
// STEP 1: Load Firebase config from backend (.env → Flask → JS)
// No API keys hardcoded here anymore
// ─────────────────────────────────────────────────────────────
async function initFirebase() {
  try {
    const res = await fetch(`${BACKEND}/config`);
    if (!res.ok) throw new Error("Config fetch failed");

    const firebaseConfig = await res.json();

    // Make sure we actually got a config back
    if (!firebaseConfig.apiKey) throw new Error("Empty config from server");

    firebase.initializeApp(firebaseConfig);
    try {
      analytics = firebase.analytics();
    } catch (e) {
      console.warn("Analytics not available");
    }
    firebaseReady = true;
    console.log("✅ Firebase initialized from server config");

    // Start listening for auth changes only after Firebase is ready
    setupAuthListener();

  } catch (e) {
    console.warn("⚠️ Firebase init failed — guest mode only:", e.message);
    // App still works in guest mode without Firebase
  }
}

// Run on page load
initFirebase();
checkBackend();


// ─────────────────────────────────────────────────────────────
// ANALYTICS HELPER
// ─────────────────────────────────────────────────────────────
function trackEvent(name, params = {}) {
  try { if (analytics) analytics.logEvent(name, params); } catch (_) {}
}


// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────
async function signInWithGoogle() {
  if (!firebaseReady) {
    alert("Firebase is still loading. Please try again in a moment.");
    return;
  }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
    trackEvent("login", { method: "google" });
  } catch (e) {
    console.error("Sign-in error:", e);
    alert("Sign-in failed: " + e.message);
  }
}

function continueAsGuest() {
  document.getElementById("auth-logged-out").style.display = "none";
  currentUser = null;
  authToken   = null;
  statusEl.textContent = "Running as guest — data is not saved between sessions";
  trackEvent("guest_mode_selected");
}

async function signOut() {
  if (firebaseReady) await firebase.auth().signOut();
  currentUser     = null;
  authToken       = null;
  allTransactions = [];
  document.getElementById("auth-logged-out").style.display = "flex";
  document.getElementById("auth-logged-in").style.display  = "none";
  txTableBody.innerHTML = "";
  statusEl.textContent  = "Signed out.";
  trackEvent("logout");
}

function setupAuthListener() {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      authToken   = await user.getIdToken();

      // Auto-refresh token every 55 minutes
      setInterval(async () => {
        authToken = await user.getIdToken(true);
      }, 55 * 60 * 1000);

      document.getElementById("auth-logged-out").style.display = "none";
      document.getElementById("auth-logged-in").style.display  = "flex";
      document.getElementById("user-name").textContent = user.displayName || user.email;

      const avatar = document.getElementById("user-avatar");
      if (user.photoURL) {
        avatar.src           = user.photoURL;
        avatar.style.display = "block";
      }
    } else {
      currentUser = null;
      authToken   = null;
    }
  });
}

function getAuthHeaders(extra = {}) {
  return authToken
    ? { ...extra, "Authorization": `Bearer ${authToken}` }
    : { ...extra };
}


// ─────────────────────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────────────────────
const ALLOWED_EXT    = [".pdf", ".csv", ".txt"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CHAT_LEN   = 500;

function validateFile(file) {
  if (!file) return { ok: false, error: "No file selected" };
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
  if (!ALLOWED_EXT.includes(ext)) return { ok: false, error: `Only ${ALLOWED_EXT.join(", ")} allowed` };
  if (file.size > MAX_FILE_BYTES)  return { ok: false, error: "File too large. Max 10MB." };
  if (file.size === 0)             return { ok: false, error: "File is empty." };
  return { ok: true };
}

function sanitizeInput(text) {
  return text.replace(/<[^>]*>/g, "").replace(/[<>'"]/g, "").trim().substring(0, MAX_CHAT_LEN);
}

function validateBudget(val) {
  const n = parseFloat(val);
  return (!isNaN(n) && n > 0 && n < 10_000_000) ? n : null;
}


// ─────────────────────────────────────────────────────────────
// BACKEND HEALTH
// ─────────────────────────────────────────────────────────────
async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      backendBadge.textContent = "● Backend connected";
      backendBadge.className   = "status-badge online";
      return true;
    }
  } catch (_) {}
  backendBadge.textContent = "● Offline mode";
  backendBadge.className   = "status-badge offline";
  return false;
}


// ─────────────────────────────────────────────────────────────
// PROCESS FILE
// ─────────────────────────────────────────────────────────────
async function processFile(file) {
  const v = validateFile(file);
  if (!v.ok) { statusEl.textContent = "❌ " + v.error; return; }

  statusEl.textContent = "Processing...";
  trackEvent("file_upload_started", { type: file.name.split(".").pop() });

  try {
    const online = await checkBackend();
    let transactions = [];

    if (online && file instanceof File) {
      statusEl.textContent = "Sending to backend...";
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(`${BACKEND}/upload`, {
        method:  "POST",
        body:    fd,
        headers: getAuthHeaders()
      });

      if (res.status === 429) {
        statusEl.textContent = "⏱️ Too many uploads. Please wait a moment.";
        trackEvent("rate_limit_hit", { endpoint: "upload" });
        return;
      }
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Backend parse failed");
      }

      const data = await res.json();
      transactions = data.transactions || [];
      const label = data.user?.is_guest ? "Guest" : "Signed in";
      statusEl.textContent = `✅ Parsed ${transactions.length} transactions (${label})`;
      trackEvent("file_parsed", { count: transactions.length });

    } else {
      statusEl.textContent = "Parsing locally (backend offline)...";
      const text = file.name.toLowerCase().endsWith(".pdf")
        ? await extractTextFromPDF(file)
        : await file.text();
      transactions = splitIntoBlocks(text).map(parseBlock).filter(t => t && t.amount > 0 && t.amount < 1e9);
      statusEl.textContent = `⚠️ Offline: Parsed ${transactions.length} transactions`;
      trackEvent("file_parsed_offline", { count: transactions.length });
    }

    allTransactions = transactions;
    renderTransactions(transactions);
    const summary = summarize(transactions);
    renderSummary(summary);
    renderCategories(summary.catMap);
    insightEl.textContent = makeInsight(summary);
    txcountEl.textContent = transactions.length;
    if (transactions.length > 0) showBudgetPlanner(summary.catMap);

  } catch (e) {
    console.error(e);
    statusEl.textContent = "❌ " + e.message;
    trackEvent("file_parse_error", { error: e.message });
  }
}


// ─────────────────────────────────────────────────────────────
// BUDGET PLANNER
// ─────────────────────────────────────────────────────────────
function showBudgetPlanner(catMap) {
  document.getElementById("budget-card").style.display = "block";
  document.getElementById("budget-inputs").innerHTML =
    Object.keys(catMap).filter(c => c !== "Salary").map(cat => `
      <div class="budget-row">
        <label>${escapeHtml(cat)}</label>
        <input type="number" id="budget-${escapeHtml(cat)}"
               placeholder="₹ limit" min="0" max="10000000" step="100"/>
      </div>`).join("");
}

document.getElementById("run-forecast")?.addEventListener("click", async () => {
  const budgets = {};
  document.querySelectorAll("[id^='budget-']").forEach(inp => {
    const val = validateBudget(inp.value);
    if (val) budgets[inp.id.replace("budget-", "")] = val;
  });
  trackEvent("forecast_run");
  try {
    const res = await fetch(`${BACKEND}/forecast`, {
      method:  "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body:    JSON.stringify({ transactions: allTransactions, budgets })
    });
    if (res.status === 429) { alert("Too many requests. Please wait."); return; }
    const data = await res.json();
    renderForecast(data.forecasts, data.alerts);
  } catch (e) {
    alert("Forecast failed — check backend is running.");
  }
});

function renderForecast(forecasts, alerts) {
  document.getElementById("forecast-card").style.display = "block";
  document.getElementById("forecast-results").innerHTML =
    Object.entries(forecasts).map(([cat, f]) => `
      <div class="forecast-row">
        <span class="forecast-cat">${escapeHtml(cat)}</span>
        <span class="forecast-amt">₹${f.predicted.toLocaleString("en-IN")}</span>
      </div>`).join("");

  document.getElementById("alerts-card").style.display = "block";
  document.getElementById("alerts-list").innerHTML = alerts.length
    ? alerts.map(a => `<div class="alert-item">${escapeHtml(a.message)}</div>`).join("")
    : `<div class="muted">All categories within budget.</div>`;
}


// ─────────────────────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────────────────────
function toggleChat() {
  const p = document.getElementById("chat-panel");
  p.classList.toggle("open");
  if (p.classList.contains("open")) trackEvent("chat_opened");
}

function askQuestion(q) {
  document.getElementById("chat-input").value = q;
  sendChat();
}

async function sendChat() {
  const input    = document.getElementById("chat-input");
  const messages = document.getElementById("chat-messages");
  const question = sanitizeInput(input.value.trim());
  if (!question) return;

  messages.innerHTML += `<div class="chat-msg user">${escapeHtml(question)}</div>`;
  input.value = "";
  messages.innerHTML += `<div class="chat-msg bot typing" id="typing">Thinking...</div>`;
  messages.scrollTop = messages.scrollHeight;
  trackEvent("chat_message_sent");

  try {
    const res = await fetch(`${BACKEND}/chat`, {
      method:  "POST",
      headers: getAuthHeaders({ "Content-Type": "application/json" }),
      body:    JSON.stringify({ question, transactions: allTransactions })
    });

    document.getElementById("typing")?.remove();

    if (res.status === 429) {
      messages.innerHTML += `<div class="chat-msg bot error">⏱️ Too many questions — please wait a moment.</div>`;
    } else {
      const data = await res.json();
      messages.innerHTML += data.answer
        ? `<div class="chat-msg bot">${escapeHtml(data.answer)}</div>`
        : `<div class="chat-msg bot error">Error: ${escapeHtml(data.error || "No response")}</div>`;
    }
  } catch (e) {
    document.getElementById("typing")?.remove();
    messages.innerHTML += `<div class="chat-msg bot error">Error: ${escapeHtml(e.message)}</div>`;
  }
  messages.scrollTop = messages.scrollHeight;
}


// ─────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────
function filterTable() {
  const q = sanitizeInput(document.getElementById("search").value).toLowerCase();
  renderTransactions(allTransactions.filter(t =>
    t.desc.toLowerCase().includes(q) ||
    (t.category || "").toLowerCase().includes(q) ||
    (t.date || "").toLowerCase().includes(q)
  ));
}


// ─────────────────────────────────────────────────────────────
// OFFLINE FALLBACK PARSER
// ─────────────────────────────────────────────────────────────
const CATS = {
  Food:          ["zomato","swiggy","restaurant","hungry","cafe","dominos","blinkit"],
  Groceries:     ["bigbasket","dmart","grocery","supermarket","reliance"],
  Transport:     ["uber","ola","irctc","metro","bus","flight","indigo","rapido"],
  Bills:         ["electricity","water","bill","gtpl","hathway","broadband","airtel","jio"],
  Salary:        ["salary","credited","payroll","deposit","freelance"],
  Shopping:      ["amazon","flipkart","myntra","ajio","store","shopping","meesho"],
  Rent:          ["rent","landlord","pg","hostel"],
  Health:        ["clinic","hospital","pharmacy","doctor","apollo"],
  Entertainment: ["movie","cinema","spotify","bookmyshow","netflix","prime"],
};

function categorize(desc) {
  const s = (desc || "").toLowerCase();
  for (const [cat, kws] of Object.entries(CATS))
    if (kws.some(k => s.includes(k))) return cat;
  return "Other";
}

function splitIntoBlocks(text) {
  const cleaned = text.replace(/\r/g,"\n").replace(/\u00a0/g," ")
    .replace(/Page \d+ of \d+/gi,"")
    .replace(/This is (a system|an automatically) generated statement[^\n]*/gi,"")
    .replace(/\n{2,}/g,"\n");
  const re  = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/gi;
  const pos = [...cleaned.matchAll(re)].map(m => m.index);
  return pos.map((p, i) =>
    cleaned.slice(p, i + 1 < pos.length ? pos[i + 1] : cleaned.length).trim()
  );
}

function parseBlock(block) {
  const dateM  = block.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i);
  const amtM   = block.match(/₹\s*([\d,]+(?:\.\d+)?)/);
  const descM  = block.match(/(?:Paid to|Received from|Payment to|Transfer to|Transfer from)[^\n]+/i);
  const desc   = (descM ? descM[0].trim() : block.split("\n")[2]?.trim() || "N/A")
                   .replace(/<[^>]*>/g, "").substring(0, 200);
  return {
    date:     dateM ? dateM[0] : "Unknown",
    desc,
    type:     /CREDIT/i.test(block) ? "credit" : /DEBIT/i.test(block) ? "debit" : "unknown",
    amount:   amtM ? parseFloat(amtM[1].replace(/,/g, "")) : 0,
    category: categorize(desc)
  };
}

async function extractTextFromPDF(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    text += (await page.getTextContent()).items.map(it => it.str).join(" ") + "\n";
    page.cleanup();
    await new Promise(r => setTimeout(r, 10));
  }
  return text;
}


// ─────────────────────────────────────────────────────────────
// RENDERING
// ─────────────────────────────────────────────────────────────
function summarize(trans) {
  let credits = 0, debits = 0, catMap = {};
  for (const t of trans) {
    if ((t.type || "").includes("credit")) credits += t.amount;
    else debits += t.amount;
    if (t.type === "debit" || t.type === "unknown")
      catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  }
  return { credits, debits, catMap };
}

function renderTransactions(trans) {
  txTableBody.innerHTML = "";
  for (const t of trans) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(t.date || "—")}</td>
      <td class="desc-cell">${escapeHtml(t.desc || "")}</td>
      <td><span class="cat-badge">${escapeHtml(t.category || "Other")}</span></td>
      <td><span class="${t.type === "credit" ? "type-credit" : "type-debit"}">${escapeHtml(t.type)}</span></td>
      <td class="amount-cell">₹${fmt(t.amount)}</td>`;
    txTableBody.appendChild(tr);
  }
}

function renderSummary({ credits, debits }) {
  creditsEl.textContent = "₹" + fmt(credits);
  debitsEl.textContent  = "₹" + fmt(debits);
  const net = credits - debits;
  netEl.textContent = (net >= 0 ? "₹" : "-₹") + fmt(Math.abs(net));
  netEl.style.color = net >= 0 ? "var(--good)" : "var(--bad)";
}

function renderCategories(catMap) {
  const arr = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  catlistEl.innerHTML = arr.length
    ? arr.map(([c, a]) => `
        <div class="cat-row">
          <span>${escapeHtml(c)}</span>
          <span class="cat-amt">₹${fmt(a)}</span>
        </div>`).join("")
    : "—";
  drawPie(catMap);
}

function makeInsight({ debits, catMap }) {
  const top = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
  if (!top) return "No transactions detected.";
  const [cat, amt] = top;
  return `Largest spending: ${cat} (₹${fmt(amt)} — ${Math.round(amt / Math.max(debits, 1) * 100)}% of debits).`;
}

const COLORS = ["#60a5fa","#06d6a4","#ef476f","#ffd166","#8b5cf6","#fb7185","#34d399","#f97316"];

function drawPie(catMap) {
  pie.innerHTML = ""; legendEl.innerHTML = "";
  const data = Object.entries(catMap).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!data.length) {
    pie.innerHTML = `<text x="170" y="150" text-anchor="middle" fill="#94a3b8" font-size="14">No spending data</text>`;
    return;
  }
  const total = data.reduce((s, [, v]) => s + v, 0);
  let start = -Math.PI / 2;
  data.forEach(([cat, val], i) => {
    const angle = val / total * Math.PI * 2;
    const end   = start + angle;
    const x1 = 170 + 120 * Math.cos(start), y1 = 150 + 120 * Math.sin(start);
    const x2 = 170 + 120 * Math.cos(end),   y2 = 150 + 120 * Math.sin(end);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M 170 150 L ${x1} ${y1} A 120 120 0 ${angle > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`);
    path.setAttribute("fill", COLORS[i % COLORS.length]);
    path.setAttribute("stroke", "#071428");
    path.setAttribute("stroke-width", "1.5");
    pie.appendChild(path);
    start = end;
    legendEl.innerHTML += `
      <div class="legend-item">
        <span class="legend-dot" style="background:${COLORS[i % COLORS.length]}"></span>
        <span class="legend-label">${escapeHtml(cat)}</span>
        <span class="legend-pct">${Math.round(val / total * 100)}%</span>
      </div>`;
  });
}


// ─────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────
parseBtn.addEventListener("click", () => {
  const f = fileInput.files[0];
  if (!f) { alert("Please choose a file first"); return; }
  processFile(f);
});

exampleBtn.addEventListener("click", () => {
  trackEvent("example_data_loaded");
  const sample = `Mar 01, 2025\n09:15 am\nCREDIT ₹45,000 Salary credited from Infosys Limited\nMar 02, 2025\n08:30 am\nDEBIT ₹12,000 Rent payment to landlord Ramesh Babu\nMar 02, 2025\n07:45 pm\nDEBIT ₹349 Paid to Swiggy\nMar 03, 2025\n01:20 pm\nDEBIT ₹1,299 Paid to Amazon Shopping\nMar 04, 2025\n06:10 pm\nDEBIT ₹599 Paid to Netflix\nMar 05, 2025\n10:00 am\nDEBIT ₹2,500 Paid to Apollo Pharmacy\nMar 05, 2025\n08:45 pm\nDEBIT ₹450 Paid to Zomato\nMar 06, 2025\n09:30 am\nDEBIT ₹1,500 Paid to Airtel Broadband\nMar 07, 2025\n07:15 pm\nDEBIT ₹380 Paid to Swiggy\nMar 08, 2025\n11:00 am\nDEBIT ₹3,200 Paid to Myntra\nMar 08, 2025\n03:30 pm\nCREDIT ₹5,000 Received from Priya Sister\nMar 09, 2025\n08:00 am\nDEBIT ₹250 Paid to Rapido\nMar 10, 2025\n06:45 pm\nDEBIT ₹799 Paid to BookMyShow\nMar 11, 2025\n09:00 am\nDEBIT ₹1,800 Paid to GTPL Hathway Electricity\nMar 12, 2025\n01:00 pm\nDEBIT ₹520 Paid to Zomato\nMar 13, 2025\n11:30 am\nDEBIT ₹4,500 Paid to Flipkart\nMar 14, 2025\n07:30 pm\nDEBIT ₹299 Paid to Spotify\nMar 15, 2025\n09:15 am\nDEBIT ₹1,100 Paid to BigBasket\nMar 16, 2025\n02:00 pm\nDEBIT ₹650 Paid to Uber\nMar 17, 2025\n08:30 pm\nDEBIT ₹410 Paid to Swiggy\nMar 18, 2025\n10:00 am\nDEBIT ₹900 Paid to DMart Grocery\nMar 19, 2025\n06:00 pm\nDEBIT ₹1,200 Paid to Reliance Digital Store\nMar 20, 2025\n09:00 am\nCREDIT ₹2,000 Received from Kiran Friend\nMar 21, 2025\n08:00 pm\nDEBIT ₹349 Paid to Swiggy\nMar 22, 2025\n11:00 am\nDEBIT ₹750 Paid to MedPlus Pharmacy\nMar 23, 2025\n03:00 pm\nDEBIT ₹5,500 Paid to IRCTC Train Booking\nMar 24, 2025\n07:00 pm\nDEBIT ₹480 Paid to Zomato\nMar 25, 2025\n09:30 am\nDEBIT ₹1,999 Paid to Amazon Shopping\nMar 26, 2025\n06:15 pm\nDEBIT ₹300 Paid to Ola Cab\nMar 27, 2025\n08:00 am\nDEBIT ₹2,200 Paid to Jio Postpaid Bill\nMar 28, 2025\n01:30 pm\nDEBIT ₹850 Paid to Cafe Coffee Day\nMar 29, 2025\n10:00 am\nDEBIT ₹3,800 Paid to Ajio Shopping\nMar 30, 2025\n07:45 pm\nDEBIT ₹420 Paid to Swiggy\nMar 31, 2025\n11:59 pm\nDEBIT ₹799 Paid to Amazon Prime`;
  processFile(new File([sample], "sample.txt", { type: "text/plain" }));
});


// ─────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js";
}
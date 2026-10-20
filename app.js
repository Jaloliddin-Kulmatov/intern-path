/* Intern_Path — front-end prototype by team ICOM (WIA2006, OCC 1M).
   No backend: state lives in localStorage, the CV is read in the browser and never uploaded. */
(() => {
  "use strict";

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const unique = a => [...new Set(a)];
  const rm = n => `RM ${n.toLocaleString("en-MY")}`;
  const ago = d => d === 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;
  const initials = n => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();

  /* ---------- state ----------
     Signed-in users (Google) are stored in Supabase. Only the theme and the offline *demo* session
     use localStorage (with an in-memory fallback if storage is blocked). */
  const KEY = "internpath.v2";
  const loadStored = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const stored = loadStored();
  const state = { user: null, profile: null, saved: [], clicks: [], synced: false, syncedAt: null, theme: stored.theme ?? null, authError: "" };
  if (stored.demo?.user?.demo) Object.assign(state, stored.demo);
  const persist = () => {
    const demo = state.user?.demo ? { user: state.user, profile: state.profile, saved: state.saved, clicks: state.clicks, synced: state.synced, syncedAt: state.syncedAt } : null;
    try { localStorage.setItem(KEY, JSON.stringify({ theme: state.theme, demo })); } catch { /* storage blocked: stay in memory */ }
  };

  /* ---------- Supabase ---------- */
  const CFG = window.INTERNPATH || {};
  const sb = window.supabase && CFG.supabaseUrl && CFG.supabaseKey
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } })
    : null;
  const live = () => !!(sb && state.user && !state.user.demo);
  const canGoogle = () => !!sb && /^https?:$/.test(location.protocol);
  const todayMY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

  /* Listings: loaded from the database; the bundled sample list is the offline/demo fallback. */
  const localCatalog = JOBS.map(j => ({ ...j, deadlineDays: 10 + (j.id * 7) % 50 }));
  let catalog = localCatalog, catalogLive = false, lastChecked = null;
  const fromRow = r => ({ id: r.id, title: r.title, company: r.company, city: r.city, region: r.region, mode: r.mode, allow: r.allowance, months: r.months,
    cat: r.category, skills: r.skills, nice: r.nice, langs: r.langs, intl: r.intl, src: r.source, days: Math.max(0, dayDiff(todayMY(), r.posted_at)),
    desc: r.description, url: r.url, pending: false, deadline: r.deadline, deadlineDays: r.deadline ? dayDiff(r.deadline, todayMY()) : null, checkedAt: r.checked_at });
  async function loadCatalog() {
    if (!sb) return false;
    const { data, error } = await sb.from("internships").select("*").order("id");
    if (error || !data) return false;
    catalog = data.map(fromRow); catalogLive = true;
    lastChecked = data.reduce((m, r) => (r.checked_at > m ? r.checked_at : m), "") || null;
    return true;
  }

  const profileRow = p => ({ name: p.name, type: p.type, nationality: p.nationality, year: p.year, track: p.track, cv_name: p.cvName, linkedin: p.linkedin,
    skills: p.skills, fields: p.fields, regions: p.regions, mode: p.mode, langs: p.langs });
  const profileFromRow = r => ({ name: r.name, type: r.type, nationality: r.nationality, year: r.year, track: r.track, cvName: r.cv_name, linkedin: r.linkedin,
    skills: r.skills, fields: r.fields, regions: r.regions, mode: r.mode, langs: r.langs });

  async function applySession(session) {
    if (!session) return false;
    const { data: row } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (!row) {
      await sb.auth.signOut();
      state.authError = "Sign-in failed. Please try again with a Google account.";
      return false;
    }
    state.user = { id: row.id, email: row.email, role: row.role, name: row.name || nameFromEmail(row.email), demo: false };
    state.profile = null; state.saved = []; state.clicks = [];
    if (row.role === "student") {
      state.profile = profileFromRow(row);
      const [s, c] = await Promise.all([sb.from("saved_internships").select("internship_id"), sb.from("apply_clicks").select("internship_id")]);
      state.saved = (s.data || []).map(x => x.internship_id);
      state.clicks = (c.data || []).map(x => ({ id: x.internship_id }));
    }
    return true;
  }
  async function signInWithGoogle() {
    try { sessionStorage.setItem("ip_login", "1"); } catch { /* ignore */ }
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
    if (error) toast(error.message);
  }
  async function signOut() {
    if (live()) await sb.auth.signOut();
    Object.assign(state, { user: null, profile: null, saved: [], clicks: [], synced: false, syncedAt: null });
    persist(); toast("Signed out"); go("/");
  }

  const blankProfile = () => ({ name: "", type: "malaysian", nationality: "", year: "", track: "", cvName: "", linkedin: "",
    skills: [], fields: [], regions: [], mode: "Any", langs: ["English"] });

  const DEMO = {
    malaysian: { email: "aisyah.rahman@siswa.um.edu.my", role: "student", profile: {
      name: "Aisyah Rahman", type: "malaysian", nationality: "", year: "3", track: "Software Engineering",
      cvName: "Aisyah_Rahman_CV.pdf", linkedin: "https://www.linkedin.com/in/aisyah-rahman-demo",
      skills: ["Python", "JavaScript", "React", "HTML/CSS", "SQL", "Git", "Communication", "Node.js"],
      fields: ["Software Development", "Data & AI"], regions: ["Kuala Lumpur", "Selangor"], mode: "Any",
      langs: ["English", "Bahasa Malaysia", "Mandarin"] } },
    international: { email: "timur.karimov@siswa.um.edu.my", role: "student", profile: {
      name: "Timur Karimov", type: "international", nationality: "Uzbekistan", year: "2", track: "Data Science",
      cvName: "Timur_Karimov_CV.pdf", linkedin: "https://www.linkedin.com/in/timur-karimov-demo",
      skills: ["Python", "SQL", "Pandas", "Machine Learning", "Data Analysis", "Excel", "Power BI", "Git"],
      fields: ["Data & AI", "Business & IT Analysis"], regions: ["Kuala Lumpur", "Remote"], mode: "Any",
      langs: ["English", "Russian"] } },
    staff: { email: "faculty.office@um.edu.my", role: "staff", profile: null },
  };

  /* ---------- skill extraction from CV text ---------- */
  const skillRegex = SKILL_GROUPS.flatMap(g => g.skills).map(([name, aliases]) => {
    const alt = aliases.map(a => a.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")).join("|");
    return [name, new RegExp(`(?<![a-z0-9+#.])(?:${alt})(?![a-z0-9+#])`, "i")];
  });
  const extractSkills = text => skillRegex.filter(([, re]) => re.test(text)).map(([n]) => n);
  const LINKEDIN_RE = /^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/in\/[^\s/?#]+\/?/i;

  let pdfLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve();
    pdfLoading ??= new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(); };
      s.onerror = () => { pdfLoading = null; rej(new Error("pdf.js unavailable")); };
      document.head.appendChild(s);
    });
    return pdfLoading;
  }
  async function readCv(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (file.size > 5 * 1024 * 1024) throw new Error("That file is over 5 MB.");
    if (ext === "txt" || ext === "md") return file.text();
    if (ext === "pdf") {
      await loadPdfJs();
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let out = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
        const tc = await (await pdf.getPage(i)).getTextContent();
        out += tc.items.map(x => x.str).join(" ") + "\n";
      }
      return out;
    }
    throw new Error("Please upload a PDF or TXT file (in Word, use File → Save as PDF).");
  }

  /* ---------- matching engine ---------- */
  const activeJobs = () => catalog.filter(j => (!j.pending || state.synced) && (j.deadlineDays == null || j.deadlineDays >= 0));
  const closesText = d => d == null ? "" : d <= 0 ? "Closes today" : d === 1 ? "Closes tomorrow" : `Closes in ${d} days`;

  function scoreJob(job, p) {
    const have = new Set(p.skills);
    const mReq = job.skills.filter(s => have.has(s));
    const mNice = job.nice.filter(s => have.has(s));
    const denom = job.skills.length + 0.5 * job.nice.length;
    const skill = denom ? (mReq.length + 0.5 * mNice.length) / denom : 0;
    const field = p.fields.length ? +p.fields.includes(job.cat) : 1;
    const loc = !p.regions.length || job.region === "Remote" || p.regions.includes(job.region) ? 1 : 0;
    const langs = new Set(["English", ...p.langs]);
    const lang = job.langs.every(l => langs.has(l)) ? 1 : 0;
    return {
      job,
      score: Math.round(100 * (0.65 * skill + 0.15 * field + 0.10 * loc + 0.10 * lang)),
      matched: [...mReq, ...mNice],
      missing: job.skills.filter(s => !have.has(s)),
      missingNice: job.nice.filter(s => !have.has(s)),
      parts: { req: [mReq.length, job.skills.length], nice: [mNice.length, job.nice.length], field, loc, lang },
      eligible: job.intl || p.type !== "international",
    };
  }
  const rank = p => activeJobs().map(j => scoreJob(j, p)).sort((a, b) => b.score - a.score || a.job.days - b.job.days);
  const tier = s => s >= 75 ? "strong" : s >= 50 ? "mid" : "low";

  function completeness(p) {
    let n = 0;
    if (p.name) n += 10;
    if (p.cvName) n += 25;
    if (p.linkedin) n += 15;
    if (p.skills.length >= 3) n += 30;
    if (p.fields.length) n += 10;
    if (p.regions.length) n += 5;
    if (p.langs.length) n += 5;
    if (p.year && p.track) n += 0; // informational only
    return Math.min(100, n);
  }

  /* ---------- simulated cohort for the staff reports ---------- */
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const OWN = { Python: .55, Java: .42, JavaScript: .38, SQL: .46, "HTML/CSS": .36, Git: .4, Communication: .5, Excel: .3, React: .2, "Node.js": .15,
    "Machine Learning": .18, "Data Analysis": .2, Pandas: .16, Linux: .18, Networking: .14, "C#": .1, Docker: .08, AWS: .06, Figma: .1, "UI/UX Design": .08 };
  let cohortCache = null, adminRows = null;
  function liveCohort(rows) {
    const jobs = activeJobs(), now = Date.now();
    return rows.map(r => {
      const p = { type: r.type, skills: r.skills, fields: r.fields, regions: r.regions, langs: r.langs };
      const ms = r.skills.length ? jobs.map(j => scoreJob(j, p)).filter(m => m.eligible && m.score >= 60) : [];
      const weeksAgo = Math.floor((now - Date.parse(r.created_at)) / 6048e5);
      return { ...p, hasCv: r.has_cv, matches: ms.length, clicks: r.clicks, week: weeksAgo < 8 ? 7 - weeksAgo : -1 };
    });
  }
  function cohort() {
    if (live() && adminRows) return (cohortCache = liveCohort(adminRows));
    if (cohortCache && !live()) return cohortCache;
    const rnd = mulberry32(2026), jobs = activeJobs(), N = 148, out = [];
    const pick = (arr, k) => { const a = [...arr], r = []; while (r.length < k && a.length) r.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return r; };
    for (let i = 0; i < N; i++) {
      const intl = rnd() > 0.62;
      const hasCv = rnd() < 0.84;
      const skills = hasCv ? ALL_SKILLS.filter(s => rnd() < (OWN[s] ?? .07)) : [];
      const p = { type: intl ? "international" : "malaysian", skills, fields: pick(FIELDS, rnd() < .7 ? 1 + Math.floor(rnd() * 2) : 0),
        regions: pick(REGIONS, rnd() < .6 ? 1 + Math.floor(rnd() * 3) : 0), langs: intl ? ["English"] : ["English", "Bahasa Malaysia"] };
      const ms = skills.length ? jobs.map(j => scoreJob(j, p)).filter(m => m.eligible && m.score >= 60) : [];
      out.push({ ...p, hasCv, matches: ms.length, clicks: ms.length && rnd() < .66 ? 1 + Math.floor(rnd() * 3) : 0, week: Math.min(7, Math.floor(Math.pow(rnd(), 0.7) * 8)) });
    }
    return (cohortCache = out);
  }

  /* ---------- UI primitives ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }
  const chip = (name, val, checked, type = "checkbox") =>
    `<label class="chip"><input type="${type}" name="${name}" value="${esc(val)}" ${checked ? "checked" : ""}><span>${esc(val)}</span></label>`;
  const srcTag = src => `<span class="tag src" style="background:${SOURCES[src].color}">${SOURCES[src].name}</span>`;
  const LOGO = `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--brand)"/><path d="M9 22c0-6 6-4 8-8s-2-6 4-6" stroke="var(--accent)" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="9" cy="23" r="2.4" fill="var(--on-brand)"/><circle cx="22" cy="8.5" r="2.4" fill="var(--on-brand)"/></svg>`;

  function applyTheme() {
    if (state.theme) document.documentElement.dataset.theme = state.theme; else delete document.documentElement.dataset.theme;
  }
  const isDark = () => state.theme ? state.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;

  function renderHeader(route) {
    const u = state.user, isStaff = u?.role === "staff";
    const matchCount = u && !isStaff && state.profile?.skills.length ? rank(state.profile).filter(m => m.eligible && m.score >= 60).length : 0;
    const link = (href, label, extra = "") => `<a href="#${href}" ${route === href ? 'aria-current="page"' : ""}>${label}${extra}</a>`;
    $("#site-header").innerHTML = `<div class="wrap"><nav class="nav" id="nav" aria-label="Main">
      <a class="logo" href="#/" aria-label="Intern_Path home">${LOGO}<span>Intern_Path<small>by ICOM · FCSIT</small></span></a>
      <button class="icon-btn nav-toggle" id="nav-toggle" aria-label="Menu" aria-expanded="false">☰</button>
      <div class="nav-links">
        ${link("/", "Home")}
        ${u && !isStaff ? link("/matches", "My matches", matchCount ? `<span class="badge-count">${matchCount}</span>` : "") + link("/profile", "Profile") : ""}
        ${isStaff ? link("/admin", "Reports") : ""}
      </div>
      <div class="nav-actions">
        <button class="icon-btn" id="theme-btn" aria-label="Toggle dark mode">${isDark() ? "☀" : "☾"}</button>
        ${u ? `<span class="user-pill"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span>${esc(u.name.split(" ")[0])}</span>
               <button class="btn btn-ghost btn-sm" id="signout">Sign out</button>`
            : `<a class="btn btn-primary btn-sm" href="#/login">Sign in</a>`}
      </div></nav></div>`;
    $("#nav-toggle").onclick = e => { const o = $("#nav").classList.toggle("open"); e.currentTarget.setAttribute("aria-expanded", o); };
    $("#theme-btn").onclick = () => { state.theme = isDark() ? "light" : "dark"; persist(); applyTheme(); renderHeader(route); };
    $("#signout")?.addEventListener("click", signOut);
  }
  $("#site-footer").innerHTML = `<div class="wrap">
    <div><strong>Intern_Path</strong> — a WIA2006 project by team <strong>ICOM</strong> (OCC 1M)<br>Faculty of Computer Science &amp; Information Technology, Universiti Malaya</div>
    <div style="max-width:46ch">Prototype: internship listings are sample data and “Apply” links open the platform’s search for that role. Your CV is read in your browser and is never uploaded.</div></div>`;

  /* ---------- views ---------- */
  function viewHome() {
    const demo = rank(DEMO.malaysian.profile).filter(m => m.eligible).slice(0, 3);
    return `
    <section class="wrap hero">
      <div>
        <p class="eyebrow">For FCSIT students · Malaysian &amp; international</p>
        <h1>Find the internship that fits your skills — <span class="hl">without opening ten tabs.</span></h1>
        <p class="lead">Intern_Path collects internship offers from Malaysia’s popular job platforms and LinkedIn, reads your CV, and shows your best matches in one place. You apply on the original website.</p>
        <div class="cta-row">
          <a class="btn btn-primary btn-lg" href="#/login">Get started with Google</a>
          <button class="btn btn-ghost btn-lg" data-scroll="how">See how it works</button>
        </div>
        <div class="hero-meta"><span>5 job sources</span><span>Skill-based matching</span><span>Malaysians &amp; international students</span></div>
      </div>
      <div class="hero-card" aria-label="Example matches">
        ${demo.map(m => `<div class="mini-job"><div class="ring ${tier(m.score)}" style="--p:${m.score};width:64px;height:64px" role="img" aria-label="${m.score} percent match"><b style="font-size:1rem">${m.score}<small>%</small></b></div>
          <div style="flex:1;min-width:0"><h3>${esc(m.job.title)}</h3><p>${esc(m.job.company)} · ${esc(m.job.city)}</p></div>${srcTag(m.job.src)}</div>`).join("")}
        <p class="mini-note">Sample matches for a Year 3 Software Engineering student</p>
      </div>
    </section>

    <div class="wrap sources"><span>Collected from</span>${Object.keys(SOURCES).map(srcTag).join("")}</div>

    <section class="section alt" id="how"><div class="wrap">
      <div class="section-head"><p class="eyebrow">How it works</p><h2>From CV to applications in four steps</h2></div>
      <div class="steps">
        <div class="step"><h3>Sign in with Google</h3><p>Any Google account works. Tell us if you are a Malaysian or an international student.</p></div>
        <div class="step"><h3>Add your CV &amp; LinkedIn</h3><p>Upload a PDF. We read it in your browser and pick out your skills — you can edit them.</p></div>
        <div class="step"><h3>We collect &amp; match</h3><p>Offers from JobStreet, LinkedIn, Hiredly, Indeed and Glints are compared with your skills, field, location and languages.</p></div>
        <div class="step"><h3>Open the link &amp; apply</h3><p>See a match score, the skills you have and the ones to learn, then apply on the original site.</p></div>
      </div>
    </div></section>

    <section class="section"><div class="wrap">
      <div class="section-head"><p class="eyebrow">Built for Malaysia</p><h2>One platform, two kinds of students</h2>
        <p class="muted">Internship rules and needs are not the same for everyone. Intern_Path adjusts to you.</p></div>
      <div class="audience">
        <article class="card"><span class="tag good">🇲🇾 Malaysian students</span><h3>See every opportunity</h3>
          <ul><li>Filter by Kuala Lumpur, Selangor, Penang, Johor or remote.</li>
          <li>Language fit is part of the score — roles asking for Bahasa Malaysia or Mandarin favour students who speak them.</li>
          <li>Includes roles at government-linked and regulated companies that require Malaysian citizenship.</li>
          <li>Monthly allowance in RM shown up front.</li></ul></article>
        <article class="card"><span class="tag intl">🌏 International students in Malaysia</span><h3>Skip the dead ends</h3>
          <ul><li>Listings open to international students carry a clear tag.</li>
          <li>Roles limited to Malaysian citizens are hidden by default — reveal them any time.</li>
          <li>English-friendly roles are not penalised; only roles that truly need another language are.</li>
          <li>A “before you apply” checklist reminds you to confirm Student Pass and faculty requirements.</li></ul></article>
      </div>
    </div></section>

    <section class="section alt"><div class="wrap">
      <div class="section-head"><p class="eyebrow">Why we built it</p><h2>The problems students told us about</h2></div>
      <div class="why">
        <div class="card"><span class="problem">Problem</span><h3>Offers are scattered</h3><p>Good internships hide across many websites, so students miss them. <b>We put them in one list.</b></p></div>
        <div class="card"><span class="problem">Problem</span><h3>Searching takes hours</h3><p>Checking every platform every week is slow. <b>We collect automatically and sync on demand.</b></p></div>
        <div class="card"><span class="problem">Problem</span><h3>“Does this fit me?”</h3><p>Many students are unsure which roles suit their skills. <b>We show a match score and the skills to learn.</b></p></div>
      </div>
    </div></section>

    <section class="section"><div class="wrap"><div class="cta-band">
      <h2>Your next internship is probably already posted.</h2><p>Create your profile in under two minutes.</p>
      <a class="btn btn-accent btn-lg" href="#/login">Get started</a></div></div></section>`;
  }

  const GOOGLE_G = `<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`;
  function viewLogin() {
    const ok = canGoogle();
    return `<div class="wrap auth">
      <section><h1>Sign in</h1><p class="muted">Sign in with any Google account — Malaysian or international students, UM or not. Faculty staff with a <b>@um.edu.my</b> account also get the reports page.</p>
        ${state.authError ? `<div class="note" role="alert" style="margin-top:16px;background:var(--danger-bg);border-color:var(--danger)">${esc(state.authError)}</div>` : ""}
        <div style="margin-top:20px"><button class="btn btn-ghost btn-lg" id="google-btn" ${ok ? "" : "disabled"} style="gap:12px;width:100%;justify-content:center;background:var(--surface)">${GOOGLE_G} Continue with Google</button></div>
        ${ok ? "" : `<p class="hint" style="margin-top:12px">${sb ? "Google sign-in needs the site to be opened from a web address (https:// or http://localhost), not as a local file." : "The sign-in service could not be loaded. Check your internet connection and reload."} Demo accounts below still work.</p>`}
        <p class="hint" style="margin-top:14px">Your profile, saved internships and applications are stored securely in your account, so they follow you to any device.</p></section>
      <aside class="card"><h2 style="font-size:1.1rem">Just exploring?</h2><p class="muted" style="font-size:.92rem">Try a demo account — nothing is saved to the database.</p>
        <div class="demo-list">
          <button class="btn btn-ghost demo-btn" data-demo="malaysian">🇲🇾 Aisyah — Malaysian student<small>Year 3 · Software Engineering</small></button>
          <button class="btn btn-ghost demo-btn" data-demo="international">🌏 Timur — International student<small>Year 2 · Data Science · from Uzbekistan</small></button>
          <button class="btn btn-ghost demo-btn" data-demo="staff">🧑‍🏫 Faculty staff<small>View usage &amp; match reports</small></button>
        </div></aside></div>`;
  }

  function nameFromEmail(e = "") {
    const n = e.split("@")[0].replace(/[._\-\d]+/g, " ").trim();
    return n ? n.replace(/\b\w/g, c => c.toUpperCase()) : "Student";
  }
  function signInDemo(user) {  // offline demo: nothing is sent to the database
    Object.assign(state, { user: { email: user.email, role: user.role, name: user.profile?.name || nameFromEmail(user.email), demo: true },
      profile: user.profile ? structuredClone(user.profile) : null, saved: [], clicks: [], synced: false, syncedAt: null });
    cohortCache = null; persist();
    toast(`Demo mode — welcome, ${state.user.name.split(" ")[0]}!`);
    go(user.role === "staff" ? "/admin" : "/matches");
  }

  /* ---------- writes (database when signed in with Google, localStorage in demo mode) ---------- */
  async function saveProfile(p) {
    if (live()) { const { error } = await sb.from("profiles").update(profileRow(p)).eq("id", state.user.id); if (error) throw error; }
    state.profile = p; state.user.name = p.name || state.user.name; persist();
  }
  async function toggleSaved(id) {
    const had = state.saved.includes(id);
    state.saved = had ? state.saved.filter(x => x !== id) : [...state.saved, id]; persist();
    if (!live()) return;
    const q = had ? sb.from("saved_internships").delete().eq("user_id", state.user.id).eq("internship_id", id)
                  : sb.from("saved_internships").insert({ user_id: state.user.id, internship_id: id });
    const { error } = await q;
    if (error) { state.saved = had ? [...state.saved, id] : state.saved.filter(x => x !== id); renderResults(); toast("Could not save — try again"); }
  }
  async function recordClick(id) {
    if (state.clicks.some(c => c.id === id)) return;
    state.clicks.push({ id }); persist();
    if (live()) await sb.from("apply_clicks").upsert({ user_id: state.user.id, internship_id: id }, { onConflict: "user_id,internship_id", ignoreDuplicates: true });
  }

  function viewProfile() {
    const p = state.profile, pct = completeness(p), intl = p.type === "international";
    return `<div class="wrap">
      <div class="page-head"><div><p class="eyebrow">Step 1 of 2</p><h1>Your profile</h1><p class="muted">The more accurate this is, the better your matches.</p></div>
        <div class="meter"><div style="display:flex;justify-content:space-between;font-weight:700;font-size:.9rem"><span>Profile strength</span><span id="pct">${pct}%</span></div><div class="meter-bar"><i id="pct-bar" style="width:${pct}%"></i></div></div></div>
      <form id="profile-form" class="form-stack" novalidate>
        <section class="card"><h2>About you</h2><p class="sub">This decides which internships you are eligible for.</p>
          <div class="grid-2">
            <label class="field">Full name<input type="text" name="name" value="${esc(p.name)}" autocomplete="name" required></label>
            <label class="field">Email<input type="text" value="${esc(state.user.email)}" disabled></label>
          </div>
          <fieldset style="border:0;padding:0;margin:18px 0 0"><legend class="hint" style="font-weight:700;margin-bottom:8px;color:var(--text)">I am a…</legend>
            <div class="seg">
              <label><input type="radio" name="type" value="malaysian" ${!intl ? "checked" : ""}><span>🇲🇾 Malaysian student<small>Citizen or permanent resident</small></span></label>
              <label><input type="radio" name="type" value="international" ${intl ? "checked" : ""}><span>🌏 International student<small>Studying in Malaysia on a Student Pass</small></span></label>
            </div></fieldset>
          <div class="grid-2" style="margin-top:18px">
            <label class="field" id="nat-wrap" ${intl ? "" : "hidden"}>Nationality<input type="text" name="nationality" list="nat-list" value="${esc(p.nationality)}" placeholder="e.g. Indonesia">
              <datalist id="nat-list">${NATIONALITIES.map(n => `<option value="${n}">`).join("")}</datalist></label>
            <label class="field">Year of study<select name="year"><option value="">Select…</option>${[1, 2, 3, 4].map(y => `<option value="${y}" ${p.year == y ? "selected" : ""}>Year ${y}</option>`).join("")}</select></label>
            <label class="field">Programme / specialisation<select name="track"><option value="">Select…</option>${TRACKS.map(t => `<option ${p.track === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          </div></section>

        <section class="card"><h2>CV &amp; LinkedIn</h2><p class="sub">We read your CV <b>in your browser</b> to find your skills. The file itself is not uploaded or stored.</p>
          <label class="dropzone" id="drop" style="position:relative"><input type="file" id="cv" accept=".pdf,.txt,.md,application/pdf,text/plain">
            <strong>📄 Drop your CV here or click to choose</strong><br><span class="hint">PDF or TXT · up to 5 MB</span><br><span id="cv-name" style="font-weight:700">${p.cvName ? "Current: " + esc(p.cvName) : ""}</span></label>
          <div class="cv-result" id="cv-result" aria-live="polite"></div>
          <label class="field" style="margin-top:12px">LinkedIn profile link<input type="url" name="linkedin" value="${esc(p.linkedin)}" placeholder="https://www.linkedin.com/in/your-name" aria-describedby="li-err"></label>
          <div class="err" id="li-err" role="alert"></div></section>

        <section class="card"><h2>Your skills</h2><p class="sub">Tick everything you are comfortable using. Skills found in your CV are ticked for you.</p>
          ${SKILL_GROUPS.map(g => `<div class="skill-group"><h3>${g.group}</h3><div class="chips">${g.skills.map(([n]) => chip("skills", n, p.skills.includes(n))).join("")}</div></div>`).join("")}</section>

        <section class="card"><h2>Preferences</h2><p class="sub">Used to rank internships — they never hide roles from you (except ones you are not eligible for).</p>
          <div class="skill-group"><h3>Fields of interest</h3><div class="chips">${FIELDS.map(f => chip("fields", f, p.fields.includes(f))).join("")}</div></div>
          <div class="skill-group"><h3>Preferred locations</h3><div class="chips">${REGIONS.map(r => chip("regions", r, p.regions.includes(r))).join("")}</div></div>
          <div class="skill-group"><h3>Work mode</h3><div class="chips">${MODES.map(m => `<label class="chip"><input type="radio" name="mode" value="${m}" ${p.mode === m ? "checked" : ""}><span>${m}</span></label>`).join("")}</div></div>
          <div class="skill-group"><h3>Languages you can work in</h3><div class="chips">${LANGUAGES.map(l => chip("langs", l, p.langs.includes(l))).join("")}</div></div></section>
      </form></div>
      <div class="save-bar"><div class="wrap"><span class="muted" id="save-hint">Changes are saved when you click the button.</span><button class="btn btn-primary btn-lg" type="submit" form="profile-form">Save &amp; see my matches →</button></div></div>`;
  }

  function readProfileForm(form) {
    const fd = new FormData(form), all = n => fd.getAll(n);
    return { ...state.profile, name: (fd.get("name") || "").trim(), type: fd.get("type"),
      nationality: fd.get("type") === "international" ? (fd.get("nationality") || "").trim() : "",
      year: fd.get("year"), track: fd.get("track"), linkedin: (fd.get("linkedin") || "").trim(),
      skills: all("skills"), fields: all("fields"), regions: all("regions"), mode: fd.get("mode") || "Any", langs: unique(["English", ...all("langs")]) };
  }

  /* matches view state */
  const mf = { q: "", src: "", region: "", mode: "", min: 0, sort: "match", paid: false, saved: false, showIneligible: false };
  const syncText = () => catalogLive
    ? `Collected automatically twice a day (8:00 and 20:00 Malaysia time)${lastChecked ? " · last check " + new Date(lastChecked).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : ""}. Closed listings disappear at their deadline.`
    : state.syncedAt ? "Last synced " + new Date(state.syncedAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "Showing the latest saved offers. Sync to fetch new ones.";

  function viewMatches() {
    const p = state.profile, intl = p.type === "international";
    if (!p.skills.length) return `<div class="wrap"><div class="card empty" style="margin-top:48px"><h2>Let’s find your skills first</h2>
      <p class="muted" style="margin-bottom:18px">Upload your CV or tick a few skills, and we’ll rank internships for you.</p><a class="btn btn-primary" href="#/profile">Complete my profile</a></div></div>`;
    return `<div class="wrap">
      <div class="page-head"><div><p class="eyebrow">Step 2 of 2</p><h1>Your matches</h1><p class="muted" id="match-summary"></p></div>
        <a class="btn btn-ghost" href="#/profile">Edit profile</a></div>
      <div class="card sync-card"><div><strong>Internship collection</strong><div class="hint" id="sync-status">${syncText()}</div></div>
        <div class="src-list" id="src-list">${Object.entries(SOURCES).filter(([id]) => id !== "direct").map(([id, s]) => `<span><i class="dot ${state.synced || catalogLive ? "ok" : ""}" data-dot="${id}"></i>${s.name}</span>`).join("")}</div>
        <button class="btn btn-primary btn-sm" id="sync-btn" style="margin-left:auto">${catalogLive ? "⟳ Refresh" : "⟳ Sync now"}</button></div>
      ${intl ? `<details class="callout" style="margin-top:16px"><summary>Before you apply — checklist for international students</summary><ul class="checklist">
        <li>Ask your faculty’s industrial-training coordinator whether this internship counts towards your programme.</li>
        <li>Check with the university’s international student office and the Immigration Department of Malaysia whether your Student Pass allows the placement — rules can change, so confirm the current requirements.</li>
        <li>Ask the company early whether it hires international interns and can support any paperwork.</li></ul></details>` : ""}
      <form class="filters" id="filters" role="search" aria-label="Filter internships" onsubmit="return false">
        <input class="q" type="search" id="f-q" placeholder="Search title, company or skill…" aria-label="Search">
        <select id="f-src" aria-label="Source"><option value="">All sources</option>${Object.entries(SOURCES).map(([id, s]) => `<option value="${id}">${s.name}</option>`).join("")}</select>
        <select id="f-region" aria-label="Location"><option value="">All locations</option>${REGIONS.map(r => `<option>${r}</option>`).join("")}</select>
        <select id="f-mode" aria-label="Work mode"><option value="">Any mode</option>${MODES.slice(1).map(m => `<option>${m}</option>`).join("")}</select>
        <select id="f-min" aria-label="Minimum match"><option value="0">Any match</option><option value="40">40%+</option><option value="60">60%+</option><option value="75">75%+</option></select>
        <select id="f-sort" aria-label="Sort by"><option value="match">Best match</option><option value="closing">Closing soon</option><option value="new">Newest</option></select>
      </form>
      <div class="toggles"><label><input type="checkbox" id="f-paid"> Paid only</label><label><input type="checkbox" id="f-saved"> Saved only</label>
        ${intl ? `<label><input type="checkbox" id="f-inel"><span>Also show roles for Malaysian citizens only (<span id="inel-count">0</span>)</span></label>` : ""}</div>
      <div class="results" id="results" aria-live="polite"></div></div>`;
  }

  function jobCard(m, p) {
    const j = m.job, saved = state.saved.includes(j.id), opened = state.clicks.some(c => c.id === j.id);
    const w = m.parts;
    return `<article class="card job" data-id="${j.id}">
      <div><h3>${esc(j.title)}</h3><p class="co">${esc(j.company)} · ${esc(j.city)}</p>
        <div class="tags">${srcTag(j.src)}<span class="tag">${j.mode}</span><span class="tag">${rm(j.allow)}/mo</span><span class="tag">${j.months} months</span><span class="tag">${ago(j.days)}</span>${j.deadlineDays != null ? `<span class="tag ${j.deadlineDays <= 7 ? "warn" : ""}" title="${esc(j.deadline || "")}">⏳ ${closesText(j.deadlineDays)}</span>` : ""}
          ${j.intl ? '<span class="tag intl">🌏 Open to international students</span>' : '<span class="tag warn">🇲🇾 Malaysian citizens only</span>'}
          ${j.langs.map(l => `<span class="tag">Needs ${esc(l)}</span>`).join("")}${(j.pending && state.synced) || (catalogLive && j.days === 0) ? '<span class="tag good">New</span>' : ""}</div>
        <p class="desc">${esc(j.desc)}</p>
        <div class="skills-row"><span class="lbl">You have</span>${m.matched.length ? m.matched.map(s => `<span class="sk have">${esc(s)}</span>`).join("") : '<span class="hint">No listed skills yet</span>'}</div>
        ${m.missing.length || m.missingNice.length ? `<div class="skills-row"><span class="lbl">To learn</span>${m.missing.map(s => `<span class="sk miss" title="Required">${esc(s)}</span>`).join("")}${m.missingNice.map(s => `<span class="sk miss" title="Nice to have" style="opacity:.7">${esc(s)}</span>`).join("")}</div>` : ""}
        <details class="why-match"><summary>Why this match?</summary><ul>
          <li>Required skills: ${w.req[0]} of ${w.req[1]}${w.nice[1] ? ` · nice-to-have: ${w.nice[0]} of ${w.nice[1]}` : ""} (65% of score)</li>
          <li>Field: ${p.fields.length ? (w.field ? "matches your interests" : "outside your chosen fields") : "no preference set"} (15%)</li>
          <li>Location: ${w.loc ? "fits your preference" : "outside your preferred locations"} (10%)</li>
          <li>Language: ${w.lang ? "you meet the language needs" : "needs a language not in your profile"} (10%)</li></ul></details></div>
      <div class="job-side"><div class="ring ${tier(m.score)}" style="--p:${m.score}" role="img" aria-label="${m.score} percent match"><b>${m.score}<small>%</small></b></div>
        <div class="job-actions"><a class="btn btn-primary btn-sm" data-apply="${j.id}" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">${opened ? "Open again" : "Apply on " + SOURCES[j.src].name} ↗</a>
          <button class="btn btn-ghost btn-sm save-btn" data-save="${j.id}" aria-pressed="${saved}" aria-label="${saved ? "Unsave" : "Save"} ${esc(j.title)}">${saved ? "★ Saved" : "☆ Save"}</button></div></div></article>`;
  }

  function renderResults() {
    const p = state.profile, intl = p.type === "international";
    const q = mf.q.trim().toLowerCase();
    const all = rank(p);
    const base = all.filter(m => {
      const j = m.job;
      if (mf.src && j.src !== mf.src) return false;
      if (mf.region && j.region !== mf.region) return false;
      if (mf.mode && j.mode !== mf.mode) return false;
      if (m.score < mf.min) return false;
      if (mf.paid && !j.allow) return false;
      if (mf.saved && !state.saved.includes(j.id)) return false;
      if (q && ![j.title, j.company, j.city, ...j.skills, ...j.nice].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
    const hidden = base.filter(m => !m.eligible);
    const shown = base.filter(m => m.eligible || mf.showIneligible);
    if (mf.sort === "closing") shown.sort((a, b) => (a.job.deadlineDays ?? 999) - (b.job.deadlineDays ?? 999) || b.score - a.score);
    else if (mf.sort === "new") shown.sort((a, b) => a.job.days - b.job.days || b.score - a.score);
    const strong = all.filter(m => m.eligible && m.score >= 75).length;
    $("#match-summary").textContent = `${all.filter(m => m.eligible).length} internships you can apply to · ${strong} strong matches (75%+)`;
    const ic = $("#inel-count"); if (ic) ic.textContent = hidden.length;
    $("#results").innerHTML = shown.length ? shown.map(m => jobCard(m, p)).join("")
      : `<div class="card empty"><h2>No internships match these filters</h2><p class="muted">Try clearing a filter${intl && hidden.length ? " or show Malaysian-only roles" : ""}.</p></div>`;
  }

  async function runSync(btn) {
    btn.disabled = true;
    if (catalogLive) {  // real data is collected on the server twice a day; this just re-reads it
      const before = new Set(catalog.map(j => j.id));
      await loadCatalog();
      const fresh = catalog.filter(j => !before.has(j.id)).length;
      if (location.hash.startsWith("#/matches")) render();
      toast(fresh ? `${fresh} new internships found` : `Up to date — ${activeJobs().length} open internships`);
      return;
    }
    const status = $("#sync-status");
    for (const id of Object.keys(SOURCES)) {
      const dot = $(`[data-dot="${id}"]`); dot.className = "dot busy";
      status.textContent = `Checking ${SOURCES[id].name}…`;
      await sleep(420);
      dot.className = "dot ok";
    }
    const fresh = state.synced ? 0 : catalog.filter(j => j.pending).length;
    state.synced = true; state.syncedAt = Date.now(); persist();
    if (location.hash.startsWith("#/matches")) { render(); }
    toast(fresh ? `${fresh} new internships added` : "Already up to date — no new offers");
  }

  /* ---------- admin ---------- */
  function adminStats() {
    const c = cohort(), jobs = activeJobs(), n = c.length;
    const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
    const withCv = c.filter(s => s.hasCv).length, matched = c.filter(s => s.matches > 0).length;
    const clicks = c.reduce((a, s) => a + s.clicks, 0);
    const my = c.filter(s => s.type === "malaysian"), intl = c.filter(s => s.type === "international");
    const count = (arr, f) => { const m = new Map(); arr.forEach(x => [].concat(f(x)).forEach(k => m.set(k, (m.get(k) || 0) + 1))); return m; };
    const demand = [...count(jobs, j => [...j.skills]).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const own = s => pct(c.filter(x => x.skills.includes(s)).length, n);
    return { n, withCv, matched, clicks, my, intl, jobs, pct, own, demand,
      bySrc: [...count(jobs, j => j.src).entries()].sort((a, b) => b[1] - a[1]),
      byReg: [...count(jobs, j => j.region).entries()].sort((a, b) => b[1] - a[1]),
      weeks: Array.from({ length: 8 }, (_, w) => c.filter(s => s.week === w).length).reverse(),
      avg: arr => arr.length ? (arr.reduce((a, s) => a + s.matches, 0) / arr.length).toFixed(1) : "0",
      share: arr => pct(arr.filter(s => s.matches > 0).length, arr.length) };
  }
  const barRows = (rows, max, fmt = v => v, color) => rows.map(([l, v]) => `<div class="bar-row"><span>${esc(l)}</span><div class="bar-track"><i style="width:${max ? 100 * v / max : 0}%${color ? ";background:" + color(l) : ""}"></i></div><span class="n">${fmt(v)}</span></div>`).join("");

  function viewAdmin() {
    const s = adminStats(), maxSrc = Math.max(...s.bySrc.map(x => x[1])), maxReg = Math.max(...s.byReg.map(x => x[1])), maxW = Math.max(...s.weeks, 1);
    const myPct = s.pct(s.my.length, s.n);
    return `<div class="wrap">
      <div class="page-head"><div><p class="eyebrow">Faculty staff</p><h1>Usage &amp; match reports</h1><p class="muted">${live() ? (s.n ? `Live data from ${s.n} registered student${s.n === 1 ? "" : "s"} — anonymised, no names or emails.` : "No students have signed up yet — numbers appear as soon as they do.") : `Simulated cohort of ${s.n} students — demo data, not real students.`}</p></div>
        <button class="btn btn-ghost" id="export">⭳ Export CSV</button></div>
      <div class="kpis">
        <div class="card kpi"><div class="v">${s.n}</div><div class="l">Registered students</div><div class="s">${s.my.length} Malaysian · ${s.intl.length} international</div></div>
        <div class="card kpi"><div class="v">${s.pct(s.withCv, s.n)}%</div><div class="l">Uploaded a CV</div><div class="s">${s.withCv} of ${s.n} students</div></div>
        <div class="card kpi"><div class="v">${s.pct(s.matched, s.n)}%</div><div class="l">Received 60%+ matches</div><div class="s">${s.matched} students with at least one</div></div>
        <div class="card kpi"><div class="v">${s.clicks}</div><div class="l">Apply links opened</div><div class="s">${s.jobs.length} active internship offers</div></div>
      </div>
      <div class="admin-grid">
        <section class="card"><h2>Malaysian vs international</h2><p class="sub">Who is using the system and who is getting matches.</p>
          <div class="split-bar" role="img" aria-label="${myPct}% Malaysian, ${100 - myPct}% international"><i style="width:${myPct}%;background:var(--brand)"></i><i style="width:${100 - myPct}%;background:var(--intl)"></i></div>
          <table class="table"><thead><tr><th>Group</th><th>Students</th><th>With matches</th><th>Avg matches</th></tr></thead><tbody>
            <tr><td>🇲🇾 Malaysian</td><td>${s.my.length}</td><td>${s.share(s.my)}%</td><td>${s.avg(s.my)}</td></tr>
            <tr><td>🌏 International</td><td>${s.intl.length}</td><td>${s.share(s.intl)}%</td><td>${s.avg(s.intl)}</td></tr></tbody></table>
          <p class="hint" style="margin-top:10px">International students see fewer eligible roles because some employers accept Malaysian citizens only.</p></section>
        <section class="card"><h2>New sign-ups per week</h2><p class="sub">Last 8 weeks (oldest → newest).</p>
          <div class="cols" role="img" aria-label="Weekly sign-ups">${s.weeks.map((v, i) => `<div><span>${v}</span><i style="height:${100 * v / maxW * .8}%"></i><span>W${i + 1}</span></div>`).join("")}</div></section>
        <section class="card span-2"><h2>Collection &amp; deadlines</h2><p class="sub">${catalogLive ? "Listings are collected automatically twice a day (8:00 and 20:00 Malaysia time)." : "Demo data — connect the database for automatic collection."} A listing is hidden the moment its deadline passes and deleted 7 days later.</p>
          <div class="kpis" style="grid-template-columns:repeat(3,1fr)"><div><div class="v" style="font-size:1.6rem">${s.jobs.length}</div><div class="l">Open offers</div></div>
            <div><div class="v" style="font-size:1.6rem">${s.jobs.filter(j => j.deadlineDays != null && j.deadlineDays <= 7).length}</div><div class="l">Closing within 7 days</div></div>
            <div><div class="v" style="font-size:1.6rem">${s.jobs.filter(j => j.days === 0).length}</div><div class="l">Added today</div></div></div></section>
        <section class="card"><h2>Offers collected by source</h2><p class="sub">Active internship offers in the system.</p>
          <div class="bars">${barRows(s.bySrc.map(([k, v]) => [SOURCES[k].name, v]), maxSrc, v => v, l => Object.values(SOURCES).find(x => x.name === l).color)}</div></section>
        <section class="card"><h2>Offers by location</h2><p class="sub">Where internships are available.</p>
          <div class="bars">${barRows(s.byReg, maxReg)}</div></section>
        <section class="card span-2"><h2>Skill gap — what employers want vs what students have</h2><p class="sub">Top 10 skills required across active offers, compared with the share of students who list them. Useful for workshops and curriculum planning.</p>
          <table class="table"><thead><tr><th>Skill</th><th>Offers requiring it</th><th>Students who have it</th><th></th></tr></thead><tbody>
            ${s.demand.map(([sk, d]) => { const o = s.own(sk); return `<tr><td><b>${esc(sk)}</b></td><td>${d}</td><td>${o}%</td><td>${o < 25 ? '<span class="tag warn">Gap</span>' : '<span class="tag good">Covered</span>'}</td></tr>`; }).join("")}</tbody></table></section>
      </div></div>`;
  }

  function exportCsv() {
    const s = adminStats();
    const rows = [["Metric", "Value"], ["Registered students", s.n], ["Malaysian students", s.my.length], ["International students", s.intl.length],
      ["Students with CV (%)", s.pct(s.withCv, s.n)], ["Students with 60%+ matches (%)", s.pct(s.matched, s.n)], ["Apply links opened", s.clicks],
      ["Active offers", s.jobs.length], ...s.bySrc.map(([k, v]) => [`Offers from ${SOURCES[k].name}`, v]),
      ...s.demand.map(([k, v]) => [`Skill demand: ${k} (offers) / students with skill (%)`, `${v} / ${s.own(k)}`])];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "intern_path_report.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Report downloaded");
  }

  /* ---------- router ---------- */
  const go = path => { if (location.hash === "#" + path) render(); else location.hash = path; };
  const GUARD = { "/profile": "student", "/matches": "student", "/admin": "staff" };

  let ready = false;
  function render() {
    if (!ready) return;
    let route = location.hash.replace(/^#/, "") || "/";
    if (!["/", "/login", "/profile", "/matches", "/admin"].includes(route)) route = "/";
    const need = GUARD[route];
    if (need && !state.user) { toast("Please sign in first"); route = "/login"; history.replaceState(null, "", "#/login"); }
    else if (need && state.user.role !== need) { route = state.user.role === "staff" ? "/admin" : "/matches"; history.replaceState(null, "", "#" + route); }
    else if (route === "/login" && state.user) { route = state.user.role === "staff" ? "/admin" : "/matches"; history.replaceState(null, "", "#" + route); }
    if (route === "/profile" && !state.profile) state.profile = blankProfile();

    if (route !== "/admin") adminRows = null;
    if (route === "/admin" && live() && !adminRows) {  // staff reports: fetch anonymised rows first
      renderHeader(route);
      $("#app").innerHTML = '<div class="wrap"><p class="muted" style="padding:60px 0">Loading reports…</p></div>';
      sb.rpc("admin_students").then(({ data, error }) => {
        if (error) toast("Could not load reports: " + error.message);
        adminRows = error ? [] : data; render();
      });
      return;
    }

    document.title = { "/": "Intern_Path — Internships in Malaysia", "/login": "Sign in — Intern_Path", "/profile": "My profile — Intern_Path", "/matches": "My matches — Intern_Path", "/admin": "Reports — Intern_Path" }[route];
    renderHeader(route);
    const app = $("#app");
    app.innerHTML = { "/": viewHome, "/login": viewLogin, "/profile": viewProfile, "/matches": viewMatches, "/admin": viewAdmin }[route]();
    ({ "/": bindHome, "/login": bindLogin, "/profile": bindProfile, "/matches": bindMatches, "/admin": bindAdmin }[route])();
    if (!render.first) { app.focus({ preventScroll: true }); window.scrollTo(0, 0); } render.first = false;
  }
  render.first = true;

  /* ---------- bindings ---------- */
  function bindHome() {
    $$("[data-scroll]").forEach(b => b.onclick = () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: "smooth" }));
  }

  function bindLogin() {
    $("#google-btn").onclick = e => { e.currentTarget.disabled = true; state.authError = ""; signInWithGoogle(); };
    $$("[data-demo]").forEach(b => b.onclick = () => signInDemo(DEMO[b.dataset.demo]));
  }

  function bindProfile() {
    const form = $("#profile-form"), result = $("#cv-result");
    const refreshMeter = () => {
      const p = readProfileForm(form); p.cvName = state.profile.cvName;
      const v = completeness(p); $("#pct").textContent = v + "%"; $("#pct-bar").style.width = v + "%";
    };
    form.addEventListener("input", refreshMeter); form.addEventListener("change", refreshMeter);
    $$('input[name="type"]').forEach(r => r.addEventListener("change", () => { $("#nat-wrap").hidden = r.value !== "international" || !r.checked; }));

    async function handleFile(file) {
      if (!file) return;
      result.innerHTML = '<span class="muted">Reading your CV…</span>';
      try {
        const text = await readCv(file), found = extractSkills(text);
        state.profile.cvName = file.name; $("#cv-name").textContent = "Current: " + file.name;
        $$('input[name="skills"]').forEach(c => { if (found.includes(c.value)) c.checked = true; });
        const li = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^\s/?#)]+/i)?.[0];
        const liInput = form.elements.linkedin;
        if (li && !liInput.value) liInput.value = li.startsWith("http") ? li : "https://" + li;
        result.innerHTML = found.length
          ? `<span style="color:var(--good);font-weight:700">✓ Found ${found.length} skills:</span> ${found.map(s => `<span class="sk have">${esc(s)}</span>`).join(" ")}`
          : '<span style="color:var(--warn);font-weight:700">We could not find known skills in this CV.</span> Please tick your skills below.';
        refreshMeter();
      } catch (e) {
        result.innerHTML = `<span class="err">${esc(e.message || "Could not read this file.")} You can still tick your skills below.</span>`;
      }
    }
    $("#cv").onchange = e => handleFile(e.target.files[0]);
    const drop = $("#drop");
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));

    form.onsubmit = async e => {
      e.preventDefault();
      const p = readProfileForm(form), li = $("#li-err"), liInput = form.elements.linkedin;
      if (p.linkedin && !LINKEDIN_RE.test(p.linkedin)) { liInput.setAttribute("aria-invalid", "true"); li.textContent = "Use a link like https://www.linkedin.com/in/your-name"; liInput.focus(); return; }
      if (p.linkedin && !/^https?:\/\//i.test(p.linkedin)) p.linkedin = "https://" + p.linkedin;
      if (!p.name) { form.elements.name.focus(); toast("Please enter your name"); return; }
      const btn = $('button[form="profile-form"]'); btn.disabled = true;
      try { await saveProfile(p); } catch (err) { btn.disabled = false; toast("Could not save your profile: " + (err.message || "try again")); return; }
      toast(p.skills.length ? "Profile saved" : "Profile saved — add some skills to get matches");
      go(p.skills.length ? "/matches" : "/profile");
    };
  }

  function bindMatches() {
    if (!state.profile.skills.length) return;
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on("#f-q", "input", e => { mf.q = e.target.value; renderResults(); });
    on("#f-src", "change", e => { mf.src = e.target.value; renderResults(); });
    on("#f-region", "change", e => { mf.region = e.target.value; renderResults(); });
    on("#f-mode", "change", e => { mf.mode = e.target.value; renderResults(); });
    on("#f-min", "change", e => { mf.min = +e.target.value; renderResults(); });
    on("#f-sort", "change", e => { mf.sort = e.target.value; renderResults(); });
    on("#f-paid", "change", e => { mf.paid = e.target.checked; renderResults(); });
    on("#f-saved", "change", e => { mf.saved = e.target.checked; renderResults(); });
    on("#f-inel", "change", e => { mf.showIneligible = e.target.checked; renderResults(); });
    // restore filter UI after a re-render (e.g. after sync)
    $("#f-q").value = mf.q; $("#f-src").value = mf.src; $("#f-region").value = mf.region; $("#f-mode").value = mf.mode; $("#f-min").value = mf.min; $("#f-sort").value = mf.sort;
    $("#f-paid").checked = mf.paid; $("#f-saved").checked = mf.saved; if ($("#f-inel")) $("#f-inel").checked = mf.showIneligible;
    on("#sync-btn", "click", e => runSync(e.currentTarget));
    $("#results").addEventListener("click", e => {
      const a = e.target.closest("[data-apply]"), s = e.target.closest("[data-save]");
      if (a) {
        recordClick(+a.dataset.apply);
        setTimeout(() => { a.textContent = "Open again ↗"; }, 0);
      }
      if (s) {
        const id = +s.dataset.save;
        toggleSaved(id); const open = $$("details.why-match[open]").map(d => d.closest(".job").dataset.id);
        renderResults(); open.forEach(i => $(`.job[data-id="${i}"] details.why-match`)?.setAttribute("open", ""));
        $(`[data-save="${id}"]`)?.focus();
      }
    });
    renderResults();
  }

  function bindAdmin() { $("#export").onclick = exportCsv; }

  /* ---------- boot ---------- */
  applyTheme();
  addEventListener("hashchange", render);
  $("#app").innerHTML = '<div class="wrap"><p class="muted" style="padding:80px 0">Loading…</p></div>';

  // Google sends failures back in the URL .
  const urlErr = new URLSearchParams(location.search).get("error_description") || new URLSearchParams(location.hash.replace(/^#\/?/, "")).get("error_description");
  if (urlErr) {
    state.authError = /database error|not allowed|signup/i.test(urlErr)
      ? "Sign-in failed. Please try again with a Google account."
      : urlErr.replace(/\+/g, " ");
    history.replaceState(null, "", location.pathname + "#/login");
  }

  (async () => {
    try {
      await loadCatalog();
      if (sb && !state.user) {
        const { data } = await sb.auth.getSession();  // also finishes the Google redirect (?code=…)
        await applySession(data.session);
      }
    } catch (e) { console.warn("Startup:", e); }
    ready = true;
    let cameFromLogin = false;
    try { cameFromLogin = sessionStorage.getItem("ip_login") === "1" && !!state.user; if (state.user) sessionStorage.removeItem("ip_login"); } catch { /* ignore */ }
    if (cameFromLogin) {
      const dest = state.user.role === "staff" ? "/admin" : state.profile?.skills.length ? "/matches" : "/profile";
      toast(`Welcome, ${state.user.name.split(" ")[0]}!`);
      if (location.hash !== "#" + dest) { location.hash = dest; return; }
    }
    render();
    if (sb) sb.auth.onAuthStateChange(evt => {
      if (evt === "SIGNED_OUT" && live()) { Object.assign(state, { user: null, profile: null, saved: [], clicks: [] }); render(); }
    });
  })();
})();

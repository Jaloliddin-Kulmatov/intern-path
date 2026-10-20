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

  /* ---------- state (localStorage with in-memory fallback) ---------- */
  const KEY = "internpath.v1";
  const loadState = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const state = Object.assign({ user: null, profile: null, saved: [], clicks: [], synced: false, syncedAt: null, theme: null }, loadState());
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked: stay in memory */ } };

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
  const activeJobs = () => JOBS.filter(j => !j.pending || state.synced);

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
  let cohortCache = null;
  function cohort() {
    if (cohortCache) return cohortCache;
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
    $("#signout")?.addEventListener("click", () => { state.user = null; persist(); toast("Signed out"); go("/"); });
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
          <a class="btn btn-primary btn-lg" href="#/login">Get started with your UM email</a>
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
        <div class="step"><h3>Sign in with your UM email</h3><p>Use your <b>@siswa.um.edu.my</b> address. Tell us if you are a Malaysian or an international student.</p></div>
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

  function viewLogin() {
    return `<div class="wrap auth">
      <section><h1>Sign in</h1><p class="muted">Use your UM email. Students use <b>@siswa.um.edu.my</b>; faculty staff use <b>@um.edu.my</b>.</p>
        <form id="login-form" novalidate>
          <label class="field">UM email<input type="email" id="email" autocomplete="email" placeholder="name@siswa.um.edu.my" required aria-describedby="email-err"></label>
          <div class="err" id="email-err" role="alert"></div>
          <button class="btn btn-primary btn-lg" type="submit">Continue</button>
        </form>
        <p class="hint" style="margin-top:14px">Prototype: there is no password. The real system would verify your UM email by sending a one-time link.</p></section>
      <aside class="card"><h2 style="font-size:1.1rem">Just exploring?</h2><p class="muted" style="font-size:.92rem">Jump in with a ready-made demo account.</p>
        <div class="demo-list">
          <button class="btn btn-ghost demo-btn" data-demo="malaysian">🇲🇾 Aisyah — Malaysian student<small>Year 3 · Software Engineering</small></button>
          <button class="btn btn-ghost demo-btn" data-demo="international">🌏 Timur — International student<small>Year 2 · Data Science · from Uzbekistan</small></button>
          <button class="btn btn-ghost demo-btn" data-demo="staff">🧑‍🏫 Faculty staff<small>View usage &amp; match reports</small></button>
        </div></aside></div>`;
  }

  function nameFromEmail(e) {
    const n = e.split("@")[0].replace(/[._\-\d]+/g, " ").trim();
    return n ? n.replace(/\b\w/g, c => c.toUpperCase()) : "Student";
  }
  function signIn(user) {
    state.user = { email: user.email, role: user.role, name: user.profile?.name || nameFromEmail(user.email) };
    if (user.role === "student") state.profile = user.profile ? structuredClone(user.profile) : (state.profile ?? { ...blankProfile(), name: state.user.name });
    persist();
    toast(`Welcome, ${state.user.name.split(" ")[0]}!`);
    go(user.role === "staff" ? "/admin" : state.profile.skills.length ? "/matches" : "/profile");
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
            <label class="field">UM email<input type="text" value="${esc(state.user.email)}" disabled></label>
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
  const mf = { q: "", src: "", region: "", mode: "", min: 0, paid: false, saved: false, showIneligible: false };

  function viewMatches() {
    const p = state.profile, intl = p.type === "international";
    if (!p.skills.length) return `<div class="wrap"><div class="card empty" style="margin-top:48px"><h2>Let’s find your skills first</h2>
      <p class="muted" style="margin-bottom:18px">Upload your CV or tick a few skills, and we’ll rank internships for you.</p><a class="btn btn-primary" href="#/profile">Complete my profile</a></div></div>`;
    return `<div class="wrap">
      <div class="page-head"><div><p class="eyebrow">Step 2 of 2</p><h1>Your matches</h1><p class="muted" id="match-summary"></p></div>
        <a class="btn btn-ghost" href="#/profile">Edit profile</a></div>
      <div class="card sync-card"><div><strong>Internship collection</strong><div class="hint" id="sync-status">${state.syncedAt ? "Last synced " + new Date(state.syncedAt).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "Showing the latest saved offers. Sync to fetch new ones."}</div></div>
        <div class="src-list" id="src-list">${Object.entries(SOURCES).map(([id, s]) => `<span><i class="dot ${state.synced ? "ok" : ""}" data-dot="${id}"></i>${s.name}</span>`).join("")}</div>
        <button class="btn btn-primary btn-sm" id="sync-btn" style="margin-left:auto">⟳ Sync now</button></div>
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
        <div class="tags">${srcTag(j.src)}<span class="tag">${j.mode}</span><span class="tag">${rm(j.allow)}/mo</span><span class="tag">${j.months} months</span><span class="tag">${ago(j.days)}</span>
          ${j.intl ? '<span class="tag intl">🌏 Open to international students</span>' : '<span class="tag warn">🇲🇾 Malaysian citizens only</span>'}
          ${j.langs.map(l => `<span class="tag">Needs ${esc(l)}</span>`).join("")}${j.pending && state.synced ? '<span class="tag good">New</span>' : ""}</div>
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
    const strong = all.filter(m => m.eligible && m.score >= 75).length;
    $("#match-summary").textContent = `${all.filter(m => m.eligible).length} internships you can apply to · ${strong} strong matches (75%+)`;
    const ic = $("#inel-count"); if (ic) ic.textContent = hidden.length;
    $("#results").innerHTML = shown.length ? shown.map(m => jobCard(m, p)).join("")
      : `<div class="card empty"><h2>No internships match these filters</h2><p class="muted">Try clearing a filter${intl && hidden.length ? " or show Malaysian-only roles" : ""}.</p></div>`;
  }

  async function runSync(btn) {
    btn.disabled = true;
    const status = $("#sync-status");
    for (const id of Object.keys(SOURCES)) {
      const dot = $(`[data-dot="${id}"]`); dot.className = "dot busy";
      status.textContent = `Checking ${SOURCES[id].name}…`;
      await sleep(420);
      dot.className = "dot ok";
    }
    const fresh = state.synced ? 0 : JOBS.filter(j => j.pending).length;
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
      <div class="page-head"><div><p class="eyebrow">Faculty staff</p><h1>Usage &amp; match reports</h1><p class="muted">Simulated cohort of ${s.n} students — prototype data, not real students.</p></div>
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

  function render() {
    let route = location.hash.replace(/^#/, "") || "/";
    if (!["/", "/login", "/profile", "/matches", "/admin"].includes(route)) route = "/";
    const need = GUARD[route];
    if (need && !state.user) { toast("Please sign in first"); route = "/login"; history.replaceState(null, "", "#/login"); }
    else if (need && state.user.role !== need) { route = state.user.role === "staff" ? "/admin" : "/matches"; history.replaceState(null, "", "#" + route); }
    else if (route === "/login" && state.user) { route = state.user.role === "staff" ? "/admin" : "/matches"; history.replaceState(null, "", "#" + route); }
    if (route === "/profile" && !state.profile) state.profile = blankProfile();

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
    $("#login-form").onsubmit = e => {
      e.preventDefault();
      const email = $("#email").value.trim().toLowerCase(), err = $("#email-err");
      const role = /^[^\s@]+@siswa\.um\.edu\.my$/.test(email) ? "student" : /^[^\s@]+@um\.edu\.my$/.test(email) ? "staff" : null;
      $("#email").setAttribute("aria-invalid", !role);
      if (!role) { err.textContent = "Please use your UM email (…@siswa.um.edu.my for students)."; return; }
      err.textContent = "";
      const returning = state.profile && state.user?.email === email;
      signIn({ email, role, profile: returning ? state.profile : null });
    };
    $$("[data-demo]").forEach(b => b.onclick = () => signIn(DEMO[b.dataset.demo]));
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

    form.onsubmit = e => {
      e.preventDefault();
      const p = readProfileForm(form), li = $("#li-err"), liInput = form.elements.linkedin;
      if (p.linkedin && !LINKEDIN_RE.test(p.linkedin)) { liInput.setAttribute("aria-invalid", "true"); li.textContent = "Use a link like https://www.linkedin.com/in/your-name"; liInput.focus(); return; }
      if (p.linkedin && !/^https?:\/\//i.test(p.linkedin)) p.linkedin = "https://" + p.linkedin;
      if (!p.name) { form.elements.name.focus(); toast("Please enter your name"); return; }
      state.profile = p; state.user.name = p.name; persist();
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
    on("#f-paid", "change", e => { mf.paid = e.target.checked; renderResults(); });
    on("#f-saved", "change", e => { mf.saved = e.target.checked; renderResults(); });
    on("#f-inel", "change", e => { mf.showIneligible = e.target.checked; renderResults(); });
    // restore filter UI after a re-render (e.g. after sync)
    $("#f-q").value = mf.q; $("#f-src").value = mf.src; $("#f-region").value = mf.region; $("#f-mode").value = mf.mode; $("#f-min").value = mf.min;
    $("#f-paid").checked = mf.paid; $("#f-saved").checked = mf.saved; if ($("#f-inel")) $("#f-inel").checked = mf.showIneligible;
    on("#sync-btn", "click", e => runSync(e.currentTarget));
    $("#results").addEventListener("click", e => {
      const a = e.target.closest("[data-apply]"), s = e.target.closest("[data-save]");
      if (a) {
        const id = +a.dataset.apply;
        if (!state.clicks.some(c => c.id === id)) { state.clicks.push({ id, t: Date.now() }); persist(); }
        setTimeout(() => { a.textContent = "Open again ↗"; }, 0);
      }
      if (s) {
        const id = +s.dataset.save, i = state.saved.indexOf(id);
        if (i >= 0) state.saved.splice(i, 1); else state.saved.push(id);
        persist(); const open = $$("details.why-match[open]").map(d => d.closest(".job").dataset.id);
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
  render();
})();

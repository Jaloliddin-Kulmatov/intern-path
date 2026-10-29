# Intern_Path — by ICOM (WIA2006, OCC 1M)

**Live:** [intern-path-lime.vercel.app](https://intern-path-lime.vercel.app) · **Code:** [github.com/Jaloliddin-Kulmatov/intern-path](https://github.com/Jaloliddin-Kulmatov/intern-path)

Internship matching website for FCSIT students in Malaysia — Malaysian and international.
Static front end (HTML/CSS/JS) + Supabase backend (Postgres, Google sign-in, scheduled scraper).

## Run it
- **Deployed / local server** (needed for Google sign-in): deploy on Vercel (below), or run any static server in this folder.
- **Double-click `index.html`**: works for the demo accounts only (Google sign-in needs `http(s)://`).

## Deploy on Vercel
Static site, no build step. Import the GitHub repo at vercel.com/new, set Framework Preset to **Other**, click Deploy.

## One-time setup: Google sign-in
Anyone with a Google account can sign up and becomes a **student**. `@um.edu.my` accounts (and emails in `allowed_emails`) become **staff** and get the reports page. Turn Google on:

1. **Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID** (type *Web application*).
   - Authorized redirect URI: `https://jakdndcmkmwasoxyakhj.supabase.co/auth/v1/callback`
   - (First time: configure the OAuth consent screen, scopes `email`, `profile`, `openid`.)
2. **Supabase dashboard → Authentication → Sign In / Providers → Google**: enable it and paste the Client ID and Client Secret.
3. **Supabase dashboard → Authentication → URL Configuration**:
   - Site URL: your Vercel URL, e.g. `https://intern-path-lime.vercel.app`
   - Redirect URLs: add `https://intern-path-lime.vercel.app/**` and `http://localhost:5173/**`
4. **Authentication → Sign In / Providers → Email**: switch **off** (Google is the only way in).

Staff domains live in the `allowed_domains` table; single emails go in `allowed_emails`, e.g. to give someone the reports page:
`insert into allowed_emails (email, role) values ('name@example.com', 'staff');`

Before sharing publicly, publish the Google OAuth consent screen (Google Cloud → OAuth consent screen → Publish app); in *Testing* mode only listed test users can sign in.

## What the backend does
| Piece | What it does |
|---|---|
| `profiles` | One row per signed-in user: skills, preferences, Malaysian/international, LinkedIn. Users can edit their own details, never their role or email. |
| `internships` | Open listings with `deadline`, `is_active`, `checked_at`, `closed_at`. Public read; only the scraper/admin can write. |
| `saved_internships`, `apply_clicks` | Per-user saved roles and "Apply" clicks. |
| `admin_students()` | Staff-only anonymised rows (no names/emails) that power the reports page. |
| Edge Function `scrape-internships` | Runs **twice a day** (08:00 and 20:00 Malaysia time) via `pg_cron` → `pg_net`. Reads `scrape_sources`, extracts schema.org `JobPosting` JSON-LD or RSS, upserts listings, honours `robots.txt`. |
| `expire_internships()` | Runs daily 00:10 Malaysia time. Listings are hidden at their deadline and **deleted 7 days later**. (They are also hidden instantly by the read policy, even before the job runs.) |

### Adding a scrape source
Only add pages whose terms allow automated access (employer career pages, official feeds). **LinkedIn forbids scraping**, and JobStreet/Indeed/Glints block bots, so they are not scraped.
```sql
insert into scrape_sources (name, kind, url, source_key)
values ('Example Sdn Bhd careers', 'jsonld', 'https://careers.example.com.my/internships', 'direct');
```
`kind` is `jsonld` (pages with `JobPosting` markup, which includes `validThrough` = the deadline) or `rss`.
Run history is in `scrape_runs`. To run immediately, call the function with the `x-cron-secret` header (value in `private_settings`).

## Demo accounts (Sign in page)
Aisyah (Malaysian), Timur (international) and Faculty staff. They run offline in your browser and write nothing to the database.

## Files
`index.html`, `styles.css`, `config.js` (public Supabase URL + publishable key), `data.js` (skills dictionary, reference lists, sample listings used as offline fallback), `app.js` (router, auth, matching, views), `vercel.json`.

## How matching works
`score = 65% skills (required; half weight for nice-to-have) + 15% field + 10% location + 10% language`.
International students never see Malaysian-citizen-only roles unless they tick the toggle.

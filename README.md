# Intern_Path — by ICOM (WIA2006, OCC 1M)

Internship matching website for FCSIT students in Malaysia — Malaysian and international.

## Run it
Double-click `index.html`. No install, no build step, no server.

## Deploy on Vercel
Static site, no build step. Import the GitHub repo at vercel.com/new, leave Framework Preset as **Other**, and click Deploy (`vercel.json` already sets this up).

## Demo accounts (Sign in page)
- **Aisyah** — Malaysian student
- **Timur** — International student (sees "open to international students" tags; Malaysian-only roles hidden by default)
- **Faculty staff** — usage and match reports

Or type any `@siswa.um.edu.my` (student) / `@um.edu.my` (staff) address. There is no password in this prototype.

## Files
| File | What it holds |
|---|---|
| `index.html` | Page shell |
| `styles.css` | Design tokens, light/dark theme, responsive layout |
| `data.js` | Skills dictionary, reference lists, 30 **sample** internship listings |
| `app.js` | Router, sign-in, profile + CV reading, matching engine, match list, staff reports |

## How matching works
`score = 65% skills (required, half-weight for nice-to-have) + 15% field + 10% location + 10% language`.
International students never see Malaysian-citizen-only roles unless they tick the toggle.

## What is real vs simulated
- Real: CV reading (PDF/TXT, in the browser), skill extraction, matching, filters, saved roles, CSV export.
- Simulated: the internship collection (sample listings; "Sync now" reveals 4 more), the 148-student cohort in staff reports, UM email verification.
- To make it production-ready, replace `JOBS` with a backend collecting from the job platforms' official feeds/APIs, and add real UM sign-in.

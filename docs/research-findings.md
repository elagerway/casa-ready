# CASA Ready — Research Findings

> Living document. Updated as we learn more.
> **Last updated:** 2026-04-29

## Project context

**CASA Ready** is an open-source toolkit to help developers pass Google's CASA Tier 2 security assessment without the consulting-firm tax. Born from a real, dated need: Snapsonic's `plug-473922` GCP project (the actual app is **[Magpipe](https://github.com/elagerway/magpipe)**) has a CASA Tier 2 deadline of **July 23, 2026**.

**Strategic frame:** build the tool we use to pass our own deadline; open source it as a byproduct. Every feature must be justified by something we actually hit.

### The dogfood app: Magpipe

**Open source repo:** [github.com/elagerway/magpipe](https://github.com/elagerway/magpipe) (public)
**Commercial product:** **[magpipe.ai](https://magpipe.ai)** — production SaaS

This is not a side project. Magpipe is a live commercial product with paying customers. The CASA Tier 2 deadline is a real revenue-protection deadline — if Gmail API access lapses on July 23, the inbox features (support tickets, send/receive) break for every paying customer. The "Omni-channel Open Agentic Communications Platform" Gmail integration is what triggered CASA.

**Implication for scope:** TAC will be scanning **magpipe.ai** (production). That means the OWASP ZAP DAST setup needs to either (a) hit a staging/replica with realistic auth or (b) be carefully scoped against prod with read-only auth. Either way, the V1 pre-scan kit needs to handle "scan a deployed SaaS" as the canonical use case, not "scan localhost."

Stack (verified from local `package.json` at `/Users/erik/Developer/Github/Snapsonic/magpipe/`):
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3, **Vite 5** — SPA, ESM module type
- **Edge host:** **Vercel** (`.vercel/` directory present; headers configured in `vercel.json`)
- **Backend:** **Supabase** — `@supabase/supabase-js` ^2.39, plus PostgreSQL, Auth, Realtime, Edge Functions (Deno/TS)
- **Voice agent:** Python on Render, using LiveKit (`livekit-client` ^2.15, `livekit-server-sdk` ^2.14, `jssip` ^3.10)
- **Auth tokens:** `jsonwebtoken` ^9.0
- **Email:** `postmark` ^4.0
- **Other integrations:** SignalWire, OpenAI, Deepgram, ElevenLabs, Stripe, **Gmail API** ← CASA trigger
- **Tests:** Vitest + Playwright (already wired up — V1 ZAP scan can plug into the existing E2E infra)
- **License:** MIT
- **Two local copies:**
  - `/Users/erik/Developer/Github/Snapsonic/magpipe/` — commercial production (actively edited, CHANGELOG to Apr 27)
  - `/Users/erik/Developer/Github/Snapsonic/magpipe-open/` — OSS mirror (last touched Mar 18, what's pushed to GitHub)

Existing security posture (per README):
- OAuth for Gmail
- Data encrypted in transit + at rest (Supabase default)
- RBAC
- Service role key separation for sensitive operations
- Access codes + phone verification

**Why this stack is well-positioned for CASA:**
- Supabase legitimately covers a *lot* of the SAQ — "my cloud provider handles that" applies to auth, encryption-at-rest, key management, DB hardening, audit logging. This is the same Reddit "cheat code" rem4ik4ever called out.
- DAST (OWASP ZAP) is the right scan choice — no source-code sharing needed, and Supabase Edge Functions are server-side anyway.
- Vanilla JS frontend means **no Next.js/Webpack-specific CSP headaches** — but also means we have to set security headers ourselves at the Vite/host layer (likely Cloudflare/Vercel edge).

**Likely V1 fixes for Magpipe specifically** (based on daniel.es's experience — also a Cloudflare-fronted app):
1. Strict-Transport-Security (HSTS) at the Cloudflare/Vercel edge
2. Content-Security-Policy header (tightest predictable pain point)
3. X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
4. Cookie flags: `Secure`, `HttpOnly`, `SameSite=Strict` on session cookies
5. CORS lockdown on Supabase Edge Functions
6. Rate limiting on public endpoints (likely already handled by Supabase, verify)

---

## What CASA is (in one paragraph)

CASA = **Cloud Application Security Assessment**. It's the security audit Google requires of any app that requests "restricted" Google API scopes (full Gmail read/send, Drive, Calendar, etc.). Run by the **App Defense Alliance** (now part of the Linux Foundation). Built on **OWASP ASVS 4.0**. Three tiers; **Tier 2** is what almost everyone hits — a lab-validated DAST/SAST scan plus a 50+ question Self-Assessment Questionnaire (SAQ). **Recurs annually.** Self-scan was deprecated in 2025 as a submission path but still works as a pre-flight check.

---

## The actual Google email (our case)

- **Project:** `plug-473922` (Snapsonic)
- **Notification date:** 2026-04-24
- **Deadline:** **2026-07-23** (~12 weeks)
- **From:** `api-oauth-dev-verification-reply+...@google.com`
- **Options offered (only two — self-scan no longer listed):**
  1. Tier 2 Authorized Lab Scan via TAC Security (Google's "preferred partner" with discounted rate) or any CASA-authorized lab
  2. Tier 3 (more comprehensive — for high-assurance use cases / Workspace Marketplace badge)

This is annual.

---

## Existing OSS landscape (no one has built this)

| Repo | Stars | Frameworks covered | CASA support? | Verdict |
|---|---|---|---|---|
| [appdefensealliance/ASA-WG](https://github.com/appdefensealliance/ASA-WG) | 86 | CASA, MASA, Cloud, AI | ✅ official spec | Specs only, zero tooling. v2.0.0 Apr 2026. CC-BY-SA-4.0. |
| [appdefensealliance-dev/ASA](https://github.com/appdefensealliance-dev/ASA) | — | Legacy CASA/MASA | ⚠️ archived July 2025 | Superseded by ASA-WG. |
| [trycompai/comp](https://github.com/trycompai/comp) (CompAI) | 1.5k | SOC 2, ISO 27001, HIPAA, GDPR | ❌ | TS/Next.js, AGPL. Vanta/Drata alternative. |
| [getprobo/probo](https://github.com/getprobo/probo) | 1.1k | SOC 2, GDPR, ISO 27001/27701/42001, HIPAA | ❌ | Go + TS, MIT. |
| [transilienceai/shasta](https://github.com/transilienceai/shasta) | 117 | SOC 2, ISO 27001, HIPAA, ISO 42001, EU AI Act | ❌ | Python, MIT. AWS/Azure infra checks. Explicitly says "does not address CASA or ASVS." |
| [Screenata/compliance-automation](https://github.com/Screenata/compliance-automation) | — | SOC 2, ISO 27001 | ❌ | Claude Code skill format. Closest in delivery shape to what we'd build. |
| [bmarsh9/gapps](https://github.com/bmarsh9/gapps) | 666 | SOC 2, ASVS, NIST CSF/800-53, CMMC, HIPAA, ISO 27001, CIS 18, PCI DSS, SSF | ⚠️ ASVS only | Flask/Postgres, modular JSON. Could host CASA via a JSON file but no scan/evidence automation. (Likely what user meant by "gkedge" — couldn't find anything by that name.) |

**Conclusion: there is no existing OSS that takes a developer from "Google sent me a CASA notification" to "I have a Letter of Validation."** Real, unfilled gap.

---

## Pricing — confirmed for 2026

[TAC Security](https://tacsecurity.com/esof-appsec-ada-casa-faqs/) is Google's preferred partner. Three plans, unchanged since 2023:

| Plan | Price | What you get |
|---|---|---|
| Basic | **$540** | Annual assessment + 2 revalidation cycles + LOV |
| Premium | **$720** | Same + **unlimited revalidation** ← Reddit consensus pick |
| Enterprise | **$1,800** | Unlimited + 1–2 week turnaround |

Big-firm quotes (Bishop Fox, NCC, Leviathan): **$15K–$40K** for Tier 2, **$7K+** for Tier 3.

The [$50K Email API Nightmare](https://medium.com/reversebits/the-50k-email-api-nightmare-why-your-simple-gmail-integration-just-became-a-compliance-hell-6071300b09b4) Medium piece claims $5K–$75K range, but the Reddit ground truth says that's only true if you go to the big firms. **TAC at $720 is the actual market price for indie devs.**

---

## Approved scanners

- **OWASP ZAP** — dynamic (DAST). Free, open source. Pre-configured by ADA with a CASA-mapped CWE policy file.
- **Fluid Attacks** — static (SAST). Open core, Docker-distributed.
- **Custom scanners** — accepted if you upload a policy specifying which CWEs you scanned for.
- **Fortify** — commercial; assessors apparently push it but it's not required.

[Tier 2 tooling matrix](https://appdefensealliance.dev/casa/tier-2/tooling-matrix)

---

## Reddit ground truth (r/googlecloud thread)

[Has anyone done the Gmail CASA Tier 2 assessment?](https://www.reddit.com/r/googlecloud/comments/18gbu2a/has_anyone_done_the_gmail_casa_tier_2_assessment/) — 89 comments, multiple full walkthroughs.

### Real timelines
- **rem4ik4ever (Next.js + Node/GraphQL):** 21 days total. First 7 days waiting for TAC support to send guides.
- **New-Reputation3663 (MERN):** ~1 month. 12 hours from LOV submission to OAuth warning removal.
- **vintagemako (10-yr-old mobile app):** **60–80 hours of work, 3–4 months calendar, 25–30 back-and-forth requests.** "Awful."
- **commonindianname (PwC route, before TAC):** 3 months, "painful."

### Real pain points (these are the product spec)

1. **TAC dumps you in a dashboard with zero instructions.** Multiple commenters: "no guide," "didn't want to mess it up." First week is just figuring out what to do.
2. **Fluid Attacks Docker setup is brutal.** vintagemako: *"god awful instructions provided by Google/app security alliance."* Used Fluid Attacks's own docs instead.
3. **Third-party library vulns force forking.** vintagemako had to fork upstream libs to patch flagged CWEs.
4. **The 50+ question SAQ is the real time sink.** rem4ik4ever: "took me the most time."
5. **Mobile devs get crushed by web-centric SAQ questions.** Assessors don't understand mobile, ask irrelevant web questions.
6. **Reviewers are outsourced and follow scripts.** vintagemako: *"It's a bunch of outsourced people trying to follow a script, they have no idea what they are doing."*
7. **Annual recert is the killer.** Multiple devs threatening to drop the permission rather than re-do it.
8. **CASA portal is PwC-owned** — explains the consulting-shop friction.

### "Cheat codes" the thread reveals (automate these)

- **DAST over SAST** if you don't want to share source code.
- **Pre-scan with OWASP ZAP yourself** before paying TAC.
- **"My cloud provider handles that"** answers half the SAQ (CI/CD, key management, DNS).
- **"Answer yes and move on"** for ambiguous SAQ items.
- **Don't aim for a perfect scan** — TAC accepts self-attestation on remaining items.
- **GraphQL backends auto-dodge** parameter injection / path traversal CWEs.
- **Buy the $720 Premium plan**, not the $540 basic.

### daniel.es write-up (referenced from thread)
[daniel.es CASA Tier 2 walkthrough](https://daniel.es/blog/publishing-your-google-cloud-project-app-get-the-casa-tier-2-certification/) — the cleanest public recipe.
- Used `owasp/zap2docker-stable` Docker container
- Config file: `zap-casa-api-config.conf`
- Output: `results-full.xml`
- Only fixes needed: **"setting a specific header and enabling HSTS in our Cloudflare certificates."**

**Killer insight:** a clean modern app with security headers + HSTS already configured may have nearly nothing to fix. Most of the 60–80 hours is *figuring out the process and SAQ*, not actually fixing code. **That's exactly what a tool can compress.**

---

## Self-scan deprecation status

- ADA docs: *"The CASA self scanning process is deprecated."*
- Same page: *"you can continue to use this process to check your application readiness for the lab verified CASA scan."*
- Our Google email confirms: self-scan is no longer offered as a submission option.

**Translation:** OWASP ZAP / Fluid Attacks workflow remains legal and valuable as a **pre-flight check** before paying TAC. This is exactly the wedge CASA Ready should occupy.

---

## Build recommendation

**Build it. Specifically build the narrow thing that doesn't exist.**

### V1 scope (must ship before 2026-07-23)

| Priority | Component | Justification |
|---|---|---|
| P0 | **OWASP ZAP pre-scan kit** — one Docker command, ADA-mapped config, outputs `.txt` artifacts the portal wants | We need this for our own scan. Closes the "god-awful instructions" gap. |
| P0 | **Top-20 CWE pre-fix library** for Magpipe's stack (Vite SPA + Supabase Edge Functions + Cloudflare/Vercel edge) — security headers, HSTS, CSP, secure cookies, CORS, rate limiting | Knocks daniel.es-level findings out before scanning |
| P0 | **SAQ Copilot** — drafts the 50+ questions from repo + GCP config, with "cloud provider handles that" / NA patterns built in | Single biggest time sink in the Reddit thread |
| P1 | **TAC dashboard playbook** (markdown + Claude Code skill) — the missing manual based on rem4ik4ever's 9-step list | We'll write this anyway as we go |
| P2 | Annual recert diff mode | Defer — we'll have our own data to design against next year |
| P2 | Mobile-app SAQ patterns | Defer — Plug is web; dogfood that first |

### Explicitly cut from V1

- Multi-framework support (SOC 2, ISO 27001) — that's Probo/Comp AI's lane
- Cloud infra scanning — that's Shasta's lane
- Web UI / dashboard — CLI + markdown reports are enough
- Tier 3 support — virtually nobody needs it

### License + positioning

- **MIT license** (not AGPL). This is a tool to bypass the consulting-firm tax, not a SaaS replacement. Maximum adoption beats source protection.
- **Lead with the SAQ Copilot** — it's the wedge. Scan plumbing is table stakes; AI-assisted SAQ is genuinely novel because LLMs make it tractable now (didn't exist when the Reddit thread was written).
- **Founding case study:** "Built this while passing CASA for Snapsonic / Plug."

---

## Deferred V1 follow-ups (don't lose these)

The ZAP pre-scan kit is being built in tiers. V1 picks the cheapest, fastest target; B and C are explicitly deferred but *not* dropped.

### V1 (in design)
**Single-origin scan of `magpipe.ai`** — anonymous crawl, security headers / CSP / cookie / HSTS focus. Catches the daniel.es-class issues (~80% of Reddit-reported failure modes). Ships in days.

### V1.1 (deferred — track in tasks)
**Add Supabase Edge Functions as a second scan target** — broadens coverage to the actual API surface. Needs: a manifest of public Edge Function URLs and a separate ZAP config tuned for JSON APIs vs. HTML. **Trigger to start:** V1 scan kit produces clean output for magpipe.ai AND we have the Edge Function URL manifest.

### V2 (deferred — track in tasks)
**Authenticated ZAP scan with session replay + OAuth flows** — full coverage including the Gmail-OAuth'd user paths. Needs: ZAP context with login, session handling, OAuth scope gating, destructive-endpoint protection. **Trigger to start:** V1 + V1.1 shipped AND TAC's actual findings show we're missing coverage anonymous scans can't catch.

> These are tracked as `pending` tasks (#13, #14) so they appear in every future session's task list, and surfaced in `README.md` roadmap.

## Open questions

- [x] ~~What stack is Plug?~~ → **Magpipe: Vite SPA + Supabase Edge Functions (Deno/TS) + Python LiveKit agent.** Cloudflare/Vercel edge likely.
- [x] ~~Where is Magpipe hosted at the edge?~~ → **Vercel** (confirmed via `.vercel/` directory). Headers go in `vercel.json`.
- [x] ~~Is the OSS mirror being kept in sync?~~ → **Decision: lock down commercial Magpipe first (it's what TAC scans), sync `magpipe-open` after LOV is in hand.** Avoids dual-tracking security work under deadline pressure.
- [ ] Should we contact TAC now ($720 Premium) to start the clock, or wait until V1 of CASA Ready is usable for pre-scan? **Recommendation: pre-scan first (~2 weeks), then contact TAC, target LOV by ~July 1.**
- [ ] Talk to the App Defense Alliance / Linux Foundation about partnership? They have an interest in indie devs not abandoning Google APIs.
- [ ] Naming: "CASA Ready" reads well — keep it?
- [ ] Repo location: separate `casa-ready` repo on `elagerway/` or `snapsonic/`? Or live as a subdirectory inside Magpipe initially?

---

## Sources

### Official
- [App Defense Alliance ASA-WG (official spec, v2.0.0)](https://github.com/appdefensealliance/ASA-WG)
- [CASA Tier 2 overview](https://appdefensealliance.dev/casa/tier-2/tier2-overview)
- [CASA Tier 2 tooling matrix](https://appdefensealliance.dev/casa/tier-2/tooling-matrix)
- [CASA Application Scanning Guide](https://appdefensealliance.dev/casa/tier-2/ast-guide)

### Vendor
- [TAC Security CASA FAQs](https://tacsecurity.com/esof-appsec-ada-casa-faqs/)
- [TAC Security CASA portal](https://casa.tacsecurity.com/site/home)

### OSS comparables
- [appdefensealliance/ASA-WG](https://github.com/appdefensealliance/ASA-WG)
- [trycompai/comp](https://github.com/trycompai/comp)
- [getprobo/probo](https://github.com/getprobo/probo)
- [transilienceai/shasta](https://github.com/transilienceai/shasta)
- [Screenata/compliance-automation](https://github.com/Screenata/compliance-automation)
- [bmarsh9/gapps](https://github.com/bmarsh9/gapps)
- [getprobo/awesome-compliance](https://github.com/getprobo/awesome-compliance)

### Practitioner reports
- [Reddit r/googlecloud: Has anyone done the Gmail CASA Tier 2 assessment?](https://www.reddit.com/r/googlecloud/comments/18gbu2a/has_anyone_done_the_gmail_casa_tier_2_assessment/)
- [daniel.es CASA Tier 2 walkthrough](https://daniel.es/blog/publishing-your-google-cloud-project-app-get-the-casa-tier-2-certification/)
- [DEV: rem4ik4ever — My SaaS passed CASA Tier 2](https://dev.to/rem4ik4ever/my-saas-passed-casa-tier-2-assessment-and-yours-can-to-here-is-how-1b20)
- [Truto: Our Google OAuth app is CASA Tier 2 certified](https://truto.one/blog/our-google-oauth-app-is-live-and-casa-tier-2-certified)
- [Cyberduck CASA issue #16192](https://github.com/iterate-ch/cyberduck/issues/16192)
- [Latenode community: indie dev CASA discussion](https://community.latenode.com/t/is-casa-tier-2-assessment-necessary-for-all-gmail-api-apps-options-for-indie-developers/22861)

### Analysis
- [Medium: The $50K Email API Nightmare](https://medium.com/reversebits/the-50k-email-api-nightmare-why-your-simple-gmail-integration-just-became-a-compliance-hell-6071300b09b4)
- [SwitchLabs: CASA providers and pricing](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option)
- [deepstrike: Google CASA assessment overview](https://deepstrike.io/blog/google-casa-security-assessment-2025)

---

## Changelog

- **2026-04-29** — Initial document. Captures: existing OSS landscape, TAC pricing confirmation, Reddit thread synthesis, Google notification details, V1 scope recommendation.
- **2026-04-29** — Added Magpipe stack details (Vite SPA + Supabase + Python/LiveKit). Refined V1 CWE pre-fix scope. Updated open questions.
- **2026-04-29** — Clarified Magpipe is a live commercial product at magpipe.ai with paying customers. Real revenue-protection deadline. V1 must handle "scan a deployed SaaS" as canonical use case.
- **2026-04-29** — Inspected local Magpipe repo. Confirmed: Vite 5 + Vanilla JS, Vercel edge, Supabase, Vitest+Playwright already wired (ZAP can integrate), MIT license. Two local copies: `magpipe/` (commercial, current) and `magpipe-open/` (OSS mirror, March snapshot).
- **2026-04-29** — Decision: harden commercial Magpipe first to pass CASA, sync OSS mirror afterward. CASA Ready development tracks the commercial repo as the dogfood target.
- **2026-04-29** — Positioning decided: OSS-first, MIT, free toolkit. No hosted product at launch. Optional managed-recert SaaS is a *later* layer if real demand emerges.
- **2026-04-29** — Repo scaffolded: `README.md`, `LICENSE` (MIT), `package.json` (Node CLI, `bin: casa-ready`), `.gitignore`, `bin/`, `cli/commands/`, `configs/zap/`. Implementation deferred to Superpowers-guided workflow.
- **2026-04-29** — Adopted [obra/superpowers](https://github.com/obra/superpowers) as the development methodology for CASA Ready (brainstorm → design → plan → implement → review). Install via `/plugin install superpowers@claude-plugins-official`.
- **2026-04-29** — Brainstorming V1 piece selection: chose `casa-ready scan <url>` as the first build target. ZAP-on-magpipe.ai (option A) for V1; Supabase Edge Function endpoints (B) deferred to V1.1; authenticated scan with OAuth flows (C) deferred to V2. Both deferrals tracked as pending tasks + in README roadmap.

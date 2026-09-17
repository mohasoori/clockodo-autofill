# Releasing — fully automated

Pushing a version tag does everything: GitHub release with the zip, and
upload + publish to the Chrome Web Store. No manual uploads.

```bash
# 1. bump manifest.json "version", add a CHANGELOG.md section, update the
#    three data-version fallbacks in src/help/help.html, regenerate the PDF
# 2. commit to main
git tag -a v1.4.0 -m "Clockodo Auto-Fill 1.4.0"
git push origin main v1.4.0
# 3. watch: https://github.com/mohasoori/clockodo-autofill/actions
```

The workflow (`.github/workflows/release.yml`) then:

1. **Checks the tag matches `manifest.json`** — `v1.4.0` must equal `"version": "1.4.0"`, otherwise it fails fast.
2. **Builds `clockodo-autofill.zip`** (`manifest.json`, `src/`, `assets/`, `docs/`, `README.md`, `LICENSE`, `CHANGELOG.md`).
3. **Creates the GitHub release** with the matching `CHANGELOG.md` section as notes and the zip attached.
4. **Uploads to the Chrome Web Store and publishes** via `chrome-webstore-upload-cli` — only if the `CWS_*` secrets exist; otherwise that step is skipped with a notice.

Google then reviews the update (usually hours, up to a few days) and every
store install updates automatically. Manual zip installs see the in-app
"update available" banner.

---

## One-time setup (already done for this repo — documented for rebuilds)

### 1. Google Cloud project with the Chrome Web Store API

1. <https://console.cloud.google.com> → new project (e.g. *Clockodo Auto-Fill*).
2. **APIs & Services → Library** → search *Chrome Web Store API* → **Enable**.

### 2. OAuth consent screen (Google Auth Platform)

1. **Branding**
   - App name, user support email, developer contact email.
   - **Application home page** and **privacy policy link** are required to
     go to production — we use the GitHub repo URL and
     `docs/PRIVACY.md`. Add `github.com` under **Authorized domains**
     (URLs on a non-authorised domain are rejected).
   - **Do not upload a logo.** A logo forces Google's brand verification;
     without it none is needed for our non-sensitive scope.
2. **Data Access → Add or remove scopes** → tick
   `https://www.googleapis.com/auth/chromewebstore` (the **full** scope —
   the `.readonly` variant cannot upload) → Save.
3. **Audience**
   - User type **External**.
   - Add the publisher Google account under **Test users**.
   - Click **Publish app** → status **In production**. This matters:
     while the app is in *Testing*, refresh tokens expire after **7 days**;
     in production they live until revoked or unused for 6 months.
   - Ignore the yellow "your app requires verification" banner — it only
     removes the "unverified app" interstitial that the publisher alone sees.

### 3. OAuth client

**Clients → Create client → Desktop app.** Copy the Client ID and Client
secret (only into GitHub Secrets — never into the repo).

### 4. Refresh token

On your machine (Node ≥ 18):

```powershell
npx chrome-webstore-upload-keys
```

Enter the client id/secret, sign in with the publisher account, click
*Advanced → Go to … (unsafe)* on the unverified-app screen, allow. The tool
prints the refresh token. Tokens issued while the app was still in *Testing*
keep their 7-day expiry — mint a new one after switching to production.

### 5. GitHub repository secrets

**Settings → Secrets and variables → Actions:**

| Secret              | Value                                             |
|---------------------|---------------------------------------------------|
| `CWS_CLIENT_ID`     | OAuth client id                                   |
| `CWS_CLIENT_SECRET` | OAuth client secret                               |
| `CWS_REFRESH_TOKEN` | from step 4                                       |
| `CWS_EXTENSION_ID`  | `igjjblageocnhjonnhbgkldoojdijppp` (store item id) |

Secrets are encrypted, never appear in the repo, and are masked (`***`) in
logs. The workflow reads them into job-level `env`, because GitHub does not
allow the `secrets` context inside a step `if:`.

### 6. Verify without releasing

**Actions → Check Web Store credentials → Run workflow**
(`.github/workflows/cws-check.yml`). It exchanges the refresh token for an
access token and reads the item's draft state. `Token OK` = the pipeline
will work. `uploadState: NOT_FOUND` just means no draft is waiting (e.g. the
last upload is already in review) — not an error.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Run fails instantly, "workflow file issue" | YAML problem. `secrets.*` is not allowed in a step `if:` — go through job `env`. |
| `Tag v1.4.0 does not match manifest version` | Bump `manifest.json` first, commit, then tag. To move a tag: `git tag -d vX && git push origin :refs/tags/vX`, re-tag, push. |
| `invalid_grant` on token exchange | Refresh token expired (app was in *Testing*) or revoked. Ensure Audience shows *In production*, run `npx chrome-webstore-upload-keys`, update `CWS_REFRESH_TOKEN`. |
| Store upload `403` / insufficient scope | Wrong scope on the consent screen (`.readonly`). Add the full `chromewebstore` scope and mint a new token. |
| `The description field in manifest is too long` | Store limit is 132 characters for `manifest.json` → `description`. |
| Store dashboard still shows old version | The upload landed in **Draft / Pending review**; the *Published* column updates after Google approves. Uploading again while pending restarts the review. |
| Push rejected `GH007 … private email` | Commit with the GitHub noreply address: `git config user.email "<id>+<user>@users.noreply.github.com"`. |

## Store listing assets are not automated

The Web Store API only accepts the package. Screenshots, promo tiles and the
listing text live in the Developer Dashboard and **do not change when a new
version is uploaded**. After a visible UI change:

1. Regenerate `docs/store/screenshot-help-1280x800.png` (Edge headless, see
   `DEVELOPER.md`) and re-capture the popup/timetable shots from the
   installed extension (anonymise names).
2. Dashboard → item → **Store listing → Screenshots** → replace → **Save
   draft** → **Submit for review** (listing-only changes are reviewed quickly).

## Manual fallback

`pwsh scripts/build-zip.ps1` builds the zip locally; upload it in the
Developer Dashboard → item → **Package → Upload new package → Submit for
review**, and attach it to a GitHub release with
`gh release create vX.Y.Z clockodo-autofill.zip --title X.Y.Z --notes-file notes.md`.

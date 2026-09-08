# Project submission service

The Project Hub opens a bilingual contribution dialog and sends validated project details to this Cloudflare Worker. The Worker verifies a Turnstile challenge, signs in as a GitHub App, appends one entry to `projects.yaml` on a submission branch, and opens a pull request for maintainer review. Visitors can submit without a GitHub account. The author field is contributor-provided attribution.

## Local preview

Prerequisites: Node.js 22 or newer, npm, Python 3, and internet access for the site's YAML parser and remote images. Run commands from the repository root.

```sh
npm ci
npm test
npm run check:worker
```

Start the frontend and API in separate terminals:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

```sh
npm run dev:api
```

Open <http://127.0.0.1:8000/docs/> and select **Contribute Project**. The local page automatically connects to port 8787 when `docs/submission-config.json` has an empty `apiBaseUrl`. Both servers stay running until **Ctrl+C** is pressed in their terminals.

An unconfigured service returns `ready: false`. The dialog remains available for entering a draft and displays its connection status. Closing and reopening the dialog, or changing the page language, preserves fields during the current page session. Reloading the page clears the draft.

## Service configuration

1. Register a GitHub App with repository **Contents: Read and write** and **Pull requests: Read and write** permissions. Install it for the target repository. This service uses installation authentication; webhook delivery and visitor OAuth are unnecessary. Record its Client ID and installation ID, and generate a private key. See [GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).
2. Create a managed Turnstile widget for the frontend hostname. For production this is `seeed-studio.github.io`; use a separate widget allowing `localhost` and `127.0.0.1` for local integration testing. Copy its public site key into the corresponding `TURNSTILE_SITE_KEY` setting in `wrangler.jsonc`.
3. Set `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_BASE_BRANCH` to the installation's repository. `ALLOWED_ORIGINS` lists exact frontend origins including scheme and port, separated by commas. `TURNSTILE_HOSTNAMES` lists matching hostnames. The top-level settings are production; `env.local.vars` configures local development.
4. Create `worker/.env.local` from [.env.example](.env.example), then fill the four values using a local editor. Store the full PEM private key as a quoted multiline value. These files and private-key files are ignored by Git. Wrangler loads environment-specific `.env` files alongside its configuration; see [local environment variables](https://developers.cloudflare.com/workers/local-development/environment-variables/).

```sh
cp worker/.env.example worker/.env.local
```

Local configuration needs `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY`, and `TURNSTILE_SECRET`. Use a dedicated test repository for live integration tests, with a valid `projects.yaml` file and the GitHub App installed. Each accepted submission creates a real branch and PR in the configured repository.

## Production deployment

Use the intended Cloudflare account, set its `account_id` in `wrangler.jsonc`, and deploy the Worker:

```sh
npx wrangler login
npm run deploy:api
```

Add credentials through the Cloudflare dashboard's Worker **Settings → Variables and Secrets**, or use Wrangler's interactive secret prompts:

```sh
npx wrangler secret put GITHUB_APP_CLIENT_ID --config worker/wrangler.jsonc --env=""
npx wrangler secret put GITHUB_APP_INSTALLATION_ID --config worker/wrangler.jsonc --env=""
npx wrangler secret put GITHUB_APP_PRIVATE_KEY --config worker/wrangler.jsonc --env=""
npx wrangler secret put TURNSTILE_SECRET --config worker/wrangler.jsonc --env=""
```

Set `apiBaseUrl` in `docs/submission-config.json` to the HTTPS Worker URL printed by deployment, then publish the static `docs/` site through the repository's Pages workflow. Readiness requires all configured values; an actual submission verifies that the credentials and installation permissions work.

The GitHub App creates `project-submissions/<link-hash>` branches in the selected repository. Review and merge the resulting PR to publish the project. GitHub repository rules must allow this App to create submission branches and commits.

## Fields and storage

| Form field | Catalog field | Validation |
| --- | --- | --- |
| Project name | `name.en`, `name.zh` | 2–160 characters per supplied language |
| Author | `author.en`, `author.zh` | At least one language, 2–120 characters per supplied language |
| Description | `description.en`, `description.zh` | 20–3,000 characters per supplied language |
| Project link | `link` | Public HTTPS URL |
| Category | `category` | Listed category |
| Boards | `board` | One or more listed boards, stored comma-separated |
| Source | `author_type` | Listed source or a 2–40 character custom name |
| Image link | `image` | Optional public HTTPS URL |
| Release date | `release_date`, `year`, `month` | Valid date from 1970 through today in UTC |

Boards are selected in a grouped multi-select dropdown. Checked models appear as removable chips beneath the collapsed field. Selecting a checkbox keeps the list open; clicking outside or pressing Escape closes it. Press Arrow Down on the trigger to open the list and focus a checkbox, then use Tab and Space to navigate and select.

The `BOARD_GROUPS` list in `docs/submission-schema.mjs` organizes form choices into ESP32, Nordic, Raspberry Pi, Microchip, Renesas, and Silicon Labs sections. Each section keeps chip families together and places standard models before their Sense and Plus variants. The shared `BOARDS` validation list is derived from these groups. As of September 8, 2026, it contains 22 models, including the five [XIAO Plus variants](https://www.seeedstudio.com/blog/2025/01/02/seeed-studio-xiao-plus-more-castellation-ios-for-smd-soldering/) and the nRF54L15 / nRF54LM20A standard and Sense versions in the [official XIAO overview](https://wiki.seeedstudio.com/SeeedStudio_XIAO_Series_Introduction/).

The form displays separate English and Chinese sections. Contributors may provide either language or both; each supplied language includes a complete project name and description. Author attribution requires at least one language. Submitted text is stored as `{ en, zh }` objects containing only the supplied translations. The hub displays the selected language when available and uses the supplied language when a translation is absent. Interface language changes preserve both sections. PR titles use the English project name when supplied, otherwise the Chinese name. Images remain externally hosted; the form collects a direct image URL. Image priority and date sorting apply when the merged project appears in the hub.

## Request flow and functions

1. `initSubmissionForm({ getLanguage, getCategoryLabel })` in `docs/submission.mjs` creates the dialog and returns a language-update handler. It retains the current draft and displays field errors, connection status, and the returned PR link.
2. `validateSubmission(input)` in `docs/submission-schema.mjs` receives form values and returns normalized `data`, field `errors`, and a `valid` flag. The browser and Worker share it. Text fields arrive as language-keyed objects, and error keys such as `nameEn` and `descriptionZh` identify the exact input. `toProjectEntry(data)` maps validated fields to a catalog object while retaining each translation.
3. `handleRequest(request, env)` in `index.mjs` receives HTTP requests and returns JSON responses. It checks the origin, the 32 KiB request limit, the rate limit, and fields before processing a submission. `GET /api/config` returns public readiness information; `POST /api/submissions` accepts form fields plus `turnstileToken`.
4. `verifyChallenge(token, request, env)` checks the Turnstile token, action, and hostname. `installationToken(env)` exchanges a signed GitHub App JWT for a repository-scoped installation token.
5. `createSubmission(data, env, api)` returns `{ status, number, url }`. It checks existing projects and PRs, creates a branch, appends the catalog entry, and creates a PR. `appendProject(text, entry)` returns validated YAML while preserving existing catalog text.

Successful new submissions return HTTP 201 with `status: "created"`; repeated submissions with an existing PR return HTTP 200 with `status: "existing"`. The dialog reports success only after receiving a valid GitHub PR URL for the configured repository.

## Verification

`npm test` runs isolated tests using simulated GitHub and Turnstile responses, including valid submissions, malformed fields and dates, YAML escaping, empty catalogs, retries, concurrent writes, duplicate PRs, origin restrictions, request limits, JWT signatures, and sanitized upstream failures. `npm run check:worker` bundles the real Worker without deploying it.

Browser checks:

1. Open the dialog and fill different names, descriptions, and author names in the English and Chinese sections. Close it, change the page language, and reopen it. Both sets of values remain and labels change language.
2. Choose **Other** for source. The custom platform field appears. Open the board dropdown, select multiple boards across groups, and confirm all selections remain after reopening. Remove an individual chip and verify its checkbox clears. Remove the final chip and confirm the empty selection prompt returns.
3. At a 390 px viewport width, confirm the two language sections stack vertically, fields fit without horizontal scrolling, and all actions are reachable by scrolling.
4. With an unconfigured service, confirm the connection message and disabled submit button. Retrying the connection preserves entered fields.

After connecting a test repository and a real Turnstile widget:

1. Enter a complete, unique project in both languages, finish verification, and submit. Expect one branch, one YAML entry with separate `en` and `zh` values, and a working PR link. Repeat using a different project with only Chinese filled, then another with only English filled; expect the supplied language to be preserved in each PR.
2. Submit the same project link again. Expect the existing PR link. Repeat with a tracking parameter or fragment on the URL; expect the same PR.
3. Leave both translations blank, supply a translated name without its description, exceed a text limit, select a future date, or use an invalid image URL. Expect inline errors for the affected language or field and no PR. Leave the optional image blank; a valid submission should succeed.
4. Submit a link already present in the base catalog. Expect an already-published message. Disconnect the network during submission, reconnect, and retry; fields remain and the request recovers an existing PR or finishes creating it.
5. Make more than five submissions per minute from one IP. Expect HTTP 429 and a retry-later message. The per-location Cloudflare rate limit reduces bursts; it is not a global submission quota.

Live PR creation requires deployment credentials and a completed challenge. Unit tests and bundle checks verify the implementation independently of those credentials.

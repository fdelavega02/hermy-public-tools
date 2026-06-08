# LinkedIn Local Posting Starter

This is a local-only starter for Francisco's LinkedIn posting workflow:

1. Sign in manually in a real local browser window once.
2. Reuse the locally saved browser session.
3. Open the LinkedIn composer locally.
4. Paste/type the approved draft automatically.
5. Only post when the script is run with explicit confirmation.

## Security constraints

- Do not paste or store your LinkedIn password in chat, terminal prompts, config files, or scripts.
- Use `npm run auth` for a one-time manual browser login on this machine only.
- Browser storage/session state is saved locally in `state/` only.
- This starter defaults to a dry-run compose-open mode unless you explicitly pass `--post-now`.

## Files

- `package.json` - scripts and dependency declaration
- `config.example.json` - local config template
- `auth.mjs` - manual LinkedIn Web login that saves local browser state
- `post.mjs` - opens the composer, inserts post text, and optionally publishes it

## Setup

1. Use Node.js 18+.
2. Change into this project:

```bash
cd social/linkedin-local
```

3. Install dependencies:

```bash
npm install
```

4. Copy the example config:

```bash
cp config.example.json config.json
```

5. If LinkedIn's UI differs for your account later, adjust selectors in `config.json`.

## Manual login

Run:

```bash
npm run auth
```

That opens a real Chromium window locally. Sign in there, complete MFA there, wait until your LinkedIn feed is visible, then return to the terminal and press Enter to save local session state.

If the saved session expires later, rerun `npm run auth`.

## Dry-run compose test

To verify the posting flow without publishing anything:

```bash
npm run open-compose -- --text "Test draft from local automation"
```

That will open the composer, insert the text, and stop without clicking Post.

## Publish an approved draft

From a text file:

```bash
npm run post -- --post-now --text-file ./output/today-linkedin-post.txt
```

Or inline:

```bash
npm run post -- --post-now --text "Today I learned..."
```

The script will still show a final terminal confirmation prompt before publishing.

## Autonomous approved posting

When Francisco has already approved the exact draft and timing ahead of time, use:

```bash
npm run post-approved -- --text-file ./output/today-linkedin-post.txt
```

That mode:

- runs headless (no visible browser required)
- skips the terminal `POST` prompt
- still reuses the locally saved LinkedIn session from `state/storage-state.json`
- saves screenshots to `output/` for review/debugging
- can be launched through `./run-approved-post.sh --text-file ./output/today-linkedin-post.txt` for cron/scheduler use

Important constraints:

- The machine and OpenClaw still need to be running at post time.
- LinkedIn may still interrupt with expired login, challenge, CAPTCHA, or UI changes.
- Only use this mode for a draft that was explicitly approved in advance.
- If the browser hangs or screenshot capture fails after clicking Post, verify the post through recent activity before declaring failure or success.

## Notes

- LinkedIn may change selectors and require small updates later.
- A saved browser session can expire and need a fresh manual login.
- The agent environment here often lacks a desktop display, so the actual `auth`/`post` run usually needs to happen in your normal local desktop session.
- Keep actual posting gated behind your approval. This starter is built for that.

# Pattern: approval-gated posting

Use this pattern when a local script can publish something publicly, such as a LinkedIn post.

## Shape

1. Generate or collect the draft locally.
2. Save the exact text to a file.
3. Ask Francisco for approval or edits.
4. Only publish when the exact draft is approved.
5. Keep a screenshot or log after the publish attempt.

## Script modes

Recommended modes:

- `auth`: open a local browser so the user can sign in manually.
- `open-compose`: insert text but do not publish.
- `post`: publish only after an interactive confirmation.
- `post-approved`: publish a pre-approved exact draft without another prompt, for scheduled or headless use.

## Safety rules

- Never store passwords in scripts, config, or chat.
- Keep browser state under ignored `state/`.
- Keep generated post files and screenshots under ignored `output/`.
- Do not use autonomous publishing for drafts that were not explicitly approved.
- After any publish click, verify the public result independently before reporting success. A browser screenshot or protocol error after the click may mean verification failed, not that publishing failed.
- If browser automation hangs after the publish action, stop the stuck browser process and confirm the result through the site's normal activity or profile view.

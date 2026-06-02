# Pattern: local browser session

Use this pattern when automation needs a signed-in website but should not handle passwords directly.

## Shape

1. `auth` opens a real local browser.
2. Francisco signs in manually and completes any MFA.
3. The script saves browser storage state locally under ignored `state/`.
4. Later scripts reuse that state to perform approved local actions.

## Benefits

- Passwords never enter the script.
- MFA stays human-controlled.
- Session files stay local and ignored.
- If the website changes or challenges the login, the workflow fails locally instead of leaking state elsewhere.

## Caution

Browser automation is brittle. Selectors can change, sessions expire, and websites may add CAPTCHA or challenge screens. Treat screenshots and logs as debugging aids, not public artifacts.

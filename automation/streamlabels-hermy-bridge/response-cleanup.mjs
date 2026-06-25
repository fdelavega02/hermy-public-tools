export function cleanHermyResponse(text) {
  let cleaned = String(text ?? '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

const GAMBLING_RE = /\b(gambling?|wager(?:ing)?|parlays?|odds|sportsbook|casino|polymarket|draftkings|fanduel|moneyline|over\/under|point spread)\b/i;
const BETTING_RE = /\b(?:bet(?:ting)?\s+(?:on|all|my|the|\$|\d)|what\s+do\s+i\s+bet|who\s+do\s+i\s+bet|where\s+do\s+i\s+bet)\b/i;
const GAMBLING_DISCLAIMER_RE = /\b(?:this\s+isn['’]t\s+actual\s+advice|not\s+actual\s+advice)\b/i;
const TRAILING_GAMBLING_DISCLAIMER_RE = /\s*\(?\b(?:this\s+isn['’]t\s+actual\s+advice|not\s+actual\s+advice)\b\)?[.!?]*\s*$/i;
const GAMBLING_DISCLAIMER = "(this isn't actual advice)";

export function isGamblingText(text) {
  const value = String(text ?? '');
  return GAMBLING_RE.test(value) || BETTING_RE.test(value);
}

export function appendGamblingDisclaimer(response, ...contexts) {
  const text = String(response ?? '').trim();
  if (!text) return text;
  if (!contexts.some(isGamblingText)) return text;
  if (text.endsWith(GAMBLING_DISCLAIMER)) return text;
  const normalized = GAMBLING_DISCLAIMER_RE.test(text)
    ? text.replace(TRAILING_GAMBLING_DISCLAIMER_RE, '').trim()
    : text;
  return `${normalized} ${GAMBLING_DISCLAIMER}`;
}

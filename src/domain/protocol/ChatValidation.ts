/** Authoritative validation for TCP, Web API and room-message broadcasting. */
export const MAX_CHAT_LENGTH = 2048;
const DISALLOWED_CHAT_TEXT = /[<>\p{Cc}\p{Cs}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/** Single-line plain text. Length is measured in UTF-16 code units, as in the existing protocol. */
export function isValidChatContent(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_CHAT_LENGTH &&
    !DISALLOWED_CHAT_TEXT.test(value)
  );
}

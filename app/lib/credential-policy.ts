export const USERNAME_PATTERN = "[A-Za-z0-9_.-]{3,30}";
export const ASCII_PASSWORD_PATTERN = "[\\x20-\\x7E]{8,}";

const USERNAME_CHARACTERS = /[^a-zA-Z0-9_.-]/g;
const NON_ASCII_PRINTABLE_CHARACTERS = /[^\x20-\x7E]/g;
const ASCII_PASSWORD = /^[\x20-\x7E]+$/;

export function sanitizeUsername(value: string) {
  return value.replace(USERNAME_CHARACTERS, "");
}

export function sanitizeAsciiPassword(value: string) {
  return value.replace(NON_ASCII_PRINTABLE_CHARACTERS, "");
}

export function isAsciiPassword(value: string) {
  return ASCII_PASSWORD.test(value);
}

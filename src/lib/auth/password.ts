import bcrypt from "bcryptjs";

const ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** Returns a human-readable problem, or null when the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Use at most 200 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Include at least one letter and one number.";
  return null;
}

/** Readable temporary password for new accounts and resets, e.g. "Kite-7042-Ramp". */
export function temporaryPassword() {
  const words = ["Atlas", "Brook", "Cedar", "Delta", "Ember", "Flint", "Grove", "Harbor", "Kite", "Lumen", "Mesa", "Nova", "Onyx", "Pine", "Quill", "Ramp", "Ridge", "Slate", "Tide", "Vale"];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${pick()}-${digits}-${pick()}`;
}

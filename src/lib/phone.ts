/**
 * U.S. (NANP) phone format check. Per the requirements this validates format only;
 * it does not check whether a number is active or reachable.
 *
 * Accepts common spellings: (214) 555-0182, 214.555.0182, +1 214 555 0182,
 * 1-214-555-0182, 2145550182, with an optional extension ("x12", "ext. 12").
 */
export type UsPhone = { e164: string; display: string; extension: string | null };

const EXTENSION = /\s*(?:#|x|ext\.?|extension)\s*(\d{1,6})\s*$/i;

export function parseUsPhone(input: string | null | undefined): UsPhone | null {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;

  let extension: string | null = null;
  const ext = raw.match(EXTENSION);
  if (ext) {
    extension = ext[1];
    raw = raw.slice(0, ext.index);
  }

  // only digits, spaces and common separators are allowed in the number itself
  if (!/^[+\d\s().\-/]+$/.test(raw)) return null;

  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;

  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  // NANP: area code and exchange cannot start with 0 or 1; N11 area codes are service codes
  if (/^[01]/.test(area) || /^[01]/.test(exchange) || /^\d11$/.test(area)) return null;

  return {
    e164: `+1${digits}`,
    display: `(${area}) ${exchange}-${digits.slice(6)}`,
    extension,
  };
}

export function formatPhone(e164OrRaw: string | null | undefined) {
  const parsed = parseUsPhone(e164OrRaw);
  return parsed ? parsed.display : (e164OrRaw ?? "");
}

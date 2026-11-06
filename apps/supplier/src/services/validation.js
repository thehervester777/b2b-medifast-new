export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());

/** Bangladeshi mobile: 01XXXXXXXXX, with or without +88. */
export const isBdPhone = (v) => /^(\+?88)?01[3-9]\d{8}$/.test(String(v).replace(/[\s-]/g, ''));

export const PASSWORD_HINTS = ['Use 8 or more characters', 'Weak. Add more characters.', 'Fair. Mix upper and lower case.', 'Good. Add a number or symbol.', 'Strong password'];

/** 0 (empty) to 4 (strong). */
export function passwordLevel(p) {
  if (!p) return 0;
  let score = 0;
  if (p.length >= 8) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p) || p.length >= 12) score++;
  return Math.max(1, score);
}

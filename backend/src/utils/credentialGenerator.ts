import { randomInt } from 'crypto';

export const generateAdminId = (): string => {
  const digits = randomInt(100000, 999999);
  return `DIN${digits}`;
};

export const generatePassword = (): string => {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower   = 'abcdefghijklmnopqrstuvwxyz';
  const digits  = '0123456789';
  const special = '@#$!%*?&';
  const all     = upper + lower + digits + special;

  const pick = (chars: string) => chars[randomInt(chars.length)];

  const required = [pick(upper), pick(lower), pick(digits), pick(special)];
  const extra    = Array.from({ length: 4 }, () => pick(all));
  const combined = [...required, ...extra];

  // Fisher-Yates shuffle using crypto.randomInt
  for (let i = combined.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join('');
};

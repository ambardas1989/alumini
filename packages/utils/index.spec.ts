/**
 * Unit tests for shared utility functions.
 * These run in all environments — no external dependencies.
 */

import {
  generateClassroomId,
  redactName,
  generateInstitutionCode,
  calculateVouchPoints,
  isVouchThresholdMet,
  daysFromNow,
  isExpired,
  isValidClassroomId,
  isValidEmail,
  isValidInstitutionCode,
  getRange,
} from './index';

// ── generateClassroomId ───────────────────────────────────────────────────────

describe('generateClassroomId()', () => {
  it('generates school ID with grade + section', () => {
    expect(generateClassroomId({
      countryCode:     'IN',
      cityCode:        'KOL',
      institutionSlug: 'MPBIRLA',
      grade:           '9',
      section:         'A',
      batchYear:       2012,
    })).toBe('IN-KOL-MPBIRLA-9A-2012');
  });

  it('generates school ID without section', () => {
    expect(generateClassroomId({
      countryCode:     'IN',
      cityCode:        'KOL',
      institutionSlug: 'MPBIRLA',
      grade:           '10',
      batchYear:       2015,
    })).toBe('IN-KOL-MPBIRLA-10-2015');
  });

  it('generates university ID without city code', () => {
    expect(generateClassroomId({
      countryCode:     'US',
      institutionSlug: 'UCDAVIS',
      program:         'MBA',
      batchYear:       2025,
    })).toBe('US-UCDAVIS-MBA-2025');
  });

  it('uppercases all parts', () => {
    expect(generateClassroomId({
      countryCode:     'in',
      cityCode:        'kol',
      institutionSlug: 'mpbirla',
      grade:           '9',
      section:         'a',
      batchYear:       2012,
    })).toBe('IN-KOL-MPBIRLA-9A-2012');
  });

  it('strips spaces from section', () => {
    expect(generateClassroomId({
      countryCode:     'IN',
      cityCode:        'DEL',
      institutionSlug: 'KENDRIYA',
      grade:           '12',
      section:         ' A ',
      batchYear:       2020,
    })).toBe('IN-DEL-KENDRIYA-12A-2020');
  });

  it('throws when neither grade nor program is provided', () => {
    expect(() => generateClassroomId({
      countryCode:     'IN',
      cityCode:        'KOL',
      institutionSlug: 'MPBIRLA',
      batchYear:       2012,
    })).toThrow();
  });
});

// ── redactName ────────────────────────────────────────────────────────────────

describe('redactName()', () => {
  it('redacts a full name to first-char format', () => {
    expect(redactName('Priya Sharma')).toBe('P*** S***');
  });

  it('handles single-word names', () => {
    const result = redactName('Arjun');
    expect(result).toContain('A***');
  });

  it('handles empty string', () => {
    expect(redactName('')).toBe('***');
  });

  it('handles three-part names', () => {
    const result = redactName('Rahul Kumar Singh');
    expect(result).toBe('R*** K*** S***');
  });
});

// ── generateInstitutionCode ───────────────────────────────────────────────────

describe('generateInstitutionCode()', () => {
  it('generates a code in the correct format', () => {
    const code = generateInstitutionCode('IN', 2026);
    expect(code).toMatch(/^IN-2026-[A-Z0-9]{6}$/);
  });

  it('generates different codes on each call (probabilistic)', () => {
    const codes = new Set(
      Array.from({ length: 10 }, () => generateInstitutionCode('IN', 2026)),
    );
    // With 6 chars from 32 possibilities, collision probability is negligible
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ── calculateVouchPoints ──────────────────────────────────────────────────────

describe('calculateVouchPoints()', () => {
  it('returns 0 for no vouches', () => {
    expect(calculateVouchPoints([])).toBe(0);
  });

  it('counts student vouches as 1pt each', () => {
    expect(calculateVouchPoints([
      { role: 'student' },
      { role: 'student' },
    ])).toBe(2);
  });

  it('counts teacher vouches as 1.5pts each', () => {
    expect(calculateVouchPoints([{ role: 'teacher' }])).toBe(1.5);
  });

  it('calculates mixed vouches correctly', () => {
    // 1 teacher (1.5) + 2 students (2) = 3.5
    expect(calculateVouchPoints([
      { role: 'teacher' },
      { role: 'student' },
      { role: 'student' },
    ])).toBe(3.5);
  });

  it('two teachers = exactly 3pts', () => {
    expect(calculateVouchPoints([
      { role: 'teacher' },
      { role: 'teacher' },
    ])).toBe(3);
  });
});

// ── isVouchThresholdMet ────────────────────────────────────────────────────────

describe('isVouchThresholdMet()', () => {
  it('returns false when below threshold', () => {
    expect(isVouchThresholdMet([{ role: 'student' }, { role: 'student' }])).toBe(false);
  });

  it('returns true when exactly at threshold (3 students)', () => {
    expect(isVouchThresholdMet([
      { role: 'student' },
      { role: 'student' },
      { role: 'student' },
    ])).toBe(true);
  });

  it('returns true when 2 teachers vouch', () => {
    expect(isVouchThresholdMet([
      { role: 'teacher' },
      { role: 'teacher' },
    ])).toBe(true);
  });

  it('returns true when above threshold', () => {
    expect(isVouchThresholdMet([
      { role: 'teacher' },
      { role: 'student' },
      { role: 'student' },
      { role: 'student' },
    ])).toBe(true);
  });
});

// ── isExpired ─────────────────────────────────────────────────────────────────

describe('isExpired()', () => {
  it('returns true for past dates', () => {
    expect(isExpired(new Date('2020-01-01'))).toBe(true);
  });

  it('returns false for future dates', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    expect(isExpired(future)).toBe(false);
  });
});

// ── isValidClassroomId ────────────────────────────────────────────────────────

describe('isValidClassroomId()', () => {
  it('validates a school ID', () => {
    expect(isValidClassroomId('IN-KOL-MPBIRLA-9A-2012')).toBe(true);
  });

  it('validates a university ID', () => {
    expect(isValidClassroomId('US-UCDAVIS-MBA-2025')).toBe(true);
  });

  it('rejects an ID with invalid year', () => {
    expect(isValidClassroomId('IN-KOL-MPBIRLA-9A-1800')).toBe(false);
  });

  it('rejects an ID with lowercase', () => {
    expect(isValidClassroomId('in-kol-mpbirla-9a-2012')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidClassroomId('')).toBe(false);
  });
});

// ── isValidEmail ──────────────────────────────────────────────────────────────

describe('isValidEmail()', () => {
  it('validates a standard email', () => {
    expect(isValidEmail('priya@gsm.ucdavis.edu')).toBe(true);
  });

  it('rejects an email without @', () => {
    expect(isValidEmail('notanemail')).toBe(false);
  });

  it('rejects an email without domain', () => {
    expect(isValidEmail('priya@')).toBe(false);
  });
});

// ── isValidInstitutionCode ────────────────────────────────────────────────────

describe('isValidInstitutionCode()', () => {
  it('validates a correct code format', () => {
    expect(isValidInstitutionCode('IN-2026-A7K2PQ')).toBe(true);
  });

  it('rejects a code with wrong length', () => {
    expect(isValidInstitutionCode('IN-2026-A7K')).toBe(false);
  });

  it('rejects a code with lowercase', () => {
    expect(isValidInstitutionCode('in-2026-a7k2pq')).toBe(false);
  });
});

// ── getRange ──────────────────────────────────────────────────────────────────

describe('getRange()', () => {
  it('returns correct range for page 0', () => {
    expect(getRange(0, 50)).toEqual({ from: 0, to: 49 });
  });

  it('returns correct range for page 1', () => {
    expect(getRange(1, 50)).toEqual({ from: 50, to: 99 });
  });

  it('returns correct range for page 2 with size 25', () => {
    expect(getRange(2, 25)).toEqual({ from: 50, to: 74 });
  });
});

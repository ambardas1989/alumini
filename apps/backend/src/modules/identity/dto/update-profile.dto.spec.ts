/**
 * Unit tests for UpdateProfileDto's normalizePhone() — TASKS_07 TASK 09
 * FIX D. Covers the four shapes the task itself lists, plus a couple of
 * pass-through cases (already E.164, already-invalid) that must not be
 * mangled.
 */

import { normalizePhone } from './update-profile.dto';

describe('normalizePhone()', () => {
  it('prepends +91 to a bare 10-digit number', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('prepends +91 to a leading-0, 10-digit-after number', () => {
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('prepends + to a digits-only number with a country code already present', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('strips spaces, hyphens, and parentheses', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(91) 98765 43210')).toBe('+919876543210');
  });

  it('leaves an already-E.164 number unchanged', () => {
    expect(normalizePhone('+15551234567')).toBe('+15551234567');
  });

  it('passes through a non-string value unchanged', () => {
    expect(normalizePhone(undefined)).toBeUndefined();
    expect(normalizePhone(null)).toBeNull();
  });

  it('passes through an empty string unchanged', () => {
    expect(normalizePhone('')).toBe('');
  });
});

'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './CodeInput.module.css';

interface CodeInputProps {
  length?: number;
  /** Fired once all boxes are filled with digits. */
  onComplete: (code: string) => void;
  /** Fired on every keystroke — lets a caller track completeness for e.g. an explicit Submit button. */
  onChange?: (code: string, complete: boolean) => void;
  disabled?: boolean;
  /** Triggers the shake animation and clears the boxes — set this after a rejected code. */
  error?: boolean;
  label: string;
}

/**
 * `length` individual digit boxes rather than one text input — matches the
 * task's explicit "6 individual digit boxes (not one input)" requirement
 * for the MFA/OTP screens. Digits type through left to right with
 * auto-advance, Backspace on an empty box moves back, and pasting a full
 * code into any box distributes it across all of them.
 */
export function CodeInput({
  length = 6,
  onComplete,
  onChange,
  disabled = false,
  error = false,
  label,
}: CodeInputProps) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(''));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const firedRef = useRef(false);

  // A new `error` triggers the shake animation and clears the boxes for
  // another attempt — matches "Shake animation on input boxes" from the spec.
  useEffect(() => {
    if (!error) return;
    setDigits(Array(length).fill(''));
    firedRef.current = false;
    inputRefs.current[0]?.focus();
  }, [error, length]);

  const reportChange = (next: string[]) => {
    const code = next.join('');
    const complete = code.length === length;
    onChange?.(code, complete);
    if (complete && !firedRef.current) {
      firedRef.current = true;
      onComplete(code);
    }
  };

  const handleChange = (index: number, rawValue: string) => {
    const value = rawValue.replace(/\D/g, '');
    if (!value) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      firedRef.current = false;
      reportChange(next);
      return;
    }

    // Typing quickly can land more than one character in a single box on
    // some mobile keyboards — take the last digit typed, not the first.
    const digit = value[value.length - 1];
    const next = [...digits];
    next[index] = digit ?? '';
    setDigits(next);

    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    reportChange(next);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(length).fill('');
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]!;
    setDigits(next);
    const focusIndex = Math.min(pasted.length, length - 1);
    inputRefs.current[focusIndex]?.focus();
    reportChange(next);
  };

  return (
    <div className={`${styles.row} ${error ? styles.shake : ''}`} role="group" aria-label={label}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          className={styles.box}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          aria-label={`Digit ${index + 1} of ${length}`}
        />
      ))}
    </div>
  );
}

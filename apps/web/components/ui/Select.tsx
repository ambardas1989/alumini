'use client';

import { useId, type SelectHTMLAttributes } from 'react';
// Shares Input's stylesheet for visual consistency — see PasswordInput.tsx's
// identical reasoning for why this isn't just <Input as="select">.
import inputStyles from './Input.module.css';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Select({ label, error, hint, id, className, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const describedById = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;

  return (
    <div className={inputStyles.field}>
      <label htmlFor={selectId} className={inputStyles.label}>
        {label}
      </label>
      <select
        id={selectId}
        className={[inputStyles.input, error ? inputStyles.inputError : '', className].filter(Boolean).join(' ')}
        aria-invalid={!!error}
        aria-describedby={describedById}
        {...rest}
      >
        {children}
      </select>
      {error && (
        <p id={`${selectId}-error`} className={inputStyles.error}>
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${selectId}-hint`} className={inputStyles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

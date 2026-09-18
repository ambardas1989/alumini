'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
// Shares Input's own stylesheet (label/input/error/hint classes) rather than
// rendering <Input/> as a black box — a toggle button needs to sit inside
// the same row as the field, which CSS Modules' scoping makes impossible to
// reach into from outside Input.tsx.
import inputStyles from './Input.module.css';
import styles from './PasswordInput.module.css';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string;
  hint?: string;
}

export function PasswordInput({ label, error, hint, id, className, ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={inputStyles.field}>
      <label htmlFor={inputId} className={inputStyles.label}>
        {label}
      </label>
      <div className={styles.row}>
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          className={[inputStyles.input, error ? inputStyles.inputError : '', className]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={!!error}
          aria-describedby={describedById}
          {...rest}
        />
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {error && (
        <p id={`${inputId}-error`} className={inputStyles.error}>
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${inputId}-hint`} className={inputStyles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

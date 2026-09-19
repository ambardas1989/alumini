'use client';

import { useId, type TextareaHTMLAttributes } from 'react';
// Shares Input's stylesheet — same reasoning as Select.tsx/PasswordInput.tsx.
import inputStyles from './Input.module.css';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Textarea({ label, error, hint, id, className, ...rest }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const describedById = error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined;

  return (
    <div className={inputStyles.field}>
      <label htmlFor={textareaId} className={inputStyles.label}>
        {label}
      </label>
      <textarea
        id={textareaId}
        className={[inputStyles.input, error ? inputStyles.inputError : '', className].filter(Boolean).join(' ')}
        aria-invalid={!!error}
        aria-describedby={describedById}
        {...rest}
      />
      {error && (
        <p id={`${textareaId}-error`} className={inputStyles.error}>
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${textareaId}-hint`} className={inputStyles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

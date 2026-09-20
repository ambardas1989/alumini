'use client';

import styles from './FilterChips.module.css';

export interface FilterChipOption {
  label: string;
  value: string;
}

interface FilterChipsProps {
  options: FilterChipOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  allLabel: string;
}

/** Horizontal scrollable chip row — first chip is always "All" (value: null). TASK 10 PART A. */
export function FilterChips({ options, value, onChange, allLabel }: FilterChipsProps) {
  return (
    <div className={styles.row} role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={value === null}
        className={`chip ${value === null ? 'chip-active' : ''}`}
        onClick={() => onChange(null)}
      >
        {allLabel}
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`chip ${value === option.value ? 'chip-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

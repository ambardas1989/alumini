'use client';

import { useEffect, useState } from 'react';

/** Returns `value`, delayed until it's stopped changing for `delayMs`. Used to debounce search-as-you-type inputs. */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

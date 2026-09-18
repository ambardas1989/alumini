'use client';

import { Button } from './Button';
import styles from './ErrorMessage.module.css';

interface ErrorMessageProps {
  message: string;
  fullPage?: boolean;
  onRetry?: () => void;
}

export function ErrorMessage({ message, fullPage = false, onRetry }: ErrorMessageProps) {
  if (fullPage) {
    return (
      <div className={styles.fullPage}>
        <p className={styles.fullPageMessage}>{message}</p>
        {onRetry && (
          <Button variant="secondary" size="md" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return <p className={styles.inline}>{message}</p>;
}

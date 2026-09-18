'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toast, type ToastVariant } from '../Toast';
import styles from './ToastProvider.module.css';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const queueRef = useRef<ToastItem[]>([]);
  const nextId = useRef(0);

  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setVisible((current) => {
      const next = current.filter((t) => t.id !== id);
      const queued = queueRef.current.shift();
      return queued ? [...next, queued] : next;
    });
  }, []);

  const showToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const item: ToastItem = { id: nextId.current++, message, variant };
    setVisible((current) => {
      if (current.length >= MAX_VISIBLE) {
        queueRef.current.push(item);
        return current;
      }
      return [...current, item];
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {mounted &&
        createPortal(
          <div className={styles.viewport}>
            {visible.map((t) => (
              <Toast key={t.id} message={t.message} variant={t.variant} onDismiss={() => dismiss(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}

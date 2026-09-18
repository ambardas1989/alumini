import type { ReactNode } from 'react';
import '@/styles/layout.css';

interface PageContainerProps {
  children: ReactNode;
  noPadding?: boolean;
}

/** Consistent padding wrapper used inside every screen — see --page-padding-x/-y in globals.css. */
export function PageContainer({ children, noPadding = false }: PageContainerProps) {
  return (
    <div className={noPadding ? 'page-container page-container--no-padding' : 'page-container'}>
      {children}
    </div>
  );
}

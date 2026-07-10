'use client';

import { usePathname } from 'next/navigation';
import AuthenticatedLayout from './AuthenticatedLayout';

interface LayoutProviderProps {
  children: React.ReactNode;
}

/**
 * Conditionally wraps children with AuthenticatedLayout.
 * Pages like /login render without the AppLayout shell.
 */
export default function LayoutProvider({ children }: LayoutProviderProps) {
  const pathname = usePathname();

  // Pages that should NOT have the authenticated layout
  const publicPaths = ['/login'];
  const isPublicPage = publicPaths.some((path) => pathname?.includes(path));

  if (isPublicPage) {
    return <>{children}</>;
  }

  return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}

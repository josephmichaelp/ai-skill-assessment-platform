'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { AppLayout, Box, Spinner } from '@cloudscape-design/components';
import {
  configureAmplify,
  isAuthenticated,
  getAuthUser,
  logout,
  startInactivityMonitor,
  type AuthUser,
} from '@/lib/auth';
import Navigation from './Navigation';
import TopNavigation from './TopNavigation';

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

export default function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const router = useRouter();
  const locale = useLocale();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const handleSessionTimeout = useCallback(async () => {
    await logout();
    router.replace(`/${locale}/login?expired=true`);
  }, [locale, router]);

  useEffect(() => {
    configureAmplify();

    const checkAuth = async () => {
      const authenticated = await isAuthenticated();
      if (!authenticated) {
        router.replace(`/${locale}/login`);
        return;
      }

      try {
        const authUser = await getAuthUser();
        setUser(authUser);
      } catch {
        router.replace(`/${locale}/login`);
        return;
      }

      setIsLoading(false);
    };

    checkAuth();
  }, [locale, router]);

  // Start inactivity monitor once authenticated
  useEffect(() => {
    if (!user) return;

    const cleanup = startInactivityMonitor(handleSessionTimeout);
    return cleanup;
  }, [user, handleSessionTimeout]);

  if (isLoading) {
    return (
      <Box textAlign="center" padding={{ top: 'xxxl' }}>
        <Spinner size="large" />
      </Box>
    );
  }

  return (
    <>
      <div id="top-navigation">
        <TopNavigation user={user} />
      </div>
      <AppLayout
        navigation={<Navigation user={user} />}
        content={children}
        toolsHide
        headerSelector="#top-navigation"
      />
    </>
  );
}

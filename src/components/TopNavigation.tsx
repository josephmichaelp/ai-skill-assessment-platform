'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { TopNavigation as TopNav } from '@cloudscape-design/components';
import type { AuthUser } from '@/lib/auth';
import { logout } from '@/lib/auth';

interface TopNavigationProps {
  user: AuthUser | null;
}

export default function TopNavigation({ user }: TopNavigationProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const handleLanguageSwitch = () => {
    const newLocale = locale === 'id' ? 'en' : 'id';
    const currentPath = window.location.pathname;
    const newPath = currentPath.replace(`/${locale}`, `/${newLocale}`);
    router.replace(newPath);
  };

  const handleLogout = async () => {
    await logout();
    router.replace(`/${locale}/login`);
  };

  const userDisplayName = user?.name || user?.email || '';
  const roleDisplay = user?.role || '';

  return (
    <TopNav
      identity={{
        href: `/${locale}/dashboard`,
        title: t('common.appName'),
      }}
      utilities={[
        {
          type: 'button',
          text: locale === 'id' ? t('common.english') : t('common.indonesian'),
          ariaLabel: t('common.switchLanguage'),
          onClick: handleLanguageSwitch,
        },
        {
          type: 'menu-dropdown',
          text: userDisplayName,
          description: roleDisplay,
          iconName: 'user-profile',
          items: [
            {
              id: 'signout',
              text: t('auth.signOut'),
            },
          ],
          onItemClick: ({ detail }) => {
            if (detail.id === 'signout') {
              handleLogout();
            }
          },
        },
      ]}
    />
  );
}

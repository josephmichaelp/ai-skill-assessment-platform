'use client';

import { useTranslations, useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';
import { SideNavigation } from '@cloudscape-design/components';
import type { AuthUser } from '@/lib/auth';

interface NavigationProps {
  user: AuthUser | null;
}

export default function Navigation({ user }: NavigationProps) {
  const t = useTranslations('navigation');
  const locale = useLocale();
  const pathname = usePathname();

  const role = user?.role || 'Employee';

  // Build menu items based on user role
  const items: Array<Record<string, unknown>> = [];

  // All roles can see Dashboard, Assessments, Roleplay, Assignments, Promotion
  items.push(
    { type: 'link', text: t('dashboard'), href: `/${locale}/dashboard` },
    { type: 'link', text: t('assessments'), href: `/${locale}/assessments` },
    { type: 'link', text: t('roleplay'), href: `/${locale}/roleplay` },
    { type: 'link', text: t('assignments'), href: `/${locale}/assignments` },
    { type: 'link', text: t('promotion'), href: `/${locale}/promotion` }
  );

  // Manager and Admin can see Performance
  if (role === 'Manager' || role === 'Admin') {
    items.push({ type: 'link', text: t('performance'), href: `/${locale}/performance` });
  }

  // Admin only
  if (role === 'Admin') {
    items.push(
      { type: 'divider' },
      {
        type: 'section',
        text: t('admin'),
        items: [
          { type: 'link', text: 'Users', href: `/${locale}/admin/users` },
          { type: 'link', text: 'Positions', href: `/${locale}/admin/positions` },
          { type: 'link', text: 'Token Usage', href: `/${locale}/admin/token-usage` },
        ],
      }
    );
  }

  // Determine active href from current pathname
  const activeHref = pathname || `/${locale}/dashboard`;

  return (
    <SideNavigation
      header={{
        text: t('dashboard'),
        href: `/${locale}/dashboard`,
      }}
      activeHref={activeHref}
      items={items as any}
    />
  );
}

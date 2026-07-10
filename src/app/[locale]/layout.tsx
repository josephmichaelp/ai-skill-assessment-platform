import '@cloudscape-design/global-styles/index.css';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import LayoutProvider from '@/components/LayoutProvider';

export const metadata = {
  title: 'AI Skill Assessment Platform',
  description: 'AI-powered competency assessment and talent development platform',
};

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body style={{ margin: 0, padding: 0 }}>
        <NextIntlClientProvider messages={messages}>
          <LayoutProvider>{children}</LayoutProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

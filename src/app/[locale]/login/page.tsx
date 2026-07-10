'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  Alert,
  Box,
  Button,
  Container,
  Form,
  FormField,
  Header,
  Input,
  Select,
  SpaceBetween,
} from '@cloudscape-design/components';
import { configureAmplify, login, isAuthenticated } from '@/lib/auth';

export default function LoginPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    configureAmplify();

    // Redirect if already authenticated
    isAuthenticated().then((authenticated) => {
      if (authenticated) {
        router.replace(`/${locale}/dashboard`);
      }
    });
  }, [locale, router]);

  const handleLanguageChange = (selectedLocale: string) => {
    const currentPath = window.location.pathname;
    const newPath = currentPath.replace(`/${locale}`, `/${selectedLocale}`);
    router.replace(newPath);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      await login(email, password);
      router.replace(`/${locale}/dashboard`);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t('common.error'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const languageOptions = [
    { label: t('common.indonesian'), value: 'id' },
    { label: t('common.english'), value: 'en' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '20px',
        backgroundColor: '#f2f3f3',
      }}
    >
      <div style={{ width: '100%', maxWidth: '420px' }}>
        <SpaceBetween size="l">
          {/* Language toggle */}
          <Box float="right">
            <Select
              selectedOption={languageOptions.find((o) => o.value === locale) || languageOptions[0]}
              onChange={({ detail }) => {
                if (detail.selectedOption.value) {
                  handleLanguageChange(detail.selectedOption.value);
                }
              }}
              options={languageOptions}
              ariaLabel={t('common.switchLanguage')}
            />
          </Box>

          <Container
            header={
              <Header variant="h1" description={t('common.appName')}>
                {t('auth.signIn')}
              </Header>
            }
          >
            <form onSubmit={handleSubmit}>
              <Form
                actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    <Button
                      variant="primary"
                      formAction="submit"
                      loading={isLoading}
                      disabled={!email || !password}
                    >
                      {t('auth.signIn')}
                    </Button>
                  </SpaceBetween>
                }
                errorText={error}
              >
                <SpaceBetween size="l">
                  {error && (
                    <Alert type="error" dismissible onDismiss={() => setError(null)}>
                      {error}
                    </Alert>
                  )}

                  <FormField label={t('auth.email')}>
                    <Input
                      type="email"
                      value={email}
                      onChange={({ detail }) => setEmail(detail.value)}
                      placeholder="user@example.com"
                      autoComplete
                      disabled={isLoading}
                    />
                  </FormField>

                  <FormField label={t('auth.password')}>
                    <Input
                      type="password"
                      value={password}
                      onChange={({ detail }) => setPassword(detail.value)}
                      disabled={isLoading}
                    />
                  </FormField>
                </SpaceBetween>
              </Form>
            </form>
          </Container>
        </SpaceBetween>
      </div>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import {
  Cards,
  Box,
  Button,
  Header,
  SpaceBetween,
  ContentLayout,
  StatusIndicator,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { startRoleplaySession } from '@/hooks/useRoleplay';

interface ScenarioCard {
  id: string;
  scenarioType: 'Customer' | 'Interviewer' | 'Manager' | 'DifficultCustomer';
  titleKey: string;
  descriptionKey: string;
}

const SCENARIOS: ScenarioCard[] = [
  {
    id: 'customer',
    scenarioType: 'Customer',
    titleKey: 'scenarioCustomer',
    descriptionKey: 'scenarioCustomerDesc',
  },
  {
    id: 'interviewer',
    scenarioType: 'Interviewer',
    titleKey: 'scenarioInterviewer',
    descriptionKey: 'scenarioInterviewerDesc',
  },
  {
    id: 'manager',
    scenarioType: 'Manager',
    titleKey: 'scenarioManager',
    descriptionKey: 'scenarioManagerDesc',
  },
  {
    id: 'difficult-customer',
    scenarioType: 'DifficultCustomer',
    titleKey: 'scenarioDifficultCustomer',
    descriptionKey: 'scenarioDifficultCustomerDesc',
  },
];

export default function RoleplayPage() {
  const t = useTranslations('roleplay');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [loadingScenario, setLoadingScenario] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStartSession = async (
    scenarioType: 'Customer' | 'Interviewer' | 'Manager' | 'DifficultCustomer'
  ) => {
    setLoadingScenario(scenarioType);
    setError(null);

    try {
      const response = await startRoleplaySession(scenarioType);
      router.push(`roleplay/${response.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon('error'));
      setLoadingScenario(null);
    }
  };

  return (
    <ContentLayout
      header={<Header variant="h1">{t('title')}</Header>}
    >
      <SpaceBetween size="l">
        {error && (
          <StatusIndicator type="error">{error}</StatusIndicator>
        )}

        <Cards
          cardDefinition={{
            header: (item: ScenarioCard) => (
              <Header variant="h3">{t(item.titleKey)}</Header>
            ),
            sections: [
              {
                id: 'description',
                content: (item: ScenarioCard) => (
                  <Box variant="p" color="text-body-secondary">
                    {t(item.descriptionKey)}
                  </Box>
                ),
              },
              {
                id: 'objectives',
                header: t('objectives'),
                content: (item: ScenarioCard) => (
                  <Box variant="small" color="text-status-inactive">
                    {t(`${item.titleKey}Desc`)}
                  </Box>
                ),
              },
              {
                id: 'action',
                content: (item: ScenarioCard) => (
                  <Button
                    variant="primary"
                    loading={loadingScenario === item.scenarioType}
                    disabled={loadingScenario !== null}
                    onClick={() => handleStartSession(item.scenarioType)}
                  >
                    {t('startSession')}
                  </Button>
                ),
              },
            ],
          }}
          items={SCENARIOS}
          header={
            <Header variant="h2">{t('selectScenario')}</Header>
          }
          cardsPerRow={[
            { cards: 1 },
            { minWidth: 500, cards: 2 },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}

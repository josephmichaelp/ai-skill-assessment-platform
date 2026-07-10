'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Box,
  Button,
  ColumnLayout,
  Container,
  ContentLayout,
  Header,
  SpaceBetween,
  StatusIndicator,
  Table,
} from '@cloudscape-design/components';
import { useLatestAssessment, useRecentAssessments } from '@/hooks/useDashboard';

function getScoreStatus(score: number): 'success' | 'warning' | 'error' {
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'error';
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const { latestAssessment, isLoading: isLoadingLatest } = useLatestAssessment();
  const { assessments, isLoading: isLoadingRecent } = useRecentAssessments();

  return (
    <ContentLayout
      header={<Header variant="h1">{t('title')}</Header>}
    >
      <SpaceBetween size="l">
        {/* Summary Cards */}
        <ColumnLayout columns={3} variant="text-grid">
          <Container
            header={<Header variant="h3">{t('lastAssessmentScore')}</Header>}
          >
            {isLoadingLatest ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : latestAssessment ? (
              <SpaceBetween size="xs">
                <Box variant="h1" fontSize="display-l">
                  {latestAssessment.score}
                </Box>
                <StatusIndicator type={getScoreStatus(latestAssessment.score)}>
                  {latestAssessment.topic}
                </StatusIndicator>
              </SpaceBetween>
            ) : (
              <Box color="text-status-inactive">{tCommon('noData')}</Box>
            )}
          </Container>

          <Container
            header={<Header variant="h3">{t('activeRoleplaySessions')}</Header>}
          >
            {isLoadingLatest ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : (
              <Box variant="h1" fontSize="display-l">
                0
              </Box>
            )}
          </Container>

          <Container
            header={<Header variant="h3">{t('pendingAssignments')}</Header>}
          >
            {isLoadingLatest ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : (
              <Box variant="h1" fontSize="display-l">
                0
              </Box>
            )}
          </Container>
        </ColumnLayout>

        {/* Quick Actions */}
        <Container header={<Header variant="h2">{t('quickActions')}</Header>}>
          <SpaceBetween direction="horizontal" size="s">
            <Button
              variant="primary"
              onClick={() => router.push('/assessments/new')}
            >
              {t('startAssessment')}
            </Button>
            <Button onClick={() => router.push('/roleplay')}>
              {t('startRoleplay')}
            </Button>
            <Button onClick={() => router.push('/assignments')}>
              {t('uploadAssignment')}
            </Button>
          </SpaceBetween>
        </Container>

        {/* Recent Activity */}
        <Table
          header={<Header variant="h2">{t('recentActivity')}</Header>}
          loading={isLoadingRecent}
          loadingText={tCommon('loading')}
          items={assessments}
          empty={
            <Box textAlign="center" color="inherit">
              <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                {t('noRecentActivity')}
              </Box>
            </Box>
          }
          columnDefinitions={[
            {
              id: 'date',
              header: tCommon('date'),
              cell: (item: { createdAt: string }) => formatDate(item.createdAt),
              sortingField: 'createdAt',
              width: 150,
            },
            {
              id: 'type',
              header: 'Type',
              cell: () => 'Assessment',
              width: 120,
            },
            {
              id: 'description',
              header: 'Description',
              cell: (item: { topic: string; difficulty: string }) =>
                `${item.topic} (${item.difficulty})`,
            },
            {
              id: 'score',
              header: 'Score',
              cell: (item: { score: number }) => (
                <StatusIndicator type={getScoreStatus(item.score)}>
                  {item.score}/100
                </StatusIndicator>
              ),
              width: 120,
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}

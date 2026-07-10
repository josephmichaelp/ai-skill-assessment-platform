'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  BarChart,
  ColumnLayout,
  Container,
  ContentLayout,
  Header,
  LineChart,
  Select,
  SpaceBetween,
  StatusIndicator,
  Table,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import {
  usePromotionScorecard,
  usePromotionHistory,
  useTeamMembers,
  type CompetencyGap,
  type CompetencyTimelineEntry,
} from '@/hooks/usePromotion';
import { getAuthUser, type AuthUser } from '@/lib/auth';

export default function PromotionPage() {
  const t = useTranslations('promotion');
  const tCommon = useTranslations('common');

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const isManagerOrAdmin = authUser?.role === 'Manager' || authUser?.role === 'Admin';
  const { users, isLoading: isLoadingUsers } = useTeamMembers();

  // Fetch auth user on mount
  useEffect(() => {
    getAuthUser()
      .then((user) => {
        setAuthUser(user);
        setSelectedUserId(user.userId);
      })
      .catch(() => {
        // Auth error handled by layout
      });
  }, []);

  const { scorecard, isLoading: isLoadingScorecard } = usePromotionScorecard(selectedUserId);
  const { timeline } = usePromotionHistory(selectedUserId);

  // Build user options for selector
  const userOptions = users.map((u) => ({
    label: u.name || u.email,
    value: u.userId,
    description: u.email,
  }));

  const selectedOption = userOptions.find((o) => o.value === selectedUserId) || null;

  // Build bar chart data from competency scores
  const competencyBarData = scorecard
    ? Object.entries(scorecard.competencyScores).map(([topic, score]) => ({
        x: topic,
        y: score,
      }))
    : [];

  // Build timeline chart data grouped by topic
  const timelineSeriesMap = new Map<string, { x: Date; y: number }[]>();
  if (timeline?.entries) {
    timeline.entries.forEach((entry: CompetencyTimelineEntry) => {
      if (!timelineSeriesMap.has(entry.topic)) {
        timelineSeriesMap.set(entry.topic, []);
      }
      timelineSeriesMap.get(entry.topic)!.push({
        x: new Date(entry.date),
        y: entry.score,
      });
    });
  }

  const timelineSeries = Array.from(timelineSeriesMap.entries()).map(([topic, data]) => ({
    title: topic,
    type: 'line' as const,
    data,
  }));

  return (
    <ContentLayout header={<Header variant="h1">{t('title')}</Header>}>
      <SpaceBetween size="l">
        {/* Team member selector for Manager/Admin */}
        {isManagerOrAdmin && (
          <Container header={<Header variant="h2">{t('selectEmployee')}</Header>}>
            <Select
              selectedOption={selectedOption}
              onChange={({ detail }: { detail: { selectedOption: { value?: string } } }) => setSelectedUserId(detail.selectedOption.value || null)}
              options={userOptions}
              placeholder={t('selectEmployee')}
              loading={isLoadingUsers}
              filteringType="auto"
            />
          </Container>
        )}

        {/* Readiness Score */}
        <ColumnLayout columns={2} variant="text-grid">
          <Container header={<Header variant="h2">{t('readinessScore')}</Header>}>
            {isLoadingScorecard ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : scorecard ? (
              <SpaceBetween size="xs">
                <Box variant="h1" fontSize="display-l" textAlign="center">
                  {scorecard.readinessScore}
                </Box>
                <Box textAlign="center">
                  <StatusIndicator
                    type={
                      scorecard.readinessScore >= 80
                        ? 'success'
                        : scorecard.readinessScore >= 50
                          ? 'warning'
                          : 'error'
                    }
                  >
                    / 100
                  </StatusIndicator>
                </Box>
              </SpaceBetween>
            ) : (
              <Box color="text-status-inactive">{t('noTargetPosition')}</Box>
            )}
          </Container>

          <Container header={<Header variant="h2">{t('targetPosition')}</Header>}>
            {isLoadingScorecard ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : scorecard ? (
              <Box variant="h2">{scorecard.targetPosition}</Box>
            ) : (
              <Box color="text-status-inactive">{t('noTargetPosition')}</Box>
            )}
          </Container>
        </ColumnLayout>

        {/* Competency Bar Chart */}
        {scorecard && competencyBarData.length > 0 && (
          <Container header={<Header variant="h2">{t('competencyGaps')}</Header>}>
            <BarChart
              series={[
                {
                  title: t('currentScore'),
                  type: 'bar',
                  data: competencyBarData,
                },
              ]}
              xDomain={competencyBarData.map((d) => d.x)}
              yDomain={[0, 100]}
              xTitle={tCommon('status')}
              yTitle={t('currentScore')}
              hideFilter
              height={300}
            />
          </Container>
        )}

        {/* Skill Gaps Table */}
        {scorecard && scorecard.competencyGaps.length > 0 && (
          <Table
            header={<Header variant="h2">{t('competencyGaps')}</Header>}
            items={scorecard.competencyGaps}
            columnDefinitions={[
              {
                id: 'topic',
                header: 'Topic',
                cell: (item: CompetencyGap) => item.topic,
                sortingField: 'topic',
              },
              {
                id: 'currentScore',
                header: t('currentScore'),
                cell: (item: CompetencyGap) => item.currentScore,
                sortingField: 'currentScore',
              },
              {
                id: 'requiredScore',
                header: t('requiredScore'),
                cell: (item: CompetencyGap) => item.requiredScore,
                sortingField: 'requiredScore',
              },
              {
                id: 'gap',
                header: t('gap'),
                cell: (item: CompetencyGap) => (
                  <StatusIndicator type={item.gap > 20 ? 'error' : 'warning'}>
                    {item.gap}
                  </StatusIndicator>
                ),
                sortingField: 'gap',
              },
              {
                id: 'weight',
                header: t('weight'),
                cell: (item: CompetencyGap) => item.weight.toFixed(2),
                sortingField: 'weight',
              },
            ]}
          />
        )}

        {/* Competency Timeline LineChart */}
        {timeline && timelineSeries.length > 0 && (
          <Container header={<Header variant="h2">{t('competencyTimeline')}</Header>}>
            <LineChart
              series={timelineSeries}
              xScaleType="time"
              yDomain={[0, 100]}
              xTitle={tCommon('date')}
              yTitle={t('currentScore')}
              height={300}
              hideFilter
            />
          </Container>
        )}

        {/* AI Insights */}
        {scorecard && scorecard.insights && (
          <Container header={<Header variant="h2">{t('developmentInsights')}</Header>}>
            <Box variant="p">{scorecard.insights}</Box>
          </Container>
        )}

        {/* Career Recommendations */}
        {scorecard && scorecard.recommendations && scorecard.recommendations.length > 0 && (
          <Container header={<Header variant="h2">{t('careerRecommendations')}</Header>}>
            <SpaceBetween size="s">
              {scorecard.recommendations.map((rec, index) => (
                <Box key={index} variant="p">
                  {index + 1}. {rec}
                </Box>
              ))}
            </SpaceBetween>
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}

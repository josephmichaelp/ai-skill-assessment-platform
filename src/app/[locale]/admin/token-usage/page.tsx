'use client';

import React from 'react';
import {
  Box,
  ColumnLayout,
  Container,
  ContentLayout,
  Header,
  SpaceBetween,
  BarChart,
  PieChart,
  LineChart,
  Table,
  Alert,
  StatusIndicator,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import {
  useTokenUsage,
  useDailyTokenUsage,
  useTokenUsageForecast,
  DailyUsageEntry,
} from '@/hooks/useTokenUsage';

const MONTHLY_LIMIT = 500_000;
const WARNING_THRESHOLD = 0.8;
const CRITICAL_THRESHOLD = 0.95;

export default function AdminTokenUsagePage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');

  const { usage, isLoading: isLoadingUsage } = useTokenUsage();
  const { dailyUsage, isLoading: isLoadingDaily } = useDailyTokenUsage();
  const { forecast, isLoading: isLoadingForecast } = useTokenUsageForecast();

  const percentageUsed = usage ? usage.totalTokensUsed / MONTHLY_LIMIT : 0;
  const isWarning = percentageUsed >= WARNING_THRESHOLD && percentageUsed < CRITICAL_THRESHOLD;
  const isCritical = percentageUsed >= CRITICAL_THRESHOLD;

  // Format numbers with comma separators
  const formatNumber = (num: number) => num.toLocaleString();

  // Daily consumption BarChart data
  const dailyBarChartSeries = [
    {
      title: 'Daily Tokens',
      type: 'bar' as const,
      data: dailyUsage.map((entry) => ({
        x: new Date(entry.date),
        y: entry.totalTokens,
      })),
    },
  ];

  // Model distribution PieChart data
  const modelPieData = usage
    ? [
        {
          title: 'Nova Lite',
          value: usage.breakdownByModel['amazon.nova-lite-v1:0']?.total ?? 0,
        },
        {
          title: 'Cohere Embed',
          value: usage.breakdownByModel['cohere.embed-multilingual-v3']?.total ?? 0,
        },
      ]
    : [];

  // Feature breakdown BarChart data
  const featureBreakdownSeries = usage
    ? [
        {
          title: t('usageByFeature'),
          type: 'bar' as const,
          data: Object.entries(usage.breakdownByFeature).map(([feature, tokens]) => ({
            x: feature,
            y: tokens,
          })),
        },
      ]
    : [];

  // Forecast LineChart data
  const forecastLineSeries = forecast
    ? [
        {
          title: t('projectedUsage'),
          type: 'line' as const,
          data: forecast.forecast.map((entry) => ({
            x: new Date(entry.date),
            y: entry.projectedTokens,
          })),
        },
        ...(forecast.forecast.some((e) => e.actualTokens !== undefined)
          ? [
              {
                title: t('tokensUsed'),
                type: 'line' as const,
                data: forecast.forecast
                  .filter((entry) => entry.actualTokens !== undefined)
                  .map((entry) => ({
                    x: new Date(entry.date),
                    y: entry.actualTokens!,
                  })),
              },
            ]
          : []),
      ]
    : [];

  // Daily log table data
  const dailyLogColumnDefinitions = [
    {
      id: 'date',
      header: tCommon('date'),
      cell: (item: DailyUsageEntry) => item.date,
      sortingField: 'date',
    },
    {
      id: 'novaLite',
      header: 'Nova Lite',
      cell: (item: DailyUsageEntry) => formatNumber(item.novaLiteTokens),
    },
    {
      id: 'cohereEmbed',
      header: 'Cohere Embed',
      cell: (item: DailyUsageEntry) => formatNumber(item.cohereEmbedTokens),
    },
    {
      id: 'total',
      header: 'Total',
      cell: (item: DailyUsageEntry) => formatNumber(item.totalTokens),
    },
  ];

  return (
    <ContentLayout header={<Header variant="h1">{t('tokenUsage')}</Header>}>
      <SpaceBetween size="l">
        {/* Alert Banners */}
        {isCritical && (
          <Alert type="error" header="Critical">
            {t('usageCritical')}
          </Alert>
        )}
        {isWarning && !isCritical && (
          <Alert type="warning" header="Warning">
            {t('usageWarning')}
          </Alert>
        )}

        {/* Overview Cards */}
        <ColumnLayout columns={3} variant="text-grid">
          <Container header={<Header variant="h3">{t('tokensUsed')}</Header>}>
            {isLoadingUsage ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : (
              <SpaceBetween size="xs">
                <Box variant="h1" fontSize="display-l">
                  {formatNumber(usage?.totalTokensUsed ?? 0)}
                </Box>
                <Box color="text-body-secondary">
                  / {formatNumber(MONTHLY_LIMIT)}
                </Box>
              </SpaceBetween>
            )}
          </Container>

          <Container header={<Header variant="h3">{t('usageLimit')}</Header>}>
            {isLoadingUsage ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : (
              <SpaceBetween size="xs">
                <Box variant="h1" fontSize="display-l">
                  {Math.round(percentageUsed * 100)}%
                </Box>
                <StatusIndicator
                  type={isCritical ? 'error' : isWarning ? 'warning' : 'success'}
                >
                  {isCritical ? 'Critical' : isWarning ? 'Warning' : 'Normal'}
                </StatusIndicator>
              </SpaceBetween>
            )}
          </Container>

          <Container header={<Header variant="h3">{t('tokensRemaining')}</Header>}>
            {isLoadingUsage ? (
              <Box color="text-status-inactive">{tCommon('loading')}</Box>
            ) : (
              <SpaceBetween size="xs">
                <Box variant="h1" fontSize="display-l">
                  {usage?.daysRemainingInMonth ?? 0}
                </Box>
                <Box color="text-body-secondary">days remaining</Box>
              </SpaceBetween>
            )}
          </Container>
        </ColumnLayout>

        {/* Daily Consumption BarChart */}
        <Container header={<Header variant="h2">{t('dailyTrend')}</Header>}>
          {isLoadingDaily ? (
            <Box textAlign="center" color="text-status-inactive" padding="l">
              {tCommon('loading')}
            </Box>
          ) : (
            <BarChart
              series={dailyBarChartSeries}
              xDomain={dailyUsage.map((e) => new Date(e.date))}
              yDomain={[0, Math.max(...dailyUsage.map((e) => e.totalTokens), 1000)]}
              xTitle={tCommon('date')}
              yTitle="Tokens"
              xScaleType="categorical"
              hideFilter
              height={300}
              empty={
                <Box textAlign="center" color="inherit">
                  {tCommon('noData')}
                </Box>
              }
            />
          )}
        </Container>

        {/* Model Distribution PieChart and Feature Breakdown BarChart */}
        <ColumnLayout columns={2}>
          <Container header={<Header variant="h2">{t('usageByModel')}</Header>}>
            {isLoadingUsage ? (
              <Box textAlign="center" color="text-status-inactive" padding="l">
                {tCommon('loading')}
              </Box>
            ) : (
              <PieChart
                data={modelPieData}
                detailPopoverContent={(datum) => [
                  { key: 'Tokens', value: formatNumber(datum.value) },
                  {
                    key: 'Percentage',
                    value: `${Math.round((datum.value / (usage?.totalTokensUsed || 1)) * 100)}%`,
                  },
                ]}
                hideFilter
                size="medium"
                empty={
                  <Box textAlign="center" color="inherit">
                    {tCommon('noData')}
                  </Box>
                }
              />
            )}
          </Container>

          <Container header={<Header variant="h2">{t('usageByFeature')}</Header>}>
            {isLoadingUsage ? (
              <Box textAlign="center" color="text-status-inactive" padding="l">
                {tCommon('loading')}
              </Box>
            ) : (
              <BarChart
                series={featureBreakdownSeries}
                xDomain={Object.keys(usage?.breakdownByFeature ?? {})}
                yDomain={[0, Math.max(...Object.values(usage?.breakdownByFeature ?? {}), 1000)]}
                xTitle="Feature"
                yTitle="Tokens"
                xScaleType="categorical"
                hideFilter
                height={250}
                empty={
                  <Box textAlign="center" color="inherit">
                    {tCommon('noData')}
                  </Box>
                }
              />
            )}
          </Container>
        </ColumnLayout>

        {/* Detailed Daily Log Table */}
        <Table
          header={<Header variant="h2">{t('dailyTrend')} - Detail</Header>}
          columnDefinitions={dailyLogColumnDefinitions}
          items={dailyUsage}
          loading={isLoadingDaily}
          loadingText={tCommon('loading')}
          sortingDisabled
          empty={
            <Box textAlign="center" color="inherit">
              {tCommon('noData')}
            </Box>
          }
        />

        {/* Projected Monthly Usage LineChart */}
        <Container header={<Header variant="h2">{t('projectedUsage')}</Header>}>
          {isLoadingForecast ? (
            <Box textAlign="center" color="text-status-inactive" padding="l">
              {tCommon('loading')}
            </Box>
          ) : (
            <LineChart
              series={forecastLineSeries}
              xDomain={
                forecast?.forecast
                  ? [
                      new Date(forecast.forecast[0]?.date ?? new Date()),
                      new Date(forecast.forecast[forecast.forecast.length - 1]?.date ?? new Date()),
                    ]
                  : undefined
              }
              yDomain={[0, MONTHLY_LIMIT]}
              xTitle={tCommon('date')}
              yTitle="Tokens"
              xScaleType="time"
              hideFilter
              height={300}
              empty={
                <Box textAlign="center" color="inherit">
                  {tCommon('noData')}
                </Box>
              }
            />
          )}
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}

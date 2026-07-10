'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Container,
  ContentLayout,
  DateRangePicker,
  Header,
  Select,
  SpaceBetween,
  Spinner,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useTeamMembers } from '@/hooks/usePromotion';
import {
  usePerformanceSummary,
  generatePerformanceSummary,
  type PerformanceSummary,
} from '@/hooks/usePerformance';
import { getAuthUser, type AuthUser } from '@/lib/auth';

export default function PerformancePage() {
  const t = useTranslations('performance');
  const tCommon = useTranslations('common');

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSummary, setGeneratedSummary] = useState<PerformanceSummary | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const { users, isLoading: isLoadingUsers } = useTeamMembers();
  const { summary: existingSummary, isLoading: isLoadingSummary } =
    usePerformanceSummary(selectedUserId);

  // Fetch auth user on mount
  useEffect(() => {
    getAuthUser()
      .then((user) => {
        setAuthUser(user);
      })
      .catch(() => {
        // Auth error handled by layout
      });
  }, []);

  const userOptions = users.map((u) => ({
    label: u.name || u.email,
    value: u.userId,
    description: u.email,
  }));

  const selectedOption = userOptions.find((o) => o.value === selectedUserId) || null;

  // Use generated summary if available, otherwise fall back to existing
  const displaySummary = generatedSummary || existingSummary;

  const handleGenerate = async () => {
    if (!selectedUserId || !dateRange) return;

    setIsGenerating(true);
    setGenerateError(null);
    try {
      const result = await generatePerformanceSummary(
        selectedUserId,
        dateRange.startDate,
        dateRange.endDate
      );
      setGeneratedSummary(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate summary';
      setGenerateError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportPdf = () => {
    window.print();
  };

  // Only Manager/Admin can access this page
  if (authUser && authUser.role === 'Employee') {
    return (
      <ContentLayout header={<Header variant="h1">{t('title')}</Header>}>
        <Box textAlign="center" color="text-status-error">
          {tCommon('error')}
        </Box>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout header={<Header variant="h1">{t('title')}</Header>}>
      <SpaceBetween size="l">
        {/* Team Member Selector */}
        <Container header={<Header variant="h2">{t('teamMembers')}</Header>}>
          <SpaceBetween size="m">
            <Select
              selectedOption={selectedOption}
              onChange={({ detail }: { detail: { selectedOption: { value?: string } } }) => {
                setSelectedUserId(detail.selectedOption.value || null);
                setGeneratedSummary(null);
                setGenerateError(null);
              }}
              options={userOptions}
              placeholder={t('selectEmployee')}
              loading={isLoadingUsers}
              filteringType="auto"
            />
          </SpaceBetween>
        </Container>

        {/* Date Range Picker and Generate */}
        {selectedUserId && (
          <Container header={<Header variant="h2">{t('period')}</Header>}>
            <SpaceBetween size="m">
              <DateRangePicker
                onChange={({ detail }: { detail: { value: { type: string; startDate?: string; endDate?: string } | null } }) => {
                  if (detail.value && detail.value.type === 'absolute') {
                    setDateRange({
                      startDate: detail.value.startDate!,
                      endDate: detail.value.endDate!,
                    });
                  }
                }}
                value={
                  dateRange
                    ? {
                        type: 'absolute',
                        startDate: dateRange.startDate,
                        endDate: dateRange.endDate,
                      }
                    : null
                }
                relativeOptions={[
                  { key: 'last-month', amount: 1, unit: 'month', type: 'relative' },
                  { key: 'last-3-months', amount: 3, unit: 'month', type: 'relative' },
                  { key: 'last-6-months', amount: 6, unit: 'month', type: 'relative' },
                  { key: 'last-year', amount: 1, unit: 'year', type: 'relative' },
                ]}
                isValidRange={() => ({ valid: true })}
                i18nStrings={{
                  todayAriaLabel: 'Today',
                  nextMonthAriaLabel: 'Next month',
                  previousMonthAriaLabel: 'Previous month',
                  customRelativeRangeDurationLabel: 'Duration',
                  customRelativeRangeDurationPlaceholder: 'Enter duration',
                  customRelativeRangeOptionLabel: 'Custom range',
                  customRelativeRangeOptionDescription: 'Set a custom range in the past',
                  customRelativeRangeUnitLabel: 'Unit of time',
                  formatRelativeRange: (e: { amount: number; unit: string }) => {
                    const unit = e.amount === 1 ? e.unit : `${e.unit}s`;
                    return `Last ${e.amount} ${unit}`;
                  },
                  formatUnit: (unit: string, value: number) => (value === 1 ? unit : `${unit}s`),
                  relativeModeTitle: 'Relative range',
                  absoluteModeTitle: 'Absolute range',
                  relativeRangeSelectionHeading: 'Choose a range',
                  startDateLabel: 'Start date',
                  endDateLabel: 'End date',
                  startTimeLabel: 'Start time',
                  endTimeLabel: 'End time',
                  clearButtonLabel: 'Clear',
                  cancelButtonLabel: 'Cancel',
                  applyButtonLabel: 'Apply',
                }}
                placeholder={t('selectPeriod')}
              />

              <SpaceBetween direction="horizontal" size="s">
                <Button
                  variant="primary"
                  onClick={handleGenerate}
                  loading={isGenerating}
                  disabled={!dateRange || isGenerating}
                >
                  {isGenerating ? t('generating') : t('generateSummary')}
                </Button>

                {displaySummary && (
                  <Button onClick={handleExportPdf} iconName="download">
                    {t('exportPdf')}
                  </Button>
                )}
              </SpaceBetween>
            </SpaceBetween>
          </Container>
        )}

        {/* Loading state */}
        {isLoadingSummary && selectedUserId && (
          <Box textAlign="center">
            <Spinner size="large" />
          </Box>
        )}

        {/* Generation error */}
        {generateError && (
          <Box color="text-status-error">{generateError}</Box>
        )}

        {/* Performance Summary Display */}
        {displaySummary && (
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">{t('highlights')}</Header>}>
              <Box variant="p">{displaySummary.highlights}</Box>
            </Container>

            <Container header={<Header variant="h2">{t('achievements')}</Header>}>
              <Box variant="p">{displaySummary.achievements}</Box>
            </Container>

            <Container header={<Header variant="h2">{t('areasForImprovement')}</Header>}>
              <Box variant="p">{displaySummary.improvements}</Box>
            </Container>

            <Container
              header={<Header variant="h2">{t('developmentRecommendations')}</Header>}
            >
              <Box variant="p">{displaySummary.recommendations}</Box>
            </Container>
          </SpaceBetween>
        )}

        {/* No summary state */}
        {!isLoadingSummary && !displaySummary && selectedUserId && !isGenerating && (
          <Box textAlign="center" color="text-status-inactive">
            {t('noSummary')}
          </Box>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}

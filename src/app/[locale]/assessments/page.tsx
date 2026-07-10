'use client';

import React, { useState } from 'react';
import {
  Table,
  Header,
  Pagination,
  SpaceBetween,
  Button,
  StatusIndicator,
  Box,
  Link,
  DateRangePicker,
  DateRangePickerProps,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAssessmentList, AssessmentListItem } from '@/hooks/useAssessments';

export default function AssessmentsPage() {
  const t = useTranslations('assessments');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [dateRange, setDateRange] = useState<DateRangePickerProps.Value | null>(null);

  const { assessments, totalCount, isLoading, isError } = useAssessmentList(currentPage, pageSize);

  const getScoreIndicator = (score: number) => {
    if (score >= 80) {
      return <StatusIndicator type="success">{score}</StatusIndicator>;
    } else if (score >= 60) {
      return <StatusIndicator type="warning">{score}</StatusIndicator>;
    } else {
      return <StatusIndicator type="error">{score}</StatusIndicator>;
    }
  };

  const getDifficultyLabel = (difficulty: string) => {
    switch (difficulty) {
      case 'Beginner':
        return t('difficultyBeginner');
      case 'Intermediate':
        return t('difficultyIntermediate');
      case 'Advanced':
        return t('difficultyAdvanced');
      default:
        return difficulty;
    }
  };

  const columnDefinitions = [
    {
      id: 'topic',
      header: t('topic'),
      cell: (item: AssessmentListItem) => (
        <Link onFollow={() => router.push(`assessments/${item.assessmentId}`)}>
          {item.topic}
        </Link>
      ),
      sortingField: 'topic',
    },
    {
      id: 'difficulty',
      header: t('difficulty'),
      cell: (item: AssessmentListItem) => getDifficultyLabel(item.difficulty),
      sortingField: 'difficulty',
    },
    {
      id: 'score',
      header: t('score'),
      cell: (item: AssessmentListItem) => getScoreIndicator(item.score),
      sortingField: 'score',
    },
    {
      id: 'date',
      header: tCommon('date'),
      cell: (item: AssessmentListItem) =>
        new Date(item.createdAt).toLocaleDateString(),
      sortingField: 'createdAt',
    },
    {
      id: 'actions',
      header: tCommon('actions'),
      cell: (item: AssessmentListItem) => (
        <Button
          variant="inline-link"
          onClick={() => router.push(`assessments/${item.assessmentId}`)}
        >
          {tCommon('edit')}
        </Button>
      ),
    },
  ];

  return (
    <SpaceBetween size="l">
      <Table
        columnDefinitions={columnDefinitions}
        items={assessments}
        loading={isLoading}
        loadingText={tCommon('loading')}
        empty={
          <Box textAlign="center" color="inherit">
            <b>{t('noAssessments')}</b>
          </Box>
        }
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  variant="primary"
                  onClick={() => router.push('assessments/new')}
                >
                  {t('newAssessment')}
                </Button>
              </SpaceBetween>
            }
            counter={`(${totalCount})`}
          >
            {t('title')}
          </Header>
        }
        filter={
          <DateRangePicker
            onChange={({ detail }) => setDateRange(detail.value)}
            value={dateRange}
            relativeOptions={[
              { key: 'last-7-days', amount: 7, unit: 'day', type: 'relative' },
              { key: 'last-30-days', amount: 30, unit: 'day', type: 'relative' },
              { key: 'last-90-days', amount: 90, unit: 'day', type: 'relative' },
            ]}
            placeholder={tCommon('filter')}
            i18nStrings={{
              todayAriaLabel: 'Today',
              nextMonthAriaLabel: 'Next month',
              previousMonthAriaLabel: 'Previous month',
              customRelativeRangeDurationLabel: 'Duration',
              customRelativeRangeDurationPlaceholder: 'Enter duration',
              customRelativeRangeOptionLabel: 'Custom range',
              customRelativeRangeOptionDescription: 'Set a custom range in the past',
              customRelativeRangeUnitLabel: 'Unit of time',
              formatRelativeRange: (e) => `Last ${e.amount} ${e.unit}s`,
              formatUnit: (e, n) => (n === 1 ? e : `${e}s`),
              relativeModeTitle: 'Relative range',
              absoluteModeTitle: 'Absolute range',
              relativeRangeSelectionHeading: 'Choose a range',
              startDateLabel: 'Start date',
              endDateLabel: 'End date',
              startTimeLabel: 'Start time',
              endTimeLabel: 'End time',
              clearButtonLabel: 'Clear',
              cancelButtonLabel: tCommon('cancel'),
              applyButtonLabel: 'Apply',
            }}
          />
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={Math.ceil(totalCount / pageSize) || 1}
            onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
          />
        }
      />
    </SpaceBetween>
  );
}

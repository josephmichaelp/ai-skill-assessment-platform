'use client';

import React from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  StatusIndicator,
  ProgressBar,
  ExpandableSection,
  Box,
  ColumnLayout,
  KeyValuePairs,
  Spinner,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { useAssignment } from '@/hooks/useAssignments';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AssignmentDetailPage() {
  const t = useTranslations('assignments');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const { assignment, isLoading, isError } = useAssignment(id);

  const getStatusIndicator = (status: string) => {
    switch (status) {
      case 'pending':
        return <StatusIndicator type="loading">{t('statusPending')}</StatusIndicator>;
      case 'processing':
        return <StatusIndicator type="loading">{t('statusProcessing')}</StatusIndicator>;
      case 'completed':
        return <StatusIndicator type="success">{t('statusCompleted')}</StatusIndicator>;
      case 'failed':
        return <StatusIndicator type="error">{t('statusFailed')}</StatusIndicator>;
      default:
        return <StatusIndicator type="info">{status}</StatusIndicator>;
    }
  };

  if (isLoading) {
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
      </Box>
    );
  }

  if (isError || !assignment) {
    return (
      <Box textAlign="center" padding="xxl">
        <StatusIndicator type="error">{tCommon('error')}</StatusIndicator>
      </Box>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <Button variant="link" onClick={() => router.push('/assignments')}>
            {tCommon('back')}
          </Button>
        }
      >
        {assignment.fileName}
      </Header>

      {/* File metadata */}
      <Container header={<Header variant="h2">{t('fileType')}</Header>}>
        <ColumnLayout columns={4} variant="text-grid">
          <KeyValuePairs
            items={[
              { label: t('fileName'), value: assignment.fileName },
              { label: t('fileType'), value: assignment.fileType },
              { label: t('fileSize'), value: formatFileSize(assignment.fileSizeBytes) },
              { label: tCommon('status'), value: getStatusIndicator(assignment.status) },
              {
                label: t('uploadDate'),
                value: new Date(assignment.createdAt).toLocaleDateString(),
              },
            ]}
          />
        </ColumnLayout>
      </Container>

      {/* Quality Score */}
      {assignment.review && (
        <Container header={<Header variant="h2">{t('qualityScore')}</Header>}>
          <SpaceBetween size="l">
            <ProgressBar
              value={assignment.review.qualityScore}
              label={t('qualityScore')}
              description={`${assignment.review.qualityScore} / 100`}
              variant="standalone"
            />
          </SpaceBetween>
        </Container>
      )}

      {/* Expandable sections for review details */}
      {assignment.review && (
        <SpaceBetween size="m">
          <ExpandableSection
            headerText={t('strengths')}
            defaultExpanded
          >
            <SpaceBetween size="xs">
              {assignment.review.strengths.map((strength, index) => (
                <Box key={index} variant="p">
                  • {strength}
                </Box>
              ))}
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection
            headerText={t('weaknesses')}
            defaultExpanded
          >
            <SpaceBetween size="xs">
              {assignment.review.weaknesses.map((weakness, index) => (
                <Box key={index} variant="p">
                  • {weakness}
                </Box>
              ))}
            </SpaceBetween>
          </ExpandableSection>

          <ExpandableSection
            headerText={t('improvements')}
            defaultExpanded
          >
            <SpaceBetween size="xs">
              {assignment.review.recommendations.map((rec, index) => (
                <Box key={index} variant="p">
                  • {rec}
                </Box>
              ))}
            </SpaceBetween>
          </ExpandableSection>
        </SpaceBetween>
      )}

      {/* Show processing indicator if still pending/processing */}
      {(assignment.status === 'pending' || assignment.status === 'processing') && (
        <Container>
          <Box textAlign="center" padding="l">
            <SpaceBetween size="m" alignItems="center">
              <Spinner size="large" />
              <Box variant="p" color="text-body-secondary">
                {t('reviewing')}
              </Box>
            </SpaceBetween>
          </Box>
        </Container>
      )}
    </SpaceBetween>
  );
}

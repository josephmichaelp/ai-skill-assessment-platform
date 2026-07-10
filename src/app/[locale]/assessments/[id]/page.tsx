'use client';

import React from 'react';
import {
  Box,
  BarChart,
  Button,
  ColumnLayout,
  Container,
  ExpandableSection,
  Header,
  SpaceBetween,
  StatusIndicator,
  Spinner,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { useAssessment } from '@/hooks/useAssessments';
import { useGapAnalysis } from '@/hooks/useGapAnalysis';

function getScoreStatus(score: number): 'success' | 'warning' | 'error' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'error';
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#037f0c';
  if (score >= 60) return '#d97706';
  return '#d91515';
}

export default function AssessmentResultPage() {
  const t = useTranslations('assessments');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const params = useParams();
  const assessmentId = params.id as string;

  const { assessment, isLoading, isError } = useAssessment(assessmentId);
  const { gapAnalysis, isLoading: isGapLoading } = useGapAnalysis(assessmentId);

  if (isLoading) {
    return (
      <Box textAlign="center" padding="xxl">
        <Spinner size="large" />
        <Box padding={{ top: 's' }}>{tCommon('loading')}</Box>
      </Box>
    );
  }

  if (isError || !assessment) {
    return (
      <Box textAlign="center" padding="xxl">
        <StatusIndicator type="error">{tCommon('error')}</StatusIndicator>
      </Box>
    );
  }

  const competencyChartData = Object.entries(assessment.competencyScores || {}).map(
    ([topic, score]) => ({
      x: topic,
      y: score,
    })
  );

  return (
    <SpaceBetween size="l">
      {/* Back button */}
      <Button
        variant="link"
        iconName="arrow-left"
        onClick={() => router.push('../assessments')}
      >
        {tCommon('back')}
      </Button>

      {/* Score Header */}
      <Container
        header={
          <Header variant="h1">{t('results')}</Header>
        }
      >
        <ColumnLayout columns={3} variant="text-grid">
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">{t('overallScore')}</Box>
            <Box variant="h1" fontSize="display-l" color={getScoreColor(assessment.score)}>
              {assessment.score}
              <Box variant="span" fontSize="heading-m" color="text-status-inactive">
                /100
              </Box>
            </Box>
            <StatusIndicator type={getScoreStatus(assessment.score)}>
              {assessment.score >= 80
                ? 'Excellent'
                : assessment.score >= 60
                ? 'Good'
                : 'Needs Improvement'}
            </StatusIndicator>
          </SpaceBetween>

          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">{t('topic')}</Box>
            <Box variant="p">{assessment.topic}</Box>
            <Box variant="awsui-key-label">{t('difficulty')}</Box>
            <Box variant="p">{assessment.difficulty}</Box>
          </SpaceBetween>

          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">{tCommon('date')}</Box>
            <Box variant="p">
              {new Date(assessment.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Box>
            <Box variant="awsui-key-label">{t('questions')}</Box>
            <Box variant="p">{assessment.questionCount}</Box>
          </SpaceBetween>
        </ColumnLayout>
      </Container>

      {/* Competency Scores Bar Chart */}
      {competencyChartData.length > 0 && (
        <Container
          header={<Header variant="h2">{t('competencyScores')}</Header>}
        >
          <BarChart
            series={[
              {
                title: t('score'),
                type: 'bar',
                data: competencyChartData,
              },
            ]}
            xDomain={competencyChartData.map((d) => d.x)}
            yDomain={[0, 100]}
            xTitle={t('topic')}
            yTitle={t('score')}
            height={300}
            hideFilter
            ariaLabel={t('competencyScores')}
            empty={
              <Box textAlign="center" color="inherit">
                {tCommon('noData')}
              </Box>
            }
          />
        </Container>
      )}

      {/* Per-Question Feedback Accordion */}
      <Container
        header={
          <Header variant="h2" counter={`(${assessment.questions.length})`}>
            {t('feedback')}
          </Header>
        }
      >
        <SpaceBetween size="s">
          {assessment.questions.map((question, index) => {
            const answer = assessment.answers.find(
              (a) => a.questionId === question.questionId
            );
            const feedback = assessment.feedback.find(
              (f) => f.questionId === question.questionId
            );
            const isCorrect = answer?.isCorrect ?? false;

            return (
              <ExpandableSection
                key={question.questionId}
                headerText={`${index + 1}. ${question.text}`}
                headerDescription={
                  <StatusIndicator type={isCorrect ? 'success' : 'error'}>
                    {isCorrect ? 'Correct' : 'Incorrect'}
                  </StatusIndicator>
                }
                variant="container"
              >
                <SpaceBetween size="m">
                  <ColumnLayout columns={2}>
                    <SpaceBetween size="xs">
                      <Box variant="awsui-key-label">{t('yourAnswer')}</Box>
                      <Box
                        variant="p"
                        color={isCorrect ? 'text-status-success' : 'text-status-error'}
                      >
                        {answer?.userAnswer || '-'}
                      </Box>
                    </SpaceBetween>
                    <SpaceBetween size="xs">
                      <Box variant="awsui-key-label">{t('correctAnswer')}</Box>
                      <Box variant="p" color="text-status-success">
                        {question.correctAnswer}
                      </Box>
                    </SpaceBetween>
                  </ColumnLayout>

                  {feedback && (
                    <SpaceBetween size="xs">
                      <Box variant="awsui-key-label">{t('explanation')}</Box>
                      <Box variant="p">{feedback.explanation}</Box>
                    </SpaceBetween>
                  )}
                </SpaceBetween>
              </ExpandableSection>
            );
          })}
        </SpaceBetween>
      </Container>

      {/* Gap Analysis and Recommendations */}
      <Container
        header={
          <Header variant="h2">
            {t('skillGaps')} & {t('recommendations')}
          </Header>
        }
      >
        {isGapLoading ? (
          <Box textAlign="center" padding="l">
            <Spinner size="normal" />
            <Box padding={{ top: 'xs' }}>{tCommon('loading')}</Box>
          </Box>
        ) : gapAnalysis && gapAnalysis.gaps.length > 0 ? (
          <SpaceBetween size="l">
            {/* Gap visualization */}
            <BarChart
              series={[
                {
                  title: t('gapMagnitude'),
                  type: 'bar',
                  data: gapAnalysis.gaps.map((gap) => ({
                    x: gap.topic,
                    y: gap.magnitude,
                  })),
                },
              ]}
              xDomain={gapAnalysis.gaps.map((g) => g.topic)}
              yDomain={[0, 100]}
              xTitle={t('topic')}
              yTitle={t('gapMagnitude')}
              height={250}
              hideFilter
              ariaLabel={t('skillGaps')}
            />

            {/* Recommendations */}
            {gapAnalysis.recommendations.length > 0 && (
              <SpaceBetween size="s">
                <Header variant="h3">{t('recommendations')}</Header>
                {gapAnalysis.recommendations.map((rec, index) => (
                  <Container key={index}>
                    <SpaceBetween size="xs">
                      <Box fontWeight="bold">{rec.topic}</Box>
                      <Box variant="p">{rec.recommendation}</Box>
                    </SpaceBetween>
                  </Container>
                ))}
              </SpaceBetween>
            )}
          </SpaceBetween>
        ) : (
          <Box textAlign="center" color="text-status-inactive" padding="l">
            {tCommon('noData')}
          </Box>
        )}
      </Container>
    </SpaceBetween>
  );
}

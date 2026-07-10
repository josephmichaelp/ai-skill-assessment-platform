'use client';

import React, { useState } from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  RadioGroup,
  Textarea,
  ProgressBar,
  Box,
  StatusIndicator,
  FormField,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { useAssessment } from '@/hooks/useAssessments';
import { apiPost } from '@/lib/api-client';

export default function QuizPage() {
  const t = useTranslations('assessments');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const params = useParams();
  const assessmentId = params.id as string;

  const { assessment, isLoading } = useAssessment(assessmentId);

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Box textAlign="center" padding="xxl">
        <StatusIndicator type="loading">{tCommon('loading')}</StatusIndicator>
      </Box>
    );
  }

  if (!assessment || !assessment.questions || assessment.questions.length === 0) {
    return (
      <Box textAlign="center" padding="xxl">
        <StatusIndicator type="loading">{t('generating')}</StatusIndicator>
      </Box>
    );
  }

  const questions = assessment.questions;
  const totalQuestions = questions.length;
  const currentQuestion = questions[currentQuestionIndex];
  const progressPercentage = ((currentQuestionIndex + 1) / totalQuestions) * 100;

  const handleAnswerChange = (value: string) => {
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.questionId]: value,
    }));
  };

  const handleNext = () => {
    if (currentQuestionIndex < totalQuestions - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      await apiPost('/assessments/submit', {
        assessmentId,
        answers: Object.entries(answers).map(([questionId, userAnswer]) => ({
          questionId,
          userAnswer,
        })),
      });

      router.push(`/assessments/${assessmentId}`);
    } catch (err: any) {
      setError(err.message || tCommon('error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;
  const currentAnswer = answers[currentQuestion.questionId] || '';

  const renderQuestionInput = () => {
    switch (currentQuestion.type) {
      case 'multiple_choice':
        return (
          <RadioGroup
            onChange={({ detail }) => handleAnswerChange(detail.value)}
            value={currentAnswer}
            items={
              currentQuestion.options?.map((option, index) => ({
                value: option,
                label: option,
              })) ?? []
            }
          />
        );

      case 'true_false':
        return (
          <RadioGroup
            onChange={({ detail }) => handleAnswerChange(detail.value)}
            value={currentAnswer}
            items={[
              { value: 'true', label: tCommon('yes') },
              { value: 'false', label: tCommon('no') },
            ]}
          />
        );

      case 'short_answer':
        return (
          <Textarea
            value={currentAnswer}
            onChange={({ detail }) => handleAnswerChange(detail.value)}
            placeholder={t('yourAnswer')}
            rows={4}
          />
        );

      default:
        return null;
    }
  };

  const getQuestionTypeLabel = () => {
    switch (currentQuestion.type) {
      case 'multiple_choice':
        return t('multipleChoice');
      case 'true_false':
        return t('trueFalse');
      case 'short_answer':
        return t('shortAnswer');
      default:
        return '';
    }
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1">
        {assessment.topic} - {assessment.difficulty}
      </Header>

      <ProgressBar
        value={progressPercentage}
        label={t('questionOf', {
          current: currentQuestionIndex + 1,
          total: totalQuestions,
        })}
      />

      <Container
        header={
          <Header
            variant="h2"
            description={getQuestionTypeLabel()}
          >
            {t('questionOf', {
              current: currentQuestionIndex + 1,
              total: totalQuestions,
            })}
          </Header>
        }
      >
        <SpaceBetween size="l">
          <FormField label={currentQuestion.text}>
            {renderQuestionInput()}
          </FormField>

          {error && (
            <StatusIndicator type="error">{error}</StatusIndicator>
          )}

          <SpaceBetween direction="horizontal" size="xs">
            <Button
              onClick={handlePrevious}
              disabled={currentQuestionIndex === 0}
            >
              {tCommon('back')}
            </Button>

            {isLastQuestion ? (
              <Button
                variant="primary"
                onClick={handleSubmit}
                loading={isSubmitting}
                disabled={Object.keys(answers).length < totalQuestions}
              >
                {t('submitAnswers')}
              </Button>
            ) : (
              <Button variant="primary" onClick={handleNext}>
                {tCommon('next')}
              </Button>
            )}
          </SpaceBetween>

          {isSubmitting && (
            <StatusIndicator type="loading">
              {t('evaluating')}
            </StatusIndicator>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}

'use client';

import React, { useState } from 'react';
import {
  Form,
  FormField,
  Select,
  Button,
  SpaceBetween,
  Header,
  Container,
  StatusIndicator,
  Input,
  SelectProps,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api-client';

export default function NewAssessmentPage() {
  const t = useTranslations('assessments');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<SelectProps.Option | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const difficultyOptions: SelectProps.Options = [
    { label: t('difficultyBeginner'), value: 'Beginner' },
    { label: t('difficultyIntermediate'), value: 'Intermediate' },
    { label: t('difficultyAdvanced'), value: 'Advanced' },
  ];

  const handleGenerate = async () => {
    if (!topic.trim() || !difficulty) return;

    setIsGenerating(true);
    setError(null);

    try {
      const data = await apiPost('/assessments/generate', {
        topic: topic.trim(),
        difficulty: difficulty.value,
      });

      router.push(`assessments/${data.assessmentId}/quiz`);
    } catch (err: any) {
      setError(err.message || tCommon('error'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{t('newAssessment')}</Header>

      <Container>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => router.back()}>
                {tCommon('cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleGenerate}
                loading={isGenerating}
                disabled={!topic.trim() || !difficulty}
              >
                {t('startQuiz')}
              </Button>
            </SpaceBetween>
          }
          errorText={error}
        >
          <SpaceBetween size="l">
            <FormField label={t('topic')} description={t('selectTopic')}>
              <Input
                value={topic}
                onChange={({ detail }) => setTopic(detail.value)}
                placeholder={t('selectTopic')}
                disabled={isGenerating}
              />
            </FormField>

            <FormField label={t('difficulty')} description={t('selectDifficulty')}>
              <Select
                selectedOption={difficulty}
                onChange={({ detail }) => setDifficulty(detail.selectedOption)}
                options={difficultyOptions}
                placeholder={t('selectDifficulty')}
                disabled={isGenerating}
              />
            </FormField>

            {isGenerating && (
              <StatusIndicator type="loading">
                {t('generating')}
              </StatusIndicator>
            )}
          </SpaceBetween>
        </Form>
      </Container>
    </SpaceBetween>
  );
}

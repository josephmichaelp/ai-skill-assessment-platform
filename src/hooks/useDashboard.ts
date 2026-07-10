'use client';

import useSWR from 'swr';
import { swrFetcher } from '@/lib/api-client';

interface AssessmentRecord {
  assessmentId: string;
  topic: string;
  difficulty: string;
  score: number;
  questionCount: number;
  createdAt: string;
}

interface AssessmentsResponse {
  items: AssessmentRecord[];
  lastEvaluatedKey?: string;
}

export function useLatestAssessment() {
  const { data, error, isLoading } = useSWR<AssessmentsResponse>(
    '/assessments?limit=1',
    swrFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    latestAssessment: data?.items?.[0] ?? null,
    isLoading,
    error,
  };
}

export function useRecentAssessments() {
  const { data, error, isLoading } = useSWR<AssessmentsResponse>(
    '/assessments?limit=10',
    swrFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    assessments: data?.items ?? [],
    isLoading,
    error,
  };
}

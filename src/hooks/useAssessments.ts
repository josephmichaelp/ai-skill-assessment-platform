'use client';

import useSWR from 'swr';
import { swrFetcher } from '@/lib/api-client';

export interface AssessmentListItem {
  assessmentId: string;
  topic: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  score: number;
  questionCount: number;
  createdAt: string;
}

export interface AssessmentListResponse {
  items: AssessmentListItem[];
  totalCount: number;
  lastEvaluatedKey?: string;
}

export interface AssessmentDetail {
  assessmentId: string;
  topic: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  score: number;
  questionCount: number;
  questions: Array<{
    questionId: string;
    text: string;
    type: 'multiple_choice' | 'true_false' | 'short_answer';
    options?: string[];
    correctAnswer: string;
  }>;
  answers: Array<{
    questionId: string;
    userAnswer: string;
    isCorrect: boolean;
  }>;
  feedback: Array<{
    questionId: string;
    explanation: string;
    correctAnswer: string;
  }>;
  competencyScores: Record<string, number>;
  createdAt: string;
}

export function useAssessmentList(page: number = 1, limit: number = 10) {
  const offset = (page - 1) * limit;
  const { data, error, isLoading, mutate } = useSWR<AssessmentListResponse>(
    `/assessments?limit=${limit}&offset=${offset}`,
    swrFetcher
  );

  return {
    assessments: data?.items ?? [],
    totalCount: data?.totalCount ?? 0,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export function useAssessment(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<AssessmentDetail>(
    id ? `/assessments/${id}` : null,
    swrFetcher
  );

  return {
    assessment: data,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

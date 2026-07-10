'use client';

import useSWR from 'swr';
import { swrFetcher } from '@/lib/api-client';

export interface GapItem {
  topic: string;
  currentScore: number;
  requiredScore: number;
  magnitude: number;
}

export interface GapRecommendation {
  topic: string;
  recommendation: string;
}

export interface GapAnalysisResponse {
  gaps: GapItem[];
  recommendations: GapRecommendation[];
}

export function useGapAnalysis(assessmentId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<GapAnalysisResponse>(
    assessmentId ? `/assessments/gap-analysis?assessmentId=${assessmentId}` : null,
    swrFetcher
  );

  return {
    gapAnalysis: data ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

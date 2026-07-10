'use client';

import useSWR from 'swr';
import { swrFetcher, apiPost } from '@/lib/api-client';

export interface PerformanceSummary {
  userId: string;
  period: {
    startDate: string;
    endDate: string;
  };
  highlights: string;
  achievements: string;
  improvements: string;
  recommendations: string;
  generatedAt: string;
}

export function usePerformanceSummary(userId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<PerformanceSummary>(
    userId ? `/performance/${userId}` : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    summary: data ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export async function generatePerformanceSummary(
  userId: string,
  startDate: string,
  endDate: string
): Promise<PerformanceSummary> {
  return apiPost<PerformanceSummary>(`/performance/${userId}/generate`, {
    startDate,
    endDate,
  });
}

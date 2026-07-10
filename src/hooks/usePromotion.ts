'use client';

import useSWR from 'swr';
import { swrFetcher } from '@/lib/api-client';

export interface CompetencyGap {
  topic: string;
  currentScore: number;
  requiredScore: number;
  gap: number;
  weight: number;
}

export interface PromotionScorecard {
  userId: string;
  readinessScore: number;
  targetPosition: string;
  competencyScores: Record<string, number>;
  competencyGaps: CompetencyGap[];
  insights: string;
  recommendations: string[];
  updatedAt: string;
}

export interface CompetencyTimelineEntry {
  date: string;
  topic: string;
  score: number;
}

export interface CompetencyTimeline {
  entries: CompetencyTimelineEntry[];
}

export interface UserListItem {
  userId: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Employee';
}

export interface UsersListResponse {
  items: UserListItem[];
  totalCount: number;
}

export function usePromotionScorecard(userId: string | null) {
  const { data, error, isLoading } = useSWR<PromotionScorecard>(
    userId ? `/promotion/${userId}` : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    scorecard: data ?? null,
    isLoading,
    isError: !!error,
    error,
  };
}

export function usePromotionHistory(userId: string | null) {
  const { data, error, isLoading } = useSWR<CompetencyTimeline>(
    userId ? `/promotion/${userId}/history` : null,
    swrFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    timeline: data ?? null,
    isLoading,
    isError: !!error,
    error,
  };
}

export function useTeamMembers() {
  const { data, error, isLoading } = useSWR<UsersListResponse>(
    '/users',
    swrFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  return {
    users: data?.items ?? [],
    isLoading,
    isError: !!error,
    error,
  };
}

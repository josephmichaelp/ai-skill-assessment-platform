'use client';

import useSWR from 'swr';
import { swrFetcher, apiPost, apiPut } from '@/lib/api-client';

export interface CompetencyRequirement {
  topic: string;
  requiredScore: number;
  weight: number;
}

export interface PositionItem {
  positionId: string;
  title: string;
  competencyRequirements: CompetencyRequirement[];
  createdAt: string;
  updatedAt: string;
}

export interface PositionsResponse {
  items: PositionItem[];
  totalCount: number;
  lastEvaluatedKey?: string;
}

export interface CreatePositionPayload {
  title: string;
  competencyRequirements: CompetencyRequirement[];
}

export interface UpdatePositionPayload {
  title?: string;
  competencyRequirements?: CompetencyRequirement[];
}

export function usePositions(page: number = 1, limit: number = 10) {
  const offset = (page - 1) * limit;
  const { data, error, isLoading, mutate } = useSWR<PositionsResponse>(
    `/positions?limit=${limit}&offset=${offset}`,
    swrFetcher
  );

  return {
    positions: data?.items ?? [],
    totalCount: data?.totalCount ?? 0,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export async function createPosition(payload: CreatePositionPayload) {
  return apiPost<PositionItem>('/positions', payload);
}

export async function updatePosition(positionId: string, payload: UpdatePositionPayload) {
  return apiPut<PositionItem>(`/positions/${positionId}`, payload);
}

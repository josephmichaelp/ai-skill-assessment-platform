'use client';

import useSWR from 'swr';
import { swrFetcher } from '@/lib/api-client';

export interface TokenUsageOverview {
  totalTokensUsed: number;
  monthlyTokenLimit: number;
  percentageUsed: number;
  daysRemainingInMonth: number;
  novaLiteTokensUsed: number;
  novaLiteInputTokens: number;
  novaLiteOutputTokens: number;
  cohereEmbedTokensUsed: number;
  breakdownByFeature: Record<string, number>;
  breakdownByModel: {
    'amazon.nova-lite-v1:0': { input: number; output: number; total: number };
    'cohere.embed-multilingual-v3': { input: number; output: number; total: number };
  };
}

export interface DailyUsageEntry {
  date: string;
  totalTokens: number;
  novaLiteTokens: number;
  cohereEmbedTokens: number;
  breakdownByFeature: Record<string, number>;
  breakdownByModel: Record<string, number>;
}

export interface DailyUsageResponse {
  items: DailyUsageEntry[];
}

export interface ForecastEntry {
  date: string;
  projectedTokens: number;
  actualTokens?: number;
}

export interface ForecastResponse {
  projectedMonthlyTotal: number;
  dailyAverage: number;
  forecast: ForecastEntry[];
}

export function useTokenUsage() {
  const { data, error, isLoading, mutate } = useSWR<TokenUsageOverview>(
    '/admin/token-usage',
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    usage: data,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export function useDailyTokenUsage() {
  const { data, error, isLoading } = useSWR<DailyUsageResponse>(
    '/admin/token-usage/daily',
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    dailyUsage: data?.items ?? [],
    isLoading,
    isError: !!error,
    error,
  };
}

export function useTokenUsageForecast() {
  const { data, error, isLoading } = useSWR<ForecastResponse>(
    '/admin/token-usage/forecast',
    swrFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  return {
    forecast: data,
    isLoading,
    isError: !!error,
    error,
  };
}

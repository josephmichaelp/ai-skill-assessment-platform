'use client';

import useSWR from 'swr';
import { swrFetcher, apiPost } from '@/lib/api-client';

export interface RoleplayMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface RoleplayEvaluation {
  communicationScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  overallFeedback: string;
}

export interface RoleplaySession {
  sessionId: string;
  scenarioType: 'Customer' | 'Interviewer' | 'Manager' | 'DifficultCustomer';
  scenarioContext: string;
  objectives: string[];
  status: 'active' | 'completed';
  messages: RoleplayMessage[];
  evaluation?: RoleplayEvaluation;
  createdAt: string;
  completedAt?: string;
}

export interface StartSessionRequest {
  scenarioType: 'Customer' | 'Interviewer' | 'Manager' | 'DifficultCustomer';
}

export interface StartSessionResponse {
  sessionId: string;
  scenarioContext: string;
  objectives: string[];
}

export interface SendMessageResponse {
  message: RoleplayMessage;
}

export interface EndSessionResponse {
  evaluation: RoleplayEvaluation;
}

export function useRoleplaySession(sessionId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<RoleplaySession>(
    sessionId ? `/roleplay/${sessionId}` : null,
    swrFetcher,
    {
      refreshInterval: 0,
      revalidateOnFocus: false,
    }
  );

  return {
    session: data ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export async function startRoleplaySession(
  scenarioType: StartSessionRequest['scenarioType']
): Promise<StartSessionResponse> {
  return apiPost<StartSessionResponse>('/roleplay/start', { scenarioType });
}

export async function sendRoleplayMessage(
  sessionId: string,
  content: string
): Promise<SendMessageResponse> {
  return apiPost<SendMessageResponse>(`/roleplay/${sessionId}/message`, {
    content,
  });
}

export async function endRoleplaySession(
  sessionId: string
): Promise<EndSessionResponse> {
  return apiPost<EndSessionResponse>(`/roleplay/${sessionId}/end`, {});
}

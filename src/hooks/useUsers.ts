'use client';

import useSWR from 'swr';
import { swrFetcher, apiPost, apiPut } from '@/lib/api-client';

export interface UserItem {
  userId: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Employee';
  createdAt: string;
  updatedAt: string;
}

export interface UsersResponse {
  items: UserItem[];
  totalCount: number;
  lastEvaluatedKey?: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Employee';
}

export interface UpdateUserPayload {
  role: 'Admin' | 'Manager' | 'Employee';
}

export function useUsers(page: number = 1, limit: number = 10) {
  const offset = (page - 1) * limit;
  const { data, error, isLoading, mutate } = useSWR<UsersResponse>(
    `/users?limit=${limit}&offset=${offset}`,
    swrFetcher
  );

  return {
    users: data?.items ?? [],
    totalCount: data?.totalCount ?? 0,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export async function createUser(payload: CreateUserPayload) {
  return apiPost<UserItem>('/users', payload);
}

export async function updateUser(userId: string, payload: UpdateUserPayload) {
  return apiPut<UserItem>(`/users/${userId}`, payload);
}

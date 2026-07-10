'use client';

import useSWR from 'swr';
import { swrFetcher, apiPost } from '@/lib/api-client';

export interface AssignmentListItem {
  assignmentId: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface AssignmentListResponse {
  items: AssignmentListItem[];
  totalCount: number;
  lastEvaluatedKey?: string;
}

export interface AssignmentReview {
  qualityScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

export interface AssignmentDetail {
  assignmentId: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  s3Key: string;
  review?: AssignmentReview;
  createdAt: string;
  completedAt?: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  assignmentId: string;
  s3Key: string;
}

export function useAssignmentList(page: number = 1, limit: number = 10) {
  const offset = (page - 1) * limit;
  const { data, error, isLoading, mutate } = useSWR<AssignmentListResponse>(
    `/assignments?limit=${limit}&offset=${offset}`,
    swrFetcher
  );

  return {
    assignments: data?.items ?? [],
    totalCount: data?.totalCount ?? 0,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export function useAssignment(id: string | null) {
  const { data, error, isLoading, mutate } = useSWR<AssignmentDetail>(
    id ? `/assignments/${id}` : null,
    swrFetcher
  );

  return {
    assignment: data,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export async function requestUploadUrl(
  fileName: string,
  fileType: string,
  fileSizeBytes: number
): Promise<UploadUrlResponse> {
  return apiPost<UploadUrlResponse>('/assignments/upload-url', {
    fileName,
    fileType,
    fileSizeBytes,
  });
}

export async function uploadFileToS3(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload failed due to network error'));
    xhr.send(file);
  });
}

export async function triggerAssignmentReview(assignmentId: string): Promise<void> {
  await apiPost('/assignments/review', { assignmentId });
}

'use client';

import React, { useState } from 'react';
import {
  Table,
  Header,
  Pagination,
  SpaceBetween,
  Button,
  StatusIndicator,
  Box,
  Link,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useAssignmentList, AssignmentListItem } from '@/hooks/useAssignments';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AssignmentsPage() {
  const t = useTranslations('assignments');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const { assignments, totalCount, isLoading } = useAssignmentList(currentPage, pageSize);

  const getStatusIndicator = (status: AssignmentListItem['status']) => {
    switch (status) {
      case 'pending':
        return <StatusIndicator type="loading">{t('statusPending')}</StatusIndicator>;
      case 'processing':
        return <StatusIndicator type="loading">{t('statusProcessing')}</StatusIndicator>;
      case 'completed':
        return <StatusIndicator type="success">{t('statusCompleted')}</StatusIndicator>;
      case 'failed':
        return <StatusIndicator type="error">{t('statusFailed')}</StatusIndicator>;
      default:
        return <StatusIndicator type="info">{status}</StatusIndicator>;
    }
  };

  const columnDefinitions = [
    {
      id: 'fileName',
      header: t('fileName'),
      cell: (item: AssignmentListItem) => (
        <Link onFollow={() => router.push(`assignments/${item.assignmentId}`)}>
          {item.fileName}
        </Link>
      ),
      sortingField: 'fileName',
    },
    {
      id: 'fileType',
      header: t('fileType'),
      cell: (item: AssignmentListItem) => item.fileType,
      sortingField: 'fileType',
    },
    {
      id: 'fileSize',
      header: t('fileSize'),
      cell: (item: AssignmentListItem) => formatFileSize(item.fileSizeBytes),
      sortingField: 'fileSizeBytes',
    },
    {
      id: 'status',
      header: tCommon('status'),
      cell: (item: AssignmentListItem) => getStatusIndicator(item.status),
      sortingField: 'status',
    },
    {
      id: 'date',
      header: tCommon('date'),
      cell: (item: AssignmentListItem) =>
        new Date(item.createdAt).toLocaleDateString(),
      sortingField: 'createdAt',
    },
    {
      id: 'actions',
      header: tCommon('actions'),
      cell: (item: AssignmentListItem) => (
        <Button
          variant="inline-link"
          onClick={() => router.push(`assignments/${item.assignmentId}`)}
        >
          {tCommon('edit')}
        </Button>
      ),
    },
  ];

  return (
    <SpaceBetween size="l">
      <Table
        columnDefinitions={columnDefinitions}
        items={assignments}
        loading={isLoading}
        loadingText={tCommon('loading')}
        empty={
          <Box textAlign="center" color="inherit">
            <b>{t('noAssignments')}</b>
          </Box>
        }
        header={
          <Header
            variant="h1"
            actions={
              <Button
                variant="primary"
                onClick={() => router.push('assignments/upload')}
              >
                {t('upload')}
              </Button>
            }
            counter={`(${totalCount})`}
          >
            {t('title')}
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={Math.ceil(totalCount / pageSize) || 1}
            onChange={({ detail }: { detail: { currentPageIndex: number } }) =>
              setCurrentPage(detail.currentPageIndex)
            }
          />
        }
      />
    </SpaceBetween>
  );
}

'use client';

import React, { useState } from 'react';
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  FileUpload,
  Alert,
  ProgressBar,
  Box,
  FormField,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  requestUploadUrl,
  uploadFileToS3,
  triggerAssignmentReview,
} from '@/hooks/useAssignments';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/javascript',
  'text/typescript',
  'application/javascript',
  'application/json',
  'text/html',
  'text/css',
  'text/x-python',
  'text/x-java',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
];

type UploadStep = 'select' | 'uploading' | 'reviewing' | 'complete' | 'error';

export default function AssignmentUploadPage() {
  const t = useTranslations('assignments');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [fileSizeError, setFileSizeError] = useState<string | null>(null);
  const [step, setStep] = useState<UploadStep>('select');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);

  const handleFileChange = (selectedFiles: File[]) => {
    setFileSizeError(null);
    setErrorMessage(null);

    if (selectedFiles.length > 0) {
      const file = selectedFiles[0];
      if (file.size > MAX_FILE_SIZE_BYTES) {
        setFileSizeError(t('fileTooLarge'));
        setFiles([]);
        return;
      }
    }

    setFiles(selectedFiles);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleFileUploadChange = ({ detail }: { detail: any }) => {
    handleFileChange(detail.value as File[]);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    const file = files[0];

    try {
      // Step 1: Get presigned URL
      setStep('uploading');
      setUploadProgress(0);

      const { uploadUrl, assignmentId: newAssignmentId } = await requestUploadUrl(
        file.name,
        file.type || 'application/octet-stream',
        file.size
      );

      setAssignmentId(newAssignmentId);

      // Step 2: Upload to S3
      await uploadFileToS3(uploadUrl, file, (percent) => {
        setUploadProgress(percent);
      });

      // Step 3: Trigger review
      setStep('reviewing');
      await triggerAssignmentReview(newAssignmentId);

      // Done
      setStep('complete');
    } catch (error) {
      setStep('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'An unexpected error occurred'
      );
    }
  };

  const handleViewResult = () => {
    if (assignmentId) {
      router.push(`/assignments/${assignmentId}`);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setFileSizeError(null);
    setStep('select');
    setUploadProgress(0);
    setErrorMessage(null);
    setAssignmentId(null);
  };

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <Button variant="link" onClick={() => router.push('/assignments')}>
            {tCommon('back')}
          </Button>
        }
      >
        {t('upload')}
      </Header>

      <Container header={<Header variant="h2">{t('uploadDescription')}</Header>}>
        <SpaceBetween size="l">
          {step === 'select' && (
            <>
              <FormField
                description={t('supportedFormats')}
                constraintText={t('maxFileSize')}
                errorText={fileSizeError ?? undefined}
              >
                <FileUpload
                  onChange={handleFileUploadChange}
                  value={files}
                  i18nStrings={{
                    uploadButtonText: (multiple: boolean) =>
                      multiple ? 'Choose files' : 'Choose file',
                    dropzoneText: (multiple: boolean) =>
                      multiple ? 'Drop files to upload' : 'Drop file to upload',
                    removeFileAriaLabel: (fileIndex: number) =>
                      `Remove file ${fileIndex + 1}`,
                    limitShowFewer: 'Show fewer files',
                    limitShowMore: 'Show more files',
                    errorIconAriaLabel: 'Error',
                  }}
                  showFileLastModified
                  showFileSize
                  showFileThumbnail
                  constraintText={t('maxFileSize')}
                  accept={ALLOWED_FILE_TYPES.join(',')}
                />
              </FormField>

              <Button
                variant="primary"
                onClick={handleUpload}
                disabled={files.length === 0 || !!fileSizeError}
              >
                {t('triggerReview')}
              </Button>
            </>
          )}

          {step === 'uploading' && (
            <SpaceBetween size="m">
              <ProgressBar
                value={uploadProgress}
                label={t('upload')}
                description={`${uploadProgress}%`}
              />
            </SpaceBetween>
          )}

          {step === 'reviewing' && (
            <SpaceBetween size="m">
              <ProgressBar
                value={100}
                variant="flash"
                label={t('reviewing')}
                resultText={t('reviewing')}
              />
              <Box color="text-body-secondary">{t('reviewing')}</Box>
            </SpaceBetween>
          )}

          {step === 'complete' && (
            <SpaceBetween size="m">
              <Alert type="success">{t('reviewComplete')}</Alert>
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={handleViewResult}>
                  {tCommon('edit')}
                </Button>
                <Button onClick={handleReset}>{t('upload')}</Button>
              </SpaceBetween>
            </SpaceBetween>
          )}

          {step === 'error' && (
            <SpaceBetween size="m">
              <Alert type="error">{errorMessage}</Alert>
              <Button onClick={handleReset}>{tCommon('retry')}</Button>
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}

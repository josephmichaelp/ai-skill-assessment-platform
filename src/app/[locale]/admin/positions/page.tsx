'use client';

import React, { useState } from 'react';
import {
  Table,
  Header,
  Pagination,
  SpaceBetween,
  Button,
  Box,
  Modal,
  FormField,
  Input,
  Form,
  Alert,
  ExpandableSection,
  ColumnLayout,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import {
  usePositions,
  createPosition,
  updatePosition,
  PositionItem,
  CompetencyRequirement,
  CreatePositionPayload,
} from '@/hooks/usePositions';

export default function AdminPositionsPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const { positions, totalCount, isLoading, mutate } = usePositions(currentPage, pageSize);

  // Modal state
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingPosition, setEditingPosition] = useState<PositionItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formCompetencies, setFormCompetencies] = useState<CompetencyRequirement[]>([
    { topic: '', requiredScore: 0, weight: 0 },
  ]);

  const resetForm = () => {
    setFormTitle('');
    setFormCompetencies([{ topic: '', requiredScore: 0, weight: 0 }]);
    setErrorMessage('');
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateModalVisible(true);
  };

  const handleOpenEdit = (position: PositionItem) => {
    setEditingPosition(position);
    setFormTitle(position.title);
    setFormCompetencies(
      position.competencyRequirements.length > 0
        ? [...position.competencyRequirements]
        : [{ topic: '', requiredScore: 0, weight: 0 }]
    );
    setErrorMessage('');
    setIsEditModalVisible(true);
  };

  const addCompetency = () => {
    setFormCompetencies([...formCompetencies, { topic: '', requiredScore: 0, weight: 0 }]);
  };

  const removeCompetency = (index: number) => {
    setFormCompetencies(formCompetencies.filter((_, i) => i !== index));
  };

  const updateCompetency = (index: number, field: keyof CompetencyRequirement, value: string | number) => {
    const updated = [...formCompetencies];
    if (field === 'topic') {
      updated[index] = { ...updated[index], topic: value as string };
    } else if (field === 'requiredScore') {
      updated[index] = { ...updated[index], requiredScore: Number(value) };
    } else if (field === 'weight') {
      updated[index] = { ...updated[index], weight: Number(value) };
    }
    setFormCompetencies(updated);
  };

  const validateWeights = (): boolean => {
    const validCompetencies = formCompetencies.filter((c) => c.topic.trim() !== '');
    if (validCompetencies.length === 0) return true;
    const sum = validCompetencies.reduce((acc, c) => acc + c.weight, 0);
    return Math.abs(sum - 1.0) < 0.001;
  };

  const handleCreatePosition = async () => {
    if (!formTitle.trim()) {
      setErrorMessage('Please enter a position title.');
      return;
    }

    const validCompetencies = formCompetencies.filter((c) => c.topic.trim() !== '');
    if (!validateWeights()) {
      setErrorMessage(t('weightSumError'));
      return;
    }

    setIsSaving(true);
    setErrorMessage('');
    try {
      const payload: CreatePositionPayload = {
        title: formTitle,
        competencyRequirements: validCompetencies,
      };
      await createPosition(payload);
      await mutate();
      setIsCreateModalVisible(false);
      resetForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create position';
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdatePosition = async () => {
    if (!editingPosition || !formTitle.trim()) {
      setErrorMessage('Please enter a position title.');
      return;
    }

    const validCompetencies = formCompetencies.filter((c) => c.topic.trim() !== '');
    if (!validateWeights()) {
      setErrorMessage(t('weightSumError'));
      return;
    }

    setIsSaving(true);
    setErrorMessage('');
    try {
      await updatePosition(editingPosition.positionId, {
        title: formTitle,
        competencyRequirements: validCompetencies,
      });
      await mutate();
      setIsEditModalVisible(false);
      setEditingPosition(null);
      resetForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update position';
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const competencyFormFields = (
    <SpaceBetween size="m">
      {formCompetencies.map((comp, index) => (
        <ExpandableSection
          key={index}
          headerText={comp.topic || `Competency ${index + 1}`}
          defaultExpanded={true}
        >
          <ColumnLayout columns={3}>
            <FormField label={t('competencyRequirements')}>
              <Input
                value={comp.topic}
                onChange={({ detail }) => updateCompetency(index, 'topic', detail.value)}
                placeholder="e.g. Leadership"
              />
            </FormField>
            <FormField label={t('requiredScore')}>
              <Input
                value={String(comp.requiredScore)}
                onChange={({ detail }) => updateCompetency(index, 'requiredScore', detail.value)}
                type="number"
              />
            </FormField>
            <FormField label={t('weight')}>
              <SpaceBetween direction="horizontal" size="xs">
                <Input
                  value={String(comp.weight)}
                  onChange={({ detail }) => updateCompetency(index, 'weight', detail.value)}
                  type="number"
                />
                {formCompetencies.length > 1 && (
                  <Button
                    variant="icon"
                    iconName="remove"
                    onClick={() => removeCompetency(index)}
                    ariaLabel={`Remove competency ${index + 1}`}
                  />
                )}
              </SpaceBetween>
            </FormField>
          </ColumnLayout>
        </ExpandableSection>
      ))}
      <Button iconName="add-plus" onClick={addCompetency}>
        {t('addCompetency')}
      </Button>
    </SpaceBetween>
  );

  const columnDefinitions = [
    {
      id: 'title',
      header: t('positionTitle'),
      cell: (item: PositionItem) => item.title,
      sortingField: 'title',
    },
    {
      id: 'competencies',
      header: t('competencyRequirements'),
      cell: (item: PositionItem) => `${item.competencyRequirements.length} competencies`,
    },
    {
      id: 'date',
      header: tCommon('date'),
      cell: (item: PositionItem) => new Date(item.createdAt).toLocaleDateString(),
      sortingField: 'createdAt',
    },
    {
      id: 'actions',
      header: tCommon('actions'),
      cell: (item: PositionItem) => (
        <Button variant="inline-link" onClick={() => handleOpenEdit(item)}>
          {tCommon('edit')}
        </Button>
      ),
    },
  ];

  // Nested competency requirements table for expandable row detail
  const renderCompetencyTable = (position: PositionItem) => (
    <Table
      columnDefinitions={[
        {
          id: 'topic',
          header: 'Topic',
          cell: (item: CompetencyRequirement) => item.topic,
        },
        {
          id: 'requiredScore',
          header: t('requiredScore'),
          cell: (item: CompetencyRequirement) => item.requiredScore,
        },
        {
          id: 'weight',
          header: t('weight'),
          cell: (item: CompetencyRequirement) => item.weight.toFixed(2),
        },
      ]}
      items={position.competencyRequirements}
      variant="embedded"
      empty={
        <Box textAlign="center" color="inherit">
          No competency requirements
        </Box>
      }
    />
  );

  return (
    <SpaceBetween size="l">
      <Table
        columnDefinitions={columnDefinitions}
        items={positions}
        loading={isLoading}
        loadingText={tCommon('loading')}
        empty={
          <Box textAlign="center" color="inherit">
            <b>{t('noPositions')}</b>
          </Box>
        }
        header={
          <Header
            variant="h1"
            actions={
              <Button variant="primary" onClick={handleOpenCreate}>
                {t('createPosition')}
              </Button>
            }
            counter={`(${totalCount})`}
          >
            {t('positionConfig')}
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={Math.ceil(totalCount / pageSize) || 1}
            onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
          />
        }
      />

      {/* Competency detail sections per position */}
      {positions.map((position) => (
        <ExpandableSection
          key={position.positionId}
          headerText={`${position.title} - ${t('competencyRequirements')}`}
        >
          {renderCompetencyTable(position)}
        </ExpandableSection>
      ))}

      {/* Create Position Modal */}
      <Modal
        visible={isCreateModalVisible}
        onDismiss={() => setIsCreateModalVisible(false)}
        header={t('createPosition')}
        size="large"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setIsCreateModalVisible(false)}>
                {tCommon('cancel')}
              </Button>
              <Button variant="primary" onClick={handleCreatePosition} loading={isSaving}>
                {tCommon('create')}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Form>
          <SpaceBetween size="l">
            {errorMessage && <Alert type="error">{errorMessage}</Alert>}
            <FormField label={t('positionTitle')}>
              <Input
                value={formTitle}
                onChange={({ detail }) => setFormTitle(detail.value)}
                placeholder={t('positionTitle')}
              />
            </FormField>
            {competencyFormFields}
          </SpaceBetween>
        </Form>
      </Modal>

      {/* Edit Position Modal */}
      <Modal
        visible={isEditModalVisible}
        onDismiss={() => setIsEditModalVisible(false)}
        header={t('editPosition')}
        size="large"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setIsEditModalVisible(false)}>
                {tCommon('cancel')}
              </Button>
              <Button variant="primary" onClick={handleUpdatePosition} loading={isSaving}>
                {tCommon('save')}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Form>
          <SpaceBetween size="l">
            {errorMessage && <Alert type="error">{errorMessage}</Alert>}
            <FormField label={t('positionTitle')}>
              <Input
                value={formTitle}
                onChange={({ detail }) => setFormTitle(detail.value)}
                placeholder={t('positionTitle')}
              />
            </FormField>
            {competencyFormFields}
          </SpaceBetween>
        </Form>
      </Modal>
    </SpaceBetween>
  );
}

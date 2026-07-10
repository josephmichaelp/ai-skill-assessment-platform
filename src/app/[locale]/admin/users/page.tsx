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
  Select,
  Form,
  Alert,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import {
  useUsers,
  createUser,
  updateUser,
  UserItem,
  CreateUserPayload,
} from '@/hooks/useUsers';

type RoleOption = { label: string; value: 'Admin' | 'Manager' | 'Employee' };

export default function AdminUsersPage() {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const { users, totalCount, isLoading, mutate } = useUsers(currentPage, pageSize);

  // Modal state
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<RoleOption | null>(null);

  const roleOptions: RoleOption[] = [
    { label: t('roleAdmin'), value: 'Admin' },
    { label: t('roleManager'), value: 'Manager' },
    { label: t('roleEmployee'), value: 'Employee' },
  ];

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormRole(null);
    setErrorMessage('');
  };

  const handleOpenCreate = () => {
    resetForm();
    setIsCreateModalVisible(true);
  };

  const handleOpenEdit = (user: UserItem) => {
    setEditingUser(user);
    setFormRole(roleOptions.find((r) => r.value === user.role) || null);
    setErrorMessage('');
    setIsEditModalVisible(true);
  };

  const handleCreateUser = async () => {
    if (!formName || !formEmail || !formRole) {
      setErrorMessage('Please fill in all fields.');
      return;
    }

    setIsSaving(true);
    setErrorMessage('');
    try {
      const payload: CreateUserPayload = {
        name: formName,
        email: formEmail,
        role: formRole.value,
      };
      await createUser(payload);
      await mutate();
      setIsCreateModalVisible(false);
      resetForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create user';
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!editingUser || !formRole) {
      setErrorMessage('Please select a role.');
      return;
    }

    setIsSaving(true);
    setErrorMessage('');
    try {
      await updateUser(editingUser.userId, { role: formRole.value });
      await mutate();
      setIsEditModalVisible(false);
      setEditingUser(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update user';
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const columnDefinitions = [
    {
      id: 'name',
      header: t('userName'),
      cell: (item: UserItem) => item.name,
      sortingField: 'name',
    },
    {
      id: 'email',
      header: t('userEmail'),
      cell: (item: UserItem) => item.email,
      sortingField: 'email',
    },
    {
      id: 'role',
      header: t('userRole'),
      cell: (item: UserItem) => {
        const roleLabel = roleOptions.find((r) => r.value === item.role);
        return roleLabel?.label ?? item.role;
      },
      sortingField: 'role',
    },
    {
      id: 'date',
      header: tCommon('date'),
      cell: (item: UserItem) => new Date(item.createdAt).toLocaleDateString(),
      sortingField: 'createdAt',
    },
    {
      id: 'actions',
      header: tCommon('actions'),
      cell: (item: UserItem) => (
        <Button variant="inline-link" onClick={() => handleOpenEdit(item)}>
          {tCommon('edit')}
        </Button>
      ),
    },
  ];

  return (
    <SpaceBetween size="l">
      <Table
        columnDefinitions={columnDefinitions}
        items={users}
        loading={isLoading}
        loadingText={tCommon('loading')}
        empty={
          <Box textAlign="center" color="inherit">
            <b>{t('noUsers')}</b>
          </Box>
        }
        header={
          <Header
            variant="h1"
            actions={
              <Button variant="primary" onClick={handleOpenCreate}>
                {t('createUser')}
              </Button>
            }
            counter={`(${totalCount})`}
          >
            {t('userManagement')}
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

      {/* Create User Modal */}
      <Modal
        visible={isCreateModalVisible}
        onDismiss={() => setIsCreateModalVisible(false)}
        header={t('createUser')}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={() => setIsCreateModalVisible(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateUser}
                loading={isSaving}
              >
                {tCommon('create')}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Form>
          <SpaceBetween size="m">
            {errorMessage && <Alert type="error">{errorMessage}</Alert>}
            <FormField label={t('userName')}>
              <Input
                value={formName}
                onChange={({ detail }) => setFormName(detail.value)}
                placeholder={t('userName')}
              />
            </FormField>
            <FormField label={t('userEmail')}>
              <Input
                value={formEmail}
                onChange={({ detail }) => setFormEmail(detail.value)}
                placeholder={t('userEmail')}
              />
            </FormField>
            <FormField label={t('userRole')}>
              <Select
                selectedOption={formRole}
                onChange={({ detail }) =>
                  setFormRole(detail.selectedOption as RoleOption)
                }
                options={roleOptions}
                placeholder={t('userRole')}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        visible={isEditModalVisible}
        onDismiss={() => setIsEditModalVisible(false)}
        header={t('editUser')}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={() => setIsEditModalVisible(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleUpdateUser}
                loading={isSaving}
              >
                {tCommon('save')}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Form>
          <SpaceBetween size="m">
            {errorMessage && <Alert type="error">{errorMessage}</Alert>}
            {editingUser && (
              <>
                <FormField label={t('userName')}>
                  <Input value={editingUser.name} disabled />
                </FormField>
                <FormField label={t('userEmail')}>
                  <Input value={editingUser.email} disabled />
                </FormField>
              </>
            )}
            <FormField label={t('userRole')}>
              <Select
                selectedOption={formRole}
                onChange={({ detail }) =>
                  setFormRole(detail.selectedOption as RoleOption)
                }
                options={roleOptions}
                placeholder={t('userRole')}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      </Modal>
    </SpaceBetween>
  );
}

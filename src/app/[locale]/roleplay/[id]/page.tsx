'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Button,
  Container,
  ContentLayout,
  Header,
  Input,
  SpaceBetween,
  Spinner,
  StatusIndicator,
  Tabs,
} from '@cloudscape-design/components';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import {
  useRoleplaySession,
  sendRoleplayMessage,
  endRoleplaySession,
  RoleplayMessage,
  RoleplayEvaluation,
} from '@/hooks/useRoleplay';

export default function RoleplaySessionPage() {
  const t = useTranslations('roleplay');
  const tCommon = useTranslations('common');
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const { session, isLoading, mutate } = useRoleplaySession(sessionId);
  const [messageInput, setMessageInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session?.messages]);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || isSending) return;

    const content = messageInput.trim();
    setMessageInput('');
    setIsSending(true);
    setError(null);

    // Optimistically add the user message
    if (session) {
      const optimisticMessage: RoleplayMessage = {
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      mutate(
        {
          ...session,
          messages: [...session.messages, optimisticMessage],
        },
        false
      );
    }

    try {
      await sendRoleplayMessage(sessionId, content);
      // Revalidate to get the AI response
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setIsSending(false);
    }
  };

  const handleEndSession = async () => {
    setIsEnding(true);
    setError(null);

    try {
      await endRoleplaySession(sessionId);
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setIsEnding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (isLoading) {
    return (
      <ContentLayout header={<Header variant="h1">{t('title')}</Header>}>
        <Container>
          <Box textAlign="center" padding="xxl">
            <Spinner size="large" />
            <Box variant="p" margin={{ top: 's' }}>
              {tCommon('loading')}
            </Box>
          </Box>
        </Container>
      </ContentLayout>
    );
  }

  if (!session) {
    return (
      <ContentLayout header={<Header variant="h1">{t('title')}</Header>}>
        <Container>
          <Box textAlign="center" padding="xxl">
            <StatusIndicator type="error">
              {tCommon('error')}
            </StatusIndicator>
          </Box>
        </Container>
      </ContentLayout>
    );
  }

  // Show evaluation if session is completed
  if (session.status === 'completed' && session.evaluation) {
    return (
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <Button onClick={() => router.push('../roleplay')}>
                {tCommon('back')}
              </Button>
            }
          >
            {t('evaluation')}
          </Header>
        }
      >
        <SpaceBetween size="l">
          <RoleplayEvaluationDisplay
            evaluation={session.evaluation}
            t={t}
          />
        </SpaceBetween>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <StatusIndicator type="success">
                {t('sessionActive')}
              </StatusIndicator>
              <Button
                variant="primary"
                onClick={handleEndSession}
                loading={isEnding}
                disabled={isSending}
              >
                {t('endSession')}
              </Button>
            </SpaceBetween>
          }
        >
          {t('title')}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* Scenario Context */}
        <Container
          header={<Header variant="h3">{t('objectives')}</Header>}
        >
          <SpaceBetween size="xs">
            <Box variant="p">{session.scenarioContext}</Box>
            <Box variant="small">
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {session.objectives.map((obj, idx) => (
                  <li key={idx}>{obj}</li>
                ))}
              </ul>
            </Box>
          </SpaceBetween>
        </Container>

        {/* Chat Messages */}
        <Container>
          <div
            style={{
              maxHeight: '400px',
              overflowY: 'auto',
              padding: '16px 0',
            }}
          >
            <SpaceBetween size="m">
              {session.messages.map((msg, idx) => (
                <MessageBubble key={idx} message={msg} />
              ))}
              {isSending && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Spinner size="normal" />
                  <Box variant="small" color="text-status-inactive">
                    {t('streaming')}
                  </Box>
                </div>
              )}
              <div ref={messagesEndRef} />
            </SpaceBetween>
          </div>
        </Container>

        {/* Message Input */}
        {error && (
          <StatusIndicator type="error">{error}</StatusIndicator>
        )}

        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input
              value={messageInput}
              onChange={({ detail }: { detail: { value: string } }) => setMessageInput(detail.value)}
              onKeyDown={(e: CustomEvent) => handleKeyDown(e as unknown as React.KeyboardEvent)}
              placeholder={t('typeMessage')}
              disabled={isSending || isEnding}
            />
          </div>
          <Button
            variant="primary"
            onClick={handleSendMessage}
            loading={isSending}
            disabled={!messageInput.trim() || isEnding}
          >
            {t('send')}
          </Button>
        </div>
      </SpaceBetween>
    </ContentLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Bubble Component
// ─────────────────────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: RoleplayMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '12px 16px',
          borderRadius: '12px',
          backgroundColor: isUser ? '#0972d3' : '#f2f3f3',
          color: isUser ? '#ffffff' : '#000716',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
      >
        <Box variant="p" color="inherit">
          {message.content}
        </Box>
        <Box
          variant="small"
          color="inherit"
          float="right"
        >
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Box>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation Display Component (Task 16.3)
// ─────────────────────────────────────────────────────────────────────────────

function RoleplayEvaluationDisplay({
  evaluation,
  t,
}: {
  evaluation: RoleplayEvaluation;
  t: (key: string) => string;
}) {
  const getScoreType = (
    score: number
  ): 'success' | 'warning' | 'error' => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'warning';
    return 'error';
  };

  return (
    <SpaceBetween size="l">
      {/* Communication Score */}
      <Container
        header={<Header variant="h2">{t('communicationScore')}</Header>}
      >
        <Box textAlign="center" padding="l">
          <Box variant="h1" fontSize="display-l">
            {evaluation.communicationScore}
          </Box>
          <Box margin={{ top: 'xs' }}>
            <StatusIndicator type={getScoreType(evaluation.communicationScore)}>
              / 100
            </StatusIndicator>
          </Box>
        </Box>
      </Container>

      {/* Tabbed Strengths / Weaknesses / Recommendations */}
      <Container>
        <Tabs
          tabs={[
            {
              label: t('strengths'),
              id: 'strengths',
              content: (
                <Box padding="s">
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {evaluation.strengths.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '8px' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Box>
              ),
            },
            {
              label: t('weaknesses'),
              id: 'weaknesses',
              content: (
                <Box padding="s">
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {evaluation.weaknesses.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '8px' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Box>
              ),
            },
            {
              label: t('overallFeedback'),
              id: 'recommendations',
              content: (
                <Box padding="s">
                  <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                    {evaluation.recommendations.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '8px' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </Box>
              ),
            },
          ]}
        />
      </Container>

      {/* Overall Feedback */}
      <Container
        header={<Header variant="h3">{t('overallFeedback')}</Header>}
      >
        <Box variant="p">{evaluation.overallFeedback}</Box>
      </Container>
    </SpaceBetween>
  );
}

/**
 * Roleplay Handler Lambda
 * Handles AI roleplay simulation sessions: start, message exchange, and session end with evaluation.
 *
 * REST Routes:
 * - POST /roleplay/start        → startSession (any authenticated user)
 * - GET  /roleplay/{id}         → getSession (any authenticated user, own org only)
 * - POST /roleplay/{id}/message → sendMessage (task 8.2)
 * - POST /roleplay/{id}/end     → endSession (placeholder for task 8.3)
 *
 * WebSocket Routes:
 * - $connect    → handleWebSocketConnect
 * - $disconnect → handleWebSocketDisconnect
 * - sendMessage → handleWebSocketMessage (streaming)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 11.5
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { extractClaims, assertOrgAccess } from '../shared/auth';
import { validateRequest, roleplayStartSchema, roleplayMessageSchema } from '../shared/validation';
import { putItem, getItem, updateItem, deleteItem } from '../shared/dynamo';
import { formatResponse, handleError } from '../shared/response';
import { invokeModel, invokeModelStreaming } from '../shared/bedrock-client';
import type { RoleplaySessionRecord, RoleplayMessage } from '../shared/types';

// Lazy-loaded WebSocket client to avoid import issues when SDK isn't bundled yet
let wsClientModule: typeof import('@aws-sdk/client-apigatewaymanagementapi') | null = null;
async function getWsClientModule() {
  if (!wsClientModule) {
    wsClientModule = await import('@aws-sdk/client-apigatewaymanagementapi');
  }
  return wsClientModule;
}

// ─── WebSocket Callback URL ────────────────────────────────────────────────────

const WEBSOCKET_CALLBACK_URL = process.env.WEBSOCKET_CALLBACK_URL || '';

// ─── Main Handler (Router) ─────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Check if this is a WebSocket event
    const eventType = (event.requestContext as unknown as Record<string, unknown>).eventType as string | undefined;
    if (eventType) {
      return await handleWebSocketEvent(event, eventType);
    }

    const method = event.httpMethod;
    const path = event.path;

    // POST /roleplay/start
    if (method === 'POST' && path === '/roleplay/start') {
      return await startSession(event);
    }

    // GET /roleplay/{id}
    if (method === 'GET' && path.match(/^\/roleplay\/[^/]+$/)) {
      return await getSession(event);
    }

    // POST /roleplay/{id}/message
    if (method === 'POST' && path.match(/^\/roleplay\/[^/]+\/message$/)) {
      return await sendMessage(event);
    }

    // POST /roleplay/{id}/end
    if (method === 'POST' && path.match(/^\/roleplay\/[^/]+\/end$/)) {
      return await endSession(event);
    }

    return formatResponse(404, { error: 'Route not found' });
  } catch (error) {
    return handleError(error);
  }
};

// ─── POST /roleplay/{id}/message (REST, non-streaming) ────────────────────────

/**
 * Handle a user message in a roleplay session via REST API.
 * Appends the user message, invokes Bedrock (non-streaming), appends AI response, and returns it.
 *
 * Requirements: 4.2, 4.3
 */
async function sendMessage(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Extract claims
  const claims = extractClaims(event);

  // 2. Validate request body
  const data = validateRequest(event, roleplayMessageSchema);

  // 3. Get session from DynamoDB
  const pk = `ORG#${claims.orgId}#USER#${claims.userId}`;
  const sk = `ROLEPLAY#${data.sessionId}`;

  const session = await getItem<RoleplaySessionRecord>(pk, sk);

  if (!session) {
    return formatResponse(404, { error: 'Roleplay session not found' });
  }

  // 4. Verify org access and session is active
  assertOrgAccess(claims, session.orgId);

  if (session.status !== 'active') {
    return formatResponse(400, { error: 'Session is not active. Cannot send messages to a completed session.' });
  }

  // 5. Append user message to the session's messages array
  const userMessage: RoleplayMessage = {
    role: 'user',
    content: data.message,
    timestamp: new Date().toISOString(),
  };

  const updatedMessages = [...session.messages, userMessage];

  // 6. Build Bedrock prompt with full conversation history
  const systemPrompt = buildRoleplaySystemPrompt(session);
  const userContent = buildConversationContext(updatedMessages);

  // 7. Invoke Bedrock (non-streaming for REST)
  const language = (session.scenarioType === 'Customer' || session.scenarioType === 'DifficultCustomer') ? 'id' : 'id';
  const result = await invokeModel({
    systemPrompt,
    userContent,
    language: language as 'id' | 'en',
    feature: 'roleplayTurn',
    orgId: claims.orgId,
  });

  // 8. Append AI response to messages array
  const assistantMessage: RoleplayMessage = {
    role: 'assistant',
    content: result.content,
    timestamp: new Date().toISOString(),
  };

  const finalMessages = [...updatedMessages, assistantMessage];

  // 9. Update session in DynamoDB
  await updateItem(pk, sk, {
    messages: finalMessages,
  });

  // 10. Return the AI response
  return formatResponse(200, {
    sessionId: session.sessionId,
    message: assistantMessage,
    messageCount: finalMessages.length,
    tokensUsed: {
      input: result.inputTokens,
      output: result.outputTokens,
      total: result.totalTokens,
    },
  });
}

// ─── POST /roleplay/{id}/end ────────────────────────────────────────────────────

/**
 * End a roleplay session and generate an AI evaluation of the participant's performance.
 * Uses Bedrock to analyze the full conversation and produce communication scores,
 * strengths, weaknesses, recommendations, and overall feedback.
 *
 * Requirements: 4.5, 4.6
 */
async function endSession(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Extract claims
  const claims = extractClaims(event);

  // 2. Get sessionId from path
  const pathParts = event.path.split('/');
  const sessionId = pathParts[pathParts.length - 2]; // /roleplay/{id}/end → {id}

  if (!sessionId) {
    return formatResponse(400, { error: 'Session ID is required' });
  }

  // 3. Get session from DynamoDB
  const pk = `ORG#${claims.orgId}#USER#${claims.userId}`;
  const sk = `ROLEPLAY#${sessionId}`;

  const session = await getItem<RoleplaySessionRecord>(pk, sk);

  if (!session) {
    return formatResponse(404, { error: 'Roleplay session not found' });
  }

  // 4. Verify org access and session is active
  assertOrgAccess(claims, session.orgId);

  if (session.status !== 'active') {
    return formatResponse(400, { error: 'Session is not active. Cannot end a session that is already completed.' });
  }

  if (session.messages.length === 0) {
    return formatResponse(400, { error: 'Cannot evaluate an empty session. Send at least one message before ending.' });
  }

  // 5. Build Bedrock prompt with full conversation history to generate evaluation
  const systemPrompt =
    'You are a communication skills evaluator. Based on the roleplay conversation, evaluate the participant\'s performance. ' +
    'Return JSON with: communicationScore (number 0-100), strengths (string array, at least 2 items), ' +
    'weaknesses (string array, at least 2 items), recommendations (string array, at least 2 items), ' +
    'overallFeedback (string paragraph). Do not include any other text outside the JSON object.';

  const conversationHistory = session.messages
    .map((msg) => {
      const roleLabel = msg.role === 'user' ? 'Participant' : 'Character';
      return `${roleLabel}: ${msg.content}`;
    })
    .join('\n\n');

  const userContent =
    `Scenario Type: ${session.scenarioType}\n` +
    `Scenario Context: ${session.scenarioContext}\n` +
    `Objectives: ${session.objectives.join('; ')}\n\n` +
    `Full Conversation:\n\n${conversationHistory}\n\n` +
    'Evaluate the participant\'s communication skills based on this conversation. ' +
    'Consider clarity, empathy, problem-solving, professionalism, and achievement of objectives. ' +
    'Return only valid JSON.';

  // 6. Invoke Bedrock, parse the evaluation JSON
  const result = await invokeModel({
    systemPrompt,
    userContent,
    language: 'id',
    feature: 'roleplayTurn',
    orgId: claims.orgId,
    maxOutputTokens: 1000,
  });

  let evaluation: import('../shared/types').RoleplayEvaluation;

  try {
    const jsonContent = extractJson(result.content);
    const parsed = JSON.parse(jsonContent);
    evaluation = {
      communicationScore: Math.max(0, Math.min(100, Number(parsed.communicationScore) || 0)),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : ['Good participation', 'Completed the session'],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : ['Could improve clarity', 'Could be more concise'],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : ['Practice active listening', 'Focus on structured responses'],
      overallFeedback: typeof parsed.overallFeedback === 'string' ? parsed.overallFeedback : 'Session completed successfully.',
    };
  } catch {
    // Fallback evaluation if Bedrock doesn't return valid JSON
    evaluation = {
      communicationScore: 50,
      strengths: ['Completed the roleplay session', 'Engaged with the scenario'],
      weaknesses: ['Evaluation could not be fully parsed', 'Consider retrying for detailed feedback'],
      recommendations: ['Practice more roleplay sessions', 'Focus on clear communication'],
      overallFeedback: 'The session was completed but the AI evaluation could not be fully generated. Please try again for a more detailed assessment.',
    };
  }

  // 7. Update session in DynamoDB: status='completed', evaluation, completedAt
  const completedAt = new Date().toISOString();

  await updateItem(pk, sk, {
    status: 'completed',
    evaluation,
    completedAt,
  });

  // 8. Return the evaluation
  return formatResponse(200, {
    sessionId,
    status: 'completed',
    evaluation,
    completedAt,
  });
}

// ─── WebSocket Event Handling ──────────────────────────────────────────────────

/**
 * Route WebSocket events to the appropriate handler.
 *
 * Requirements: 4.2, 11.5
 */
async function handleWebSocketEvent(event: APIGatewayProxyEvent, eventType: string): Promise<APIGatewayProxyResult> {
  const connectionId = (event.requestContext as unknown as Record<string, unknown>).connectionId as string;

  switch (eventType) {
    case 'CONNECT':
      return await handleWebSocketConnect(connectionId, event);
    case 'DISCONNECT':
      return await handleWebSocketDisconnect(connectionId);
    case 'MESSAGE':
      return await handleWebSocketMessage(connectionId, event);
    default:
      return { statusCode: 400, body: 'Unknown event type' };
  }
}

/**
 * Handle WebSocket $connect event.
 * Store the connectionId for later use.
 *
 * Requirement 11.5: WebSocket connection management.
 */
async function handleWebSocketConnect(connectionId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // The authorizer already validated the token on connect.
  // Store connectionId with user context from authorizer.
  const authorizer = (event.requestContext as unknown as Record<string, unknown>).authorizer as Record<string, unknown> | undefined;

  const userId = authorizer?.userId as string || '';
  const orgId = authorizer?.orgId as string || '';

  if (userId && orgId) {
    await putItem({
      PK: `WSCONN#${connectionId}`,
      SK: `WSCONN#${connectionId}`,
      orgId,
      userId,
      connectionId,
      connectedAt: new Date().toISOString(),
    });
  }

  return { statusCode: 200, body: 'Connected' };
}

/**
 * Handle WebSocket $disconnect event.
 * Clean up the stored connectionId.
 *
 * Requirement 11.5: WebSocket connection cleanup.
 */
async function handleWebSocketDisconnect(connectionId: string): Promise<APIGatewayProxyResult> {
  // Remove the connection record from DynamoDB
  await deleteItem(`WSCONN#${connectionId}`, `WSCONN#${connectionId}`);

  return { statusCode: 200, body: 'Disconnected' };
}

/**
 * Handle WebSocket sendMessage route.
 * Streams Bedrock response tokens back to the client in real time.
 *
 * Requirements: 4.2, 4.3, 11.5
 */
async function handleWebSocketMessage(connectionId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Parse the message body
  let messageBody: { sessionId: string; message: string; orgId: string; userId: string };

  try {
    messageBody = JSON.parse(event.body || '{}');
  } catch {
    await postToConnection(connectionId, JSON.stringify({ type: 'error', error: 'Invalid message format' }));
    return { statusCode: 400, body: 'Invalid message format' };
  }

  const { sessionId, message, orgId, userId } = messageBody;

  if (!sessionId || !message) {
    await postToConnection(connectionId, JSON.stringify({ type: 'error', error: 'sessionId and message are required' }));
    return { statusCode: 400, body: 'sessionId and message are required' };
  }

  // If orgId/userId not in message body, try to get from stored connection
  let resolvedOrgId = orgId;
  let resolvedUserId = userId;

  if (!resolvedOrgId || !resolvedUserId) {
    const connRecord = await getItem<{ orgId: string; userId: string }>(
      `WSCONN#${connectionId}`,
      `WSCONN#${connectionId}`
    );
    if (connRecord) {
      resolvedOrgId = resolvedOrgId || connRecord.orgId;
      resolvedUserId = resolvedUserId || connRecord.userId;
    }
  }

  if (!resolvedOrgId || !resolvedUserId) {
    await postToConnection(connectionId, JSON.stringify({ type: 'error', error: 'Unable to identify user' }));
    return { statusCode: 403, body: 'Unable to identify user' };
  }

  // 2. Get session from DynamoDB
  const pk = `ORG#${resolvedOrgId}#USER#${resolvedUserId}`;
  const sk = `ROLEPLAY#${sessionId}`;

  const session = await getItem<RoleplaySessionRecord>(pk, sk);

  if (!session) {
    await postToConnection(connectionId, JSON.stringify({ type: 'error', error: 'Session not found' }));
    return { statusCode: 404, body: 'Session not found' };
  }

  if (session.status !== 'active') {
    await postToConnection(connectionId, JSON.stringify({ type: 'error', error: 'Session is not active' }));
    return { statusCode: 400, body: 'Session is not active' };
  }

  // Append user message
  const userMessage: RoleplayMessage = {
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
  };

  const updatedMessages = [...session.messages, userMessage];

  // 3. Build prompt with full history
  const systemPrompt = buildRoleplaySystemPrompt(session);
  const userContent = buildConversationContext(updatedMessages);

  // Notify client that streaming is starting
  await postToConnection(connectionId, JSON.stringify({ type: 'stream_start', sessionId }));

  // 4. Invoke Bedrock streaming
  let fullResponse = '';

  try {
    const streamGenerator = invokeModelStreaming({
      systemPrompt,
      userContent,
      language: 'id',
      feature: 'roleplayTurn',
      orgId: resolvedOrgId,
    });

    // 5. For each chunk, post back to WebSocket
    for await (const chunk of streamGenerator) {
      fullResponse += chunk;
      await postToConnection(connectionId, JSON.stringify({
        type: 'stream_chunk',
        sessionId,
        chunk,
      }));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Streaming failed';
    await postToConnection(connectionId, JSON.stringify({ type: 'error', error: errorMessage }));
    return { statusCode: 500, body: errorMessage };
  }

  // 6. After streaming completes, store full response in DynamoDB
  const assistantMessage: RoleplayMessage = {
    role: 'assistant',
    content: fullResponse,
    timestamp: new Date().toISOString(),
  };

  const finalMessages = [...updatedMessages, assistantMessage];

  await updateItem(pk, sk, {
    messages: finalMessages,
  });

  // Notify client that streaming is complete
  await postToConnection(connectionId, JSON.stringify({
    type: 'stream_end',
    sessionId,
    messageCount: finalMessages.length,
  }));

  return { statusCode: 200, body: 'Message processed' };
}

// ─── POST /roleplay/start ──────────────────────────────────────────────────────

/**
 * Initialize a new roleplay session.
 * Generates scenario context and objectives via Bedrock, then stores in DynamoDB.
 *
 * Requirement 4.1: Start roleplay session with AI-generated scenario.
 */
async function startSession(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Extract claims
  const claims = extractClaims(event);

  // 2. Validate request body (scenarioType, language)
  const data = validateRequest(event, roleplayStartSchema);
  const language = data.language ?? 'id';

  // 3. Build Bedrock prompt to generate scenario context and objectives
  const systemPrompt =
    'You are a roleplay scenario designer. Create a realistic scenario context and 2-4 objectives ' +
    `for a ${data.scenarioType} roleplay. Return JSON with fields: scenarioContext (string), objectives (string array). ` +
    'Do not include any other text outside the JSON object.';

  const userContent =
    `Create a roleplay scenario for a "${data.scenarioType}" type interaction. ` +
    'The scenario should be realistic and challenging, suitable for professional skill development. ' +
    'Return only valid JSON with "scenarioContext" (a paragraph describing the situation) and "objectives" (array of 2-4 specific goals for the participant).';

  // 4. Invoke Bedrock, parse JSON response
  const result = await invokeModel({
    systemPrompt,
    userContent,
    language,
    feature: 'roleplayTurn',
    orgId: claims.orgId,
  });

  let scenarioContext: string;
  let objectives: string[];

  try {
    // Try to extract JSON from the response (handle potential markdown code blocks)
    const jsonContent = extractJson(result.content);
    const parsed = JSON.parse(jsonContent);
    scenarioContext = parsed.scenarioContext || '';
    objectives = Array.isArray(parsed.objectives) ? parsed.objectives : [];
  } catch {
    // Fallback if Bedrock doesn't return valid JSON
    scenarioContext = result.content;
    objectives = ['Complete the roleplay interaction professionally'];
  }

  // 5. Store session in DynamoDB
  const sessionId = randomUUID();
  const now = new Date().toISOString();

  const sessionRecord: RoleplaySessionRecord = {
    PK: `ORG#${claims.orgId}#USER#${claims.userId}`,
    SK: `ROLEPLAY#${sessionId}`,
    GSI1PK: claims.orgId,
    GSI1SK: claims.userId,
    sessionId,
    orgId: claims.orgId,
    userId: claims.userId,
    scenarioType: data.scenarioType,
    scenarioContext,
    objectives,
    status: 'active',
    messages: [],
    createdAt: now,
  };

  await putItem(sessionRecord as unknown as Record<string, unknown>);

  // 6. Return the session
  return formatResponse(201, {
    sessionId: sessionRecord.sessionId,
    orgId: sessionRecord.orgId,
    userId: sessionRecord.userId,
    scenarioType: sessionRecord.scenarioType,
    scenarioContext: sessionRecord.scenarioContext,
    objectives: sessionRecord.objectives,
    status: sessionRecord.status,
    messages: sessionRecord.messages,
    createdAt: sessionRecord.createdAt,
  });
}

// ─── GET /roleplay/{id} ────────────────────────────────────────────────────────

/**
 * Retrieve a roleplay session with full message history.
 * Verifies the requesting user has access to the session's organization.
 *
 * Requirement 4.4: Retrieve session with full conversation history.
 */
async function getSession(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  // 1. Extract claims
  const claims = extractClaims(event);

  // 2. Extract session ID from path
  const sessionId = event.pathParameters?.id || event.path.split('/').pop();

  if (!sessionId) {
    return formatResponse(400, { error: 'Session ID is required' });
  }

  // 3. Get session from DynamoDB
  const pk = `ORG#${claims.orgId}#USER#${claims.userId}`;
  const sk = `ROLEPLAY#${sessionId}`;

  const session = await getItem<RoleplaySessionRecord>(pk, sk);

  if (!session) {
    return formatResponse(404, { error: 'Roleplay session not found' });
  }

  // 4. Verify org access
  assertOrgAccess(claims, session.orgId);

  // 5. Return session with messages
  return formatResponse(200, {
    sessionId: session.sessionId,
    orgId: session.orgId,
    userId: session.userId,
    scenarioType: session.scenarioType,
    scenarioContext: session.scenarioContext,
    objectives: session.objectives,
    status: session.status,
    messages: session.messages,
    evaluation: session.evaluation,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a roleplay conversation.
 * Includes the scenario persona and context.
 */
function buildRoleplaySystemPrompt(session: RoleplaySessionRecord): string {
  const personaMap: Record<string, string> = {
    Customer: 'You are a customer interacting with a service representative. Stay in character and respond naturally based on the scenario context.',
    DifficultCustomer: 'You are a difficult, frustrated customer. You are unhappy and demanding. Stay in character and make the conversation challenging but realistic.',
    Interviewer: 'You are a professional job interviewer. Ask relevant questions, follow up on answers, and maintain a professional demeanor throughout.',
    Manager: 'You are a team manager having a one-on-one meeting with an employee. Discuss performance, goals, and provide constructive feedback as appropriate.',
  };

  const persona = personaMap[session.scenarioType] || personaMap.Customer;

  return (
    `${persona}\n\n` +
    `Scenario Context: ${session.scenarioContext}\n\n` +
    `Objectives for this session:\n${session.objectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n` +
    'Keep responses concise and natural (1-3 paragraphs). Do not break character or refer to yourself as an AI.'
  );
}

/**
 * Build the user content from the full conversation history.
 * All N prior messages are included to preserve context for each new turn.
 *
 * Requirement 4.3: All prior messages included in context.
 */
function buildConversationContext(messages: RoleplayMessage[]): string {
  if (messages.length === 0) {
    return 'Start the conversation.';
  }

  const formattedMessages = messages.map((msg) => {
    const roleLabel = msg.role === 'user' ? 'Participant' : 'You (character)';
    return `${roleLabel}: ${msg.content}`;
  });

  return (
    'Here is the full conversation so far:\n\n' +
    formattedMessages.join('\n\n') +
    '\n\nContinue the conversation as the character. Respond to the latest message.'
  );
}

/**
 * Post a message to a WebSocket connection.
 */
async function postToConnection(connectionId: string, data: string): Promise<void> {
  if (!WEBSOCKET_CALLBACK_URL) {
    return;
  }

  const { ApiGatewayManagementApiClient, PostToConnectionCommand } = await getWsClientModule();

  const client = new ApiGatewayManagementApiClient({
    endpoint: WEBSOCKET_CALLBACK_URL,
  });

  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: new TextEncoder().encode(data),
      })
    );
  } catch (error: unknown) {
    // If the connection is gone (410), silently ignore
    const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (statusCode === 410) {
      // Connection is stale, clean up
      await deleteItem(`WSCONN#${connectionId}`, `WSCONN#${connectionId}`);
    }
    // For other errors, log but don't throw to avoid breaking the stream
    console.error(`Failed to post to connection ${connectionId}:`, error);
  }
}

/**
 * Extract JSON from a response that may contain markdown code blocks or extra text.
 */
function extractJson(content: string): string {
  // Try to find JSON within markdown code blocks
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find a JSON object directly
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return content;
}

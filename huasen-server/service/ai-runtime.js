const _ = require('lodash');
const { tool } = require('huasen-lib');
const { schemaMap, working } = require('./index.js');
const { invokeProvider, invokeProviderStream } = require('./ai-provider-adapters/index.js');
const { buildProviderMessages, resolveCapabilities } = require('./ai-provider-adapters/message-builder.js');

const { aiProvider, aiApp, aiPreset, aiConversation, aiMessage, aiAttachment } = schemaMap;

const activeStreamMap = new Map();

const parseJSON = tool.parseJSON;

function logRuntimeLifecycle(label, payload = {}) {
  console.log(`[ai-runtime] ${label}`, {
    time: new Date().toISOString(),
    ...payload,
  });
}

function sanitizeText(text = '') {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function normalizeMessageContent(text = '') {
  return String(text || '').replace(/\r\n/g, '\n');
}

function normalizeResponseFormat(responseFormat) {
  if (!responseFormat) return null;
  if (typeof responseFormat === 'string') {
    return responseFormat === 'json_object' ? { type: 'json_object' } : { type: 'text' };
  }
  if (Object.prototype.toString.call(responseFormat) !== '[object Object]') return { type: 'text' };
  return responseFormat.type === 'json_object' ? { type: 'json_object' } : { type: 'text' };
}

function getContentTypeByResponseFormat(responseFormat) {
  const normalized = normalizeResponseFormat(responseFormat);
  if (!normalized) return 'text';
  return normalized.type === 'json_object' ? 'json-object' : 'text';
}

function mergeParams(...params) {
  return params.reduce((result, item) => {
    if (Object.prototype.toString.call(item) === '[object Object]') {
      return Object.assign(result, item);
    }
    return result;
  }, {});
}

function normalizePermissionCode(code, defaultCode = 0) {
  const normalized = Number(code);
  if (Number.isInteger(normalized) && normalized >= 0 && normalized <= 3) {
    return normalized;
  }
  return defaultCode;
}

function buildAppPermissionQuery(code) {
  const normalizedCode = normalizePermissionCode(code);
  return {
    $or: [{ code: { $lte: normalizedCode } }, { code: { $exists: false } }],
  };
}

function buildAttachmentContent(attachments = []) {
  return attachments
    .map(item => {
      const url = item.url || '';
      if (item.kind === 'image') {
        return `[图片附件] ${item.name} ${url}`.trim();
      }
      return `[文件附件] ${item.name} ${url}`.trim();
    })
    .filter(Boolean)
    .join('\n');
}

function buildMessagePayload(messages = []) {
  return messages.map(item => {
    const contentParts = [];
    if (item.content) {
      contentParts.push(item.content);
    }
    if (Array.isArray(item.attachments) && item.attachments.length) {
      contentParts.push(buildAttachmentContent(item.attachments));
    }
    return {
      role: item.role,
      content: contentParts.filter(Boolean).join('\n\n'),
    };
  });
}

async function resolveChatContext({ userId, userCode = 0, appId, presetId, conversationId, attachmentIds = [] }) {
  const [apps, providers, presets, conversations, attachments] = await Promise.all([
    aiApp.find({ _id: appId, enabled: true, ...buildAppPermissionQuery(userCode) }),
    aiProvider.find({ enabled: true }),
    aiPreset.find({ enabled: true }),
    conversationId ? aiConversation.find({ _id: conversationId, userId, enabled: true }) : Promise.resolve([]),
    attachmentIds.length ? aiAttachment.find({ _id: { $in: attachmentIds }, userId, enabled: true }) : Promise.resolve([]),
  ]);
  const app = apps[0];
  if (!app) {
    throw new Error('请排查AI应用是否存在/是否禁用/是否无权限');
  }
  const provider = providers.find(item => String(item._id) === String(app.providerId));
  if (!provider) {
    throw new Error('AI供应商不存在或已禁用');
  }
  const presetSourceId = presetId || app.presetId;
  const preset = presets.find(item => String(item._id) === String(presetSourceId)) || null;
  const conversation = conversations[0] || null;
  return {
    app,
    provider,
    preset,
    conversation,
    attachments,
  };
}

function validateAttachmentCapabilities({ provider, preset, attachments }) {
  if (!attachments.length) return;
  if (!preset) {
    throw new Error('请先为AI应用配置模型预设');
  }
  const capabilities = resolveCapabilities(provider, preset, null);
  if (preset) {
    if (attachments.some(item => item.kind === 'image') && !preset.allowImage) {
      throw new Error('当前模型预设不支持图片上传');
    }
    if (attachments.some(item => item.kind === 'file') && !preset.allowFile) {
      throw new Error('当前模型预设不支持文件上传');
    }
  }
  const hasImage = attachments.some(item => item.kind === 'image');
  const hasFile = attachments.some(item => item.kind === 'file');
  if (hasImage && !capabilities.supportsImageInput && !capabilities.supportsTextFallback) {
    throw new Error('当前AI供应商不支持图片输入');
  }
  if (hasFile && !capabilities.supportsDocumentInline && !capabilities.supportsTextFallback) {
    throw new Error('当前AI供应商不支持文件输入');
  }
}

async function buildRuntimeMessages({ conversationId, app, preset, attachments, content }) {
  const history = conversationId ? await aiMessage.find({ conversationId, enabled: true }).sort({ creatTime: 1 }) : [];
  const attachmentMap = {};
  history.forEach(item => {
    attachmentMap[item._id] = [];
  });
  const historyAttachmentIds = history.reduce((result, item) => {
    return result.concat(item.attachmentIds || []);
  }, []);
  const historyAttachments = historyAttachmentIds.length ? await aiAttachment.find({ _id: { $in: historyAttachmentIds }, enabled: true }) : [];
  history.forEach(item => {
    attachmentMap[item._id] = historyAttachments.filter(attachment => (item.attachmentIds || []).includes(String(attachment._id)));
  });
  const maxContextMessages = _.get(preset, 'maxContextMessages') || 128;
  const recentHistory = history.slice(-maxContextMessages);
  const runtimeMessages = [];
  const systemMessageText = sanitizeText(_.get(preset, 'promptTemplate') || '');
  if (systemMessageText) {
    runtimeMessages.push({ role: 'system', content: systemMessageText, attachments: [] });
  }
  recentHistory.forEach(item => {
    runtimeMessages.push({
      role: item.role,
      content: normalizeMessageContent(item.content),
      attachments: attachmentMap[item._id] || [],
    });
  });
  runtimeMessages.push({
    role: 'user',
    content: normalizeMessageContent(content),
    attachments,
  });
  return runtimeMessages;
}

async function buildProviderPayload({ provider, app, preset, runtimeMessages, requestParams = {} }) {
  const presetParams = parseJSON(_.get(preset, 'params', '{}'), {});

  const payload = {
    model: _.get(preset, 'model', ''),
    messages: await buildProviderMessages({ runtimeMessages, provider, preset, app }),
    ...mergeParams(presetParams),
  };

  // 独立字段优先于 params JSON，但低于 requestParams
  const temperature = _.get(preset, 'temperature');
  if (temperature !== undefined && temperature !== null && requestParams.temperature === undefined) {
    payload.temperature = Number(temperature);
  }

  const topP = _.get(preset, 'topP');
  if (topP !== undefined && topP !== null && requestParams.top_p === undefined && requestParams.topP === undefined) {
    payload.top_p = Number(topP);
  }

  const maxTokens = _.get(preset, 'maxTokens');
  if (maxTokens !== undefined && maxTokens !== null && requestParams.max_tokens === undefined && requestParams.max_completion_tokens === undefined) {
    const modelName = String(payload.model).toLowerCase();
    // OpenAI o1/o3 系列及 GPT-4o/GPT-4.5 新版倾向使用 max_completion_tokens
    const useMaxCompletionTokens = /^(o1|o3|gpt-4\.5|gpt-4o)/.test(modelName);
    if (useMaxCompletionTokens) {
      payload.max_completion_tokens = Number(maxTokens);
    } else {
      payload.max_tokens = Number(maxTokens);
    }
  }

  // requestParams 最后覆盖
  Object.assign(payload, requestParams);
  if (payload.response_format !== undefined && payload.response_format !== null) {
    payload.response_format = normalizeResponseFormat(payload.response_format);
  }

  if (!payload.model) {
    throw new Error('请先在模型预设中配置 model');
  }

  // 供应商 extraConfig 属于 SDK 客户端配置，不参与 payload 合成，兜底清理历史预设/调用参数里误填的内部字段。
  // delete payload.headers;
  // delete payload.defaultHeaders;
  // delete payload.defaultQuery;
  // delete payload.timeout;
  // delete payload.maxRetries;
  // delete payload.capabilities;
  // delete payload.source;

  return payload;
}

async function prepareChatRuntime({ userId, userCode = 0, appId, presetId, conversationId, content, attachmentIds = [], requestParams = {} }) {
  const context = await resolveChatContext({ userId, userCode, appId, presetId, conversationId, attachmentIds });
  const { app, provider, preset, attachments } = context;
  validateAttachmentCapabilities({ provider, preset, attachments });
  const runtimeMessages = await buildRuntimeMessages({
    conversationId,
    app,
    preset,
    attachments,
    content,
  });
  const payload = await buildProviderPayload({
    provider,
    app,
    preset,
    runtimeMessages,
    requestParams,
  });
  return {
    ...context,
    runtimeMessages,
    payload,
    assistantContentType: getContentTypeByResponseFormat(payload.response_format),
  };
}

function buildPersistIds(conversationId) {
  return {
    requestId: String(new aiMessage()._id),
    currentConversationId: conversationId || String(new aiConversation()._id),
    userMessageId: String(new aiMessage()._id),
    assistantMessageId: String(new aiMessage()._id),
  };
}

function getActiveStreamEntry(requestId) {
  if (!requestId) return null;
  return activeStreamMap.get(String(requestId)) || null;
}

function registerActiveStream({ requestId, userId, conversationId, assistantMessageId, abort }) {
  const key = String(requestId);
  const entry = {
    requestId: key,
    userId,
    conversationId,
    assistantMessageId,
    abort,
    abortReason: '',
    finished: false,
    createdAt: new Date(),
  };
  activeStreamMap.set(key, entry);
  return entry;
}

function markActiveStreamAbort(requestId, reason) {
  const entry = getActiveStreamEntry(requestId);
  if (!entry || entry.finished) return;
  if (entry.abortReason === 'user') return;
  entry.abortReason = reason;
}

function cleanupActiveStream(requestId) {
  const entry = getActiveStreamEntry(requestId);
  if (!entry) return null;
  entry.finished = true;
  activeStreamMap.delete(String(requestId));
  return entry;
}

function normalizeConversationSource(source) {
  return source === 'plugin' ? 'plugin' : 'portal';
}

async function persistConversationSkeleton({
  ids,
  userId,
  appId,
  provider,
  preset,
  conversationId,
  conversation,
  source = 'portal',
  content,
  attachmentIds = [],
  attachments = [],
  assistantStatus = 'pending',
  assistantContentType = 'text',
}) {
  const conversationSource = normalizeConversationSource(source);
  const currentTitle = sanitizeText(content).slice(0, 30) || '新会话';
  const now = new Date();
  const works = [];
  if (!conversationId) {
    works.push({
      schemaName: 'aiConversation',
      methodName: 'insertMany',
      payloads: [
        [
          {
            _id: ids.currentConversationId,
            userId,
            appId,
            presetId: _.get(preset, '_id', ''),
            title: currentTitle,
            summary: '',
            source: conversationSource,
            lastMessageAt: now,
            messageCount: 2,
            enabled: true,
          },
        ],
      ],
    });
  } else {
    works.push({
      schemaName: 'aiConversation',
      methodName: 'updateOne',
      payloads: [
        { _id: ids.currentConversationId },
        { $set: { lastMessageAt: now, presetId: _.get(preset, '_id', ''), title: _.get(conversation, 'title') || currentTitle }, $inc: { messageCount: 2 } },
        { runValidators: true },
      ],
    });
  }
  works.push(
    {
      schemaName: 'aiMessage',
      methodName: 'insertMany',
      payloads: [
        [
          {
            _id: ids.userMessageId,
            conversationId: ids.currentConversationId,
            appId,
            presetId: _.get(preset, '_id', ''),
            providerId: provider._id,
            role: 'user',
            content: normalizeMessageContent(content),
            contentType: 'text',
            attachmentIds,
            status: 'success',
          },
        ],
      ],
    },
    {
      schemaName: 'aiMessage',
      methodName: 'insertMany',
      payloads: [
        [
          {
            _id: ids.assistantMessageId,
            conversationId: ids.currentConversationId,
            appId,
            presetId: _.get(preset, '_id', ''),
            providerId: provider._id,
            role: 'assistant',
            content: '',
            contentType: assistantContentType,
            attachmentIds: [],
            model: '',
            usage: '{}',
            finishReason: '',
            status: assistantStatus,
            rawResponse: '{}',
          },
        ],
      ],
    },
  );
  if (attachmentIds.length) {
    works.push({
      schemaName: 'aiAttachment',
      methodName: 'updateMany',
      payloads: [{ _id: { $in: attachmentIds } }, { $set: { conversationId: ids.currentConversationId, messageId: ids.userMessageId } }, { runValidators: true }],
    });
  }
  const [err] = await working(works);
  if (err) {
    throw err;
  }
  const [persistedConversation, userMessage, assistantMessage] = await Promise.all([
    aiConversation.findById(ids.currentConversationId),
    aiMessage.findById(ids.userMessageId),
    aiMessage.findById(ids.assistantMessageId),
  ]);
  return {
    conversation: persistedConversation,
    userMessage: {
      ...(userMessage ? userMessage.toObject() : {}),
      attachments: attachments.map(item => (typeof item.toObject === 'function' ? item.toObject() : item)),
    },
    assistantMessage,
  };
}

async function finalizeAssistantMessageSuccess({ conversationId, assistantMessageId, assistant, contentType = 'text' }) {
  const now = new Date();
  await Promise.all([
    aiMessage.updateOne(
      { _id: assistantMessageId },
      {
        $set: {
          content: normalizeMessageContent(assistant.content),
          contentType,
          model: assistant.model || '',
          usage: JSON.stringify(assistant.usage || {}),
          finishReason: assistant.finishReason || '',
          status: 'success',
          errorMessage: '',
          rawResponse: JSON.stringify(assistant.raw || {}),
        },
      },
      { runValidators: true },
    ),
    aiConversation.updateOne({ _id: conversationId }, { $set: { lastMessageAt: now } }, { runValidators: true }),
  ]);
  return aiMessage.findById(assistantMessageId);
}

async function finalizeAssistantMessageFailure({ conversationId, assistantMessageId, partialContent, errorMessage, rawResponse = {}, contentType = 'text' }) {
  const now = new Date();
  await Promise.all([
    aiMessage.updateOne(
      { _id: assistantMessageId },
      {
        $set: {
          content: normalizeMessageContent(partialContent),
          contentType,
          status: 'failed',
          finishReason: '',
          errorMessage: errorMessage || 'AI对话异常',
          rawResponse: JSON.stringify(rawResponse),
        },
      },
      { runValidators: true },
    ),
    aiConversation.updateOne({ _id: conversationId }, { $set: { lastMessageAt: now } }, { runValidators: true }),
  ]);
  return aiMessage.findById(assistantMessageId);
}

async function finalizeAssistantMessageStopped({ conversationId, assistantMessageId, partialContent, errorMessage = '已停止', rawResponse = {}, contentType = 'text' }) {
  const now = new Date();
  await Promise.all([
    aiMessage.updateOne(
      { _id: assistantMessageId },
      {
        $set: {
          content: normalizeMessageContent(partialContent),
          contentType,
          status: 'stopped',
          finishReason: 'user_stopped',
          errorMessage,
          rawResponse: JSON.stringify(rawResponse),
        },
      },
      { runValidators: true },
    ),
    aiConversation.updateOne({ _id: conversationId }, { $set: { lastMessageAt: now } }, { runValidators: true }),
  ]);
  return aiMessage.findById(assistantMessageId);
}

async function chat({ userId, userCode = 0, appId, presetId, conversationId, content, attachmentIds = [], requestParams = {}, source = 'portal' }) {
  const prepared = await prepareChatRuntime({
    userId,
    userCode,
    appId,
    presetId,
    conversationId,
    content,
    attachmentIds,
    requestParams,
  });
  const assistant = await invokeProvider(prepared.provider, prepared.payload);
  const ids = buildPersistIds(conversationId);
  const persisted = await persistConversationSkeleton({
    ids,
    userId,
    appId,
    provider: prepared.provider,
    preset: prepared.preset,
    conversationId,
    conversation: prepared.conversation,
    source,
    content,
    attachmentIds,
    attachments: prepared.attachments,
    assistantStatus: 'pending',
    assistantContentType: prepared.assistantContentType,
  });
  const assistantMessage = await finalizeAssistantMessageSuccess({
    conversationId: ids.currentConversationId,
    assistantMessageId: ids.assistantMessageId,
    assistant,
    contentType: prepared.assistantContentType,
  });
  const conversationDoc = await aiConversation.findById(ids.currentConversationId);
  return {
    conversation: conversationDoc,
    userMessage: persisted.userMessage,
    assistantMessage,
  };
}

async function chatStream({
  userId,
  userCode = 0,
  appId,
  presetId,
  conversationId,
  content,
  attachmentIds = [],
  requestParams = {},
  source = 'portal',
  registerAbort,
  onAck,
  onConversation,
  onDelta,
  onDone,
  onError,
  isAborted = () => false,
}) {
  const prepared = await prepareChatRuntime({
    userId,
    userCode,
    appId,
    presetId,
    conversationId,
    content,
    attachmentIds,
    requestParams,
  });
  const ids = buildPersistIds(conversationId);
  if (typeof onAck === 'function') {
    onAck({
      requestId: ids.requestId,
      conversationId: ids.currentConversationId,
      messageId: ids.assistantMessageId,
    });
  }
  const persisted = await persistConversationSkeleton({
    ids,
    userId,
    appId,
    provider: prepared.provider,
    preset: prepared.preset,
    conversationId,
    conversation: prepared.conversation,
    source,
    content,
    attachmentIds,
    attachments: prepared.attachments,
    assistantStatus: 'pending',
    assistantContentType: prepared.assistantContentType,
  });
  if (typeof onConversation === 'function') {
    onConversation({
      conversation: persisted.conversation,
      userMessage: persisted.userMessage,
      assistantMessage: persisted.assistantMessage,
    });
  }
  let latestContent = '';
  let abortedByClient = false;
  let streamRegistered = false;
  const streamTask = invokeProviderStream(prepared.provider, prepared.payload, {
    onDelta(delta, meta = {}) {
      latestContent = meta.accumulatedContent || `${latestContent}${delta}`;
      if (typeof onDelta === 'function') {
        onDelta({
          delta,
          accumulatedLength: _.get(meta, 'accumulatedLength', latestContent.length),
        });
      }
    },
  });

  const abortStream = async (reason = 'disconnect') => {
    const realReason = reason;
    abortedByClient = true;
    markActiveStreamAbort(ids.requestId, realReason);
    await streamTask.abort();
  };

  const buildStoppedError = reason => {
    const stopErr = new Error('USER_STOPPED');
    stopErr.code = 'USER_STOPPED';
    stopErr.stopReason = reason;
    return stopErr;
  };

  registerActiveStream({
    requestId: ids.requestId,
    userId,
    conversationId: ids.currentConversationId,
    assistantMessageId: ids.assistantMessageId,
    abort: abortStream,
  });
  streamRegistered = true;

  if (typeof registerAbort === 'function') {
    registerAbort(reason => abortStream(reason || 'disconnect'));
  }
  // 判断客户端连接是否已断开
  if (isAborted()) {
    await abortStream('disconnect');
  }

  try {
    const assistant = await streamTask.result;
    // 判断客户端是否已断开连接
    const activeEntry = getActiveStreamEntry(ids.requestId);
    const abortReason = _.get(activeEntry, 'abortReason');
    if (isAborted() || abortedByClient || abortReason) {
      throw buildStoppedError(abortReason);
    }
    const assistantMessage = await finalizeAssistantMessageSuccess({
      conversationId: ids.currentConversationId,
      assistantMessageId: ids.assistantMessageId,
      assistant,
      contentType: prepared.assistantContentType,
    });
    if (typeof onDone === 'function') {
      onDone({
        finishReason: assistant.finishReason || '',
        model: assistant.model || '',
        usage: assistant.usage || {},
        messageId: ids.assistantMessageId,
      });
    }
    return {
      conversation: await aiConversation.findById(ids.currentConversationId),
      userMessage: persisted.userMessage,
      assistantMessage,
    };
  } catch (err) {
    const activeEntry = getActiveStreamEntry(ids.requestId);
    const abortReason = _.get(activeEntry, 'abortReason') || err.stopReason;
    const stoppedByUser = abortReason === 'user';
    const stoppedByDisconnect = abortReason === 'disconnect' || (err.name === 'AbortError' && err.code === 'USER_STOPPED');
    // 用户终止、连接断开、取消事件的异常处理
    if (stoppedByUser || stoppedByDisconnect || err.name === 'AbortError') {
      const stopReasonText = stoppedByUser ? '已手动停止' : '前端连接已断开';
      const assistantMessage = await finalizeAssistantMessageStopped({
        conversationId: ids.currentConversationId,
        assistantMessageId: ids.assistantMessageId,
        partialContent: latestContent,
        errorMessage: stopReasonText,
        rawResponse: { stopped: true, reason: abortReason || (stoppedByUser ? 'user' : 'disconnect') },
        contentType: prepared.assistantContentType,
      });
      // 仅在连接仍然可写时推送停止事件
      if (typeof onError === 'function' && !stoppedByDisconnect) {
        onError({
          message: stopReasonText,
          code: 'USER_STOPPED',
          retryable: false,
          messageId: ids.assistantMessageId,
        });
      }
      return {
        conversation: await aiConversation.findById(ids.currentConversationId),
        userMessage: persisted.userMessage,
        assistantMessage,
      };
    }

    // 异常状态入库
    await finalizeAssistantMessageFailure({
      conversationId: ids.currentConversationId,
      assistantMessageId: ids.assistantMessageId,
      partialContent: latestContent,
      errorMessage: err.message || 'AI对话异常',
      rawResponse: { error: err.message || 'AI对话异常' },
      contentType: prepared.assistantContentType,
    });
    if (typeof onError === 'function') {
      onError({
        message: err.message || 'AI对话异常',
        code: 'STREAM_FAILED',
        retryable: false,
        messageId: ids.assistantMessageId,
      });
    }
    throw err;
  } finally {
    if (streamRegistered) {
      cleanupActiveStream(ids.requestId);
    }
  }
}

module.exports = {
  chat,
  chatStream,
  sanitizeText,
  mergeParams,
  normalizeConversationSource,
};

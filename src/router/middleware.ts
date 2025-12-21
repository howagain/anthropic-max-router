import { AnthropicRequest, SystemMessage, Tool, ContentBlock, Message } from '../types.js';

export const REQUIRED_SYSTEM_PROMPT: SystemMessage = {
  type: 'text',
  text: "You are Claude Code, Anthropic's official CLI for Claude.",
};

// List of valid top-level fields for Anthropic API requests
const VALID_REQUEST_FIELDS = new Set([
  'model',
  'max_tokens',
  'system',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'temperature',
  'top_p',
  'top_k',
  'stop_sequences',
  'metadata',
  'thinking',
]);

/**
 * Tool names that conflict with Claude Code's built-in tools.
 * Anthropic's OAuth API rejects these lowercase names when using
 * Claude Max credentials. We capitalize them to match Claude Code's
 * PascalCase naming convention (Read, Write, Edit).
 */
const CONFLICTING_TOOL_NAMES: Record<string, string> = {
  'read': 'Read',
  'write': 'Write',
  'edit': 'Edit',
};

// Reverse mapping for responses
const REVERSE_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CONFLICTING_TOOL_NAMES).map(([k, v]) => [v, k])
);

/**
 * Strips unknown fields from the request to prevent API errors
 * Fields like 'context_management' from the Agent SDK are not supported
 */
export function stripUnknownFields(request: Record<string, unknown>): AnthropicRequest {
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(request)) {
    if (VALID_REQUEST_FIELDS.has(key)) {
      sanitized[key] = request[key];
    }
  }
  return sanitized as unknown as AnthropicRequest;
}

/**
 * Normalizes system prompt to SystemMessage[] format
 * Handles both string and array inputs
 */
function normalizeSystemPrompt(system?: SystemMessage[] | string): SystemMessage[] {
  if (!system) {
    return [];
  }
  if (typeof system === 'string') {
    return [{ type: 'text', text: system }];
  }
  return system;
}

/**
 * Checks if the first system message matches the required Claude Code prompt
 */
function hasRequiredSystemPrompt(system?: SystemMessage[] | string): boolean {
  const normalizedSystem = normalizeSystemPrompt(system);
  if (normalizedSystem.length === 0) {
    return false;
  }

  const firstMessage = normalizedSystem[0];
  return firstMessage.type === 'text' && firstMessage.text === REQUIRED_SYSTEM_PROMPT.text;
}

/**
 * Ensures the required system prompt is present as the first element
 * If it's already there, returns the request unchanged
 * If not, prepends the required prompt
 */
export function ensureRequiredSystemPrompt(request: AnthropicRequest): AnthropicRequest {
  // If the required prompt is already first, return as-is
  if (hasRequiredSystemPrompt(request.system)) {
    return request;
  }

  // Otherwise, prepend the required normalized prompt
  const existingSystem = normalizeSystemPrompt(request.system);
  return {
    ...request,
    system: [REQUIRED_SYSTEM_PROMPT, ...existingSystem],
  };
}

/**
 * Renames conflicting tool names in the request to avoid Claude Code
 * built-in tool name collisions with OAuth credentials.
 * Returns the modified request and a flag indicating if any renames occurred.
 */
export function renameConflictingTools(request: AnthropicRequest): {
  request: AnthropicRequest;
  hasRenames: boolean;
} {
  if (!request.tools || request.tools.length === 0) {
    return { request, hasRenames: false };
  }

  let hasRenames = false;
  const renamedTools: Tool[] = request.tools.map((tool) => {
    if (CONFLICTING_TOOL_NAMES[tool.name]) {
      hasRenames = true;
      return { ...tool, name: CONFLICTING_TOOL_NAMES[tool.name] };
    }
    return tool;
  });

  if (!hasRenames) {
    return { request, hasRenames: false };
  }

  // Also rename tool references in tool_choice if present
  let toolChoice = request.tool_choice;
  if (toolChoice?.type === 'tool' && toolChoice.name && CONFLICTING_TOOL_NAMES[toolChoice.name]) {
    toolChoice = { ...toolChoice, name: CONFLICTING_TOOL_NAMES[toolChoice.name] };
  }

  // Rename tool names in message history (tool_use and tool_result blocks)
  const renamedMessages = request.messages.map((msg) => {
    if (typeof msg.content === 'string') return msg;
    if (!Array.isArray(msg.content)) return msg;

    const renamedContent = msg.content.map((block: ContentBlock) => {
      if (block.type === 'tool_use' && typeof block.name === 'string' && CONFLICTING_TOOL_NAMES[block.name]) {
        return { ...block, name: CONFLICTING_TOOL_NAMES[block.name] };
      }
      return block;
    });

    return { ...msg, content: renamedContent } as Message;
  });

  return {
    request: {
      ...request,
      tools: renamedTools,
      messages: renamedMessages,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    },
    hasRenames,
  };
}

/**
 * Restores original tool names in the response body.
 * Handles both JSON responses and streaming SSE chunks.
 */
export function restoreToolNames(responseText: string): string {
  // Simple string replacement for the renamed tool names in JSON
  let result = responseText;
  for (const [renamed, original] of Object.entries(REVERSE_TOOL_NAMES)) {
    // Replace in JSON "name": "oc_read" patterns
    result = result.replaceAll(`"name":"${renamed}"`, `"name":"${original}"`);
    result = result.replaceAll(`"name": "${renamed}"`, `"name": "${original}"`);
  }
  return result;
}

function topLevelMcpError(value) {
  if (!value || typeof value !== 'object') return false;
  return value.isError === true || value.is_error === true;
}

function textPayloadReportsError(text) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('{')) return false;
  try {
    return topLevelMcpError(JSON.parse(text));
  } catch {
    return false;
  }
}

/** Interpret one Claude stream-json tool_result without scanning user data. */
export function toolResultSucceeded(block) {
  if (block?.is_error === true) return false;
  if (topLevelMcpError(block?.content)) return false;
  if (typeof block?.content === 'string') {
    return !textPayloadReportsError(block.content);
  }
  if (Array.isArray(block?.content)) {
    return !block.content.some((item) =>
      topLevelMcpError(item) || textPayloadReportsError(item?.text));
  }
  return true;
}

function parsedStructuredContent(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.structuredContent && typeof value.structuredContent === 'object') {
    return value.structuredContent;
  }
  if (value.result?.structuredContent && typeof value.result.structuredContent === 'object') {
    return value.result.structuredContent;
  }
  return null;
}

/** Extract the compact MCP post-state from one successful Claude tool_result. */
export function toolResultStructuredContent(block) {
  const direct = parsedStructuredContent(block?.content);
  if (direct) return direct;
  const items = Array.isArray(block?.content) ? block.content : [block?.content];
  for (const item of items) {
    const structured = parsedStructuredContent(item);
    if (structured) return structured;
    const text = typeof item === 'string' ? item : item?.text;
    if (typeof text !== 'string' || !text.trimStart().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(text);
      return parsedStructuredContent(parsed) ?? (parsed && typeof parsed === 'object' ? parsed : null);
    } catch {
      // A non-JSON text result carries no structured post-state evidence.
    }
  }
  return null;
}

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

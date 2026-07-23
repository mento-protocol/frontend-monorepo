const HTML_WHITESPACE = new Set(["\t", "\n", "\f", "\r", " "]);

function skipWhitespace(html, start) {
  let cursor = start;
  while (cursor < html.length && HTML_WHITESPACE.has(html[cursor])) cursor += 1;
  return cursor;
}

function startsWithIgnoreCase(html, cursor, value) {
  return (
    html.slice(cursor, cursor + value.length).toLowerCase() ===
    value.toLowerCase()
  );
}

function leadingHtmlAttributes(html) {
  let cursor = html.charCodeAt(0) === 0xfeff ? 1 : 0;
  cursor = skipWhitespace(html, cursor);

  const doctype = /^<!doctype[\t\n\f\r ]+html[\t\n\f\r ]*>/i.exec(
    html.slice(cursor),
  );
  if (doctype) {
    cursor = skipWhitespace(html, cursor + doctype[0].length);
  }

  if (!startsWithIgnoreCase(html, cursor, "<html")) return null;
  const boundary = html[cursor + 5];
  if (boundary !== ">" && !HTML_WHITESPACE.has(boundary)) return null;
  const attributes = [];
  cursor += 5;
  while (cursor < html.length) {
    cursor = skipWhitespace(html, cursor);
    if (html[cursor] === ">") return attributes;
    if (cursor >= html.length) return null;

    const nameStart = cursor;
    while (
      cursor < html.length &&
      !HTML_WHITESPACE.has(html[cursor]) &&
      !["=", '"', "'", "/", ">", "<", "`"].includes(html[cursor])
    ) {
      cursor += 1;
    }
    if (cursor === nameStart) return null;
    const name = html.slice(nameStart, cursor).toLowerCase();
    cursor = skipWhitespace(html, cursor);

    let quoted = false;
    let value = null;
    if (html[cursor] === "=") {
      cursor = skipWhitespace(html, cursor + 1);
      const quote = html[cursor];
      if (quote === '"' || quote === "'") {
        quoted = true;
        const valueStart = cursor + 1;
        const valueEnd = html.indexOf(quote, valueStart);
        if (valueEnd === -1) return null;
        value = html.slice(valueStart, valueEnd);
        cursor = valueEnd + 1;
        if (html[cursor] !== ">" && !HTML_WHITESPACE.has(html[cursor] ?? "")) {
          return null;
        }
      } else {
        const valueStart = cursor;
        while (
          cursor < html.length &&
          !HTML_WHITESPACE.has(html[cursor]) &&
          html[cursor] !== ">"
        ) {
          if (['"', "'", "<", "=", "`"].includes(html[cursor])) return null;
          cursor += 1;
        }
        if (cursor === valueStart) return null;
        value = html.slice(valueStart, cursor);
      }
    }

    if (name === "data-dpl-id") attributes.push({ quoted, value });
  }
  return null;
}

export function assertHtmlDocumentDeploymentIdentity(
  html,
  expectedDeploymentId,
  failureMessage,
) {
  if (
    typeof html !== "string" ||
    typeof expectedDeploymentId !== "string" ||
    expectedDeploymentId.length === 0
  ) {
    throw new Error(failureMessage);
  }
  const attributes = leadingHtmlAttributes(html);
  if (
    !attributes ||
    attributes.length !== 1 ||
    !attributes[0].quoted ||
    attributes[0].value !== expectedDeploymentId
  ) {
    throw new Error(failureMessage);
  }
}

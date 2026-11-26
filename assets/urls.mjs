export function normalizeUrl(value) {
  const input = String(value ?? "").trim();
  const fail = () => {
    throw new Error("Escribe un dominio o una dirección HTTP o HTTPS válida.");
  };
  if (!input || /^[\/\\]/.test(input) || /[\u0000-\u001f\\]/.test(input))
    fail();
  const explicit = /^https?:\/\//i.test(input);
  if (
    !explicit &&
    /^[a-z][a-z0-9+.-]*:/i.test(input) &&
    !/^[\w.-]+:\d+(?:[/?#]|$)/.test(input)
  )
    fail();
  let url;
  try {
    url = new URL(explicit ? input : "https://" + input);
  } catch {
    fail();
  }
  if (!url.hostname || url.username || url.password) fail();
  const host = url.hostname;
  const local =
    !host.includes(".") ||
    /\.(localhost|test|local|lan|internal)$/i.test(host) ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (!explicit && local) url.protocol = "http:";
  return url.href;
}

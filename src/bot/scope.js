export function resolveScopeIdFromMessage(msg) {
  const chat = msg?.chat || {};
  const type = String(chat?.type || "").toLowerCase();
  if (type === "private") {
    const uid = msg?.from?.id;
    return uid != null ? `u:${uid}` : "u:0";
  }
  if (type === "channel") {
    const cid = chat?.id;
    return cid != null ? `c:${cid}` : "c:0";
  }
  const gid = chat?.id;
  return gid != null ? `g:${gid}` : "g:0";
}

export function resolveTargetId(msg) {
  const chat = msg?.chat || {};
  const type = String(chat?.type || "").toLowerCase();
  if (type === "private") return msg?.from?.id ?? 0;
  return chat?.id ?? 0;
}

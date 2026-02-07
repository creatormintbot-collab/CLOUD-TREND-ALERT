let allowedGroupIds = new Set();
let allowedChannelIds = new Set();

function stripInlineComment(v) {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+#.*$/, "").trim();
}

export function parseAllowedIds(str) {
  const cleaned = stripInlineComment(str);
  if (!cleaned) return [];
  return cleaned.split(",").map((x) => x.trim()).filter(Boolean).map(String);
}

export function configureAccessPolicy({ allowedGroups = [], allowedChannels = [] } = {}) {
  allowedGroupIds = new Set((allowedGroups || []).map(String));
  allowedChannelIds = new Set((allowedChannels || []).map(String));
}

export function isAllowedGroup(chatId) {
  return allowedGroupIds.has(String(chatId));
}

export function isAllowedChannel(chatId) {
  return allowedChannelIds.has(String(chatId));
}

export function shouldAutoLeave(chat) {
  const type = String(chat?.type || "").toLowerCase();
  if (type === "group" || type === "supergroup") return !isAllowedGroup(chat?.id);
  if (type === "channel") return !isAllowedChannel(chat?.id);
  return false;
}

export function restrictedText(chat) {
  const type = String(chat?.type || "").toLowerCase();
  const label = type === "channel" ? "channel" : "group";
  return [
    "CLOUD TREND ALERT",
    "━━━━━━━━━━━━━━━━━━",
    "Access Restricted",
    `This bot is only available in approved ${label}s.`,
    "If you believe this is a mistake, contact the admin."
  ].join("\n");
}

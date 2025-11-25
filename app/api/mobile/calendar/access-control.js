const PRIVILEGED_CALENDAR_ROLES = new Set(['SUPERADMIN', 'DIREKTUR', 'HR', 'OPERASIONAL', 'ADMIN', 'MANAGER']);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

export function resolveTargetUserAccess(actor, requestedUserId) {
  const actorId = String(actor?.id || '').trim();
  const requestedId = String(requestedUserId || '').trim();

  if (!requestedId || requestedId === actorId) {
    return { targetUserId: actorId, allowed: true };
  }

  const role = normalizeRole(actor?.role);
  if (PRIVILEGED_CALENDAR_ROLES.has(role)) {
    return { targetUserId: requestedId, allowed: true };
  }

  return { targetUserId: actorId, allowed: false };
}

export { PRIVILEGED_CALENDAR_ROLES };

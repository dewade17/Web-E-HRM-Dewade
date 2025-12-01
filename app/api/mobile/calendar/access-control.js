const PRIVILEGED_CALENDAR_ROLES = new Set(['SUPERADMIN', 'DIREKTUR', 'HR', 'OPERASIONAL', 'ADMIN', 'MANAGER']);

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase();
}

export function resolveTargetUserAccess(actor, requestedUserId, options = {}) {
  const actorId = String(actor?.id || '').trim();
  const requestedId = String(requestedUserId || '').trim();

  const response = {
    targetUserId: actorId,
    allowed: true,
    approvedOnly: false,
    crossUser: false,
  };

  if (!requestedId || requestedId === actorId) {
    return response;
  }

  const role = normalizeRole(actor?.role);
  if (PRIVILEGED_CALENDAR_ROLES.has(role)) {
    return { ...response, targetUserId: requestedId, crossUser: true };
  }

  const allowApprovedRead = Boolean(options.allowApprovedRead) && Boolean(options.isApprovedOnly);
  if (allowApprovedRead) {
    return {
      ...response,
      targetUserId: requestedId,
      crossUser: true,
      approvedOnly: true,
    };
  }

  return { ...response, allowed: false };
}

export { PRIVILEGED_CALENDAR_ROLES };

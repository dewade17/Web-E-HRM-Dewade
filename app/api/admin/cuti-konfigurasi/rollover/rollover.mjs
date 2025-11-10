export const MONTH_NAMES = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

export function getMonthPair(referenceDate = new Date()) {
  if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) {
    throw new Error('referenceDate must be a valid Date instance');
  }

  const monthIndex = referenceDate.getUTCMonth();
  const previousIndex = (monthIndex + 11) % 12;

  return {
    currentMonth: MONTH_NAMES[monthIndex],
    previousMonth: MONTH_NAMES[previousIndex],
  };
}

function filterActiveUsers(users = []) {
  return users.filter((user) => {
    if (!user) return false;
    const status = String(user.status_cuti || '').toLowerCase();
    const deleted = user.deleted_at ?? null;
    return status === 'aktif' && deleted === null;
  });
}

function normalizeConfigRecord(record) {
  if (!record) return null;
  return {
    id_cuti_konfigurasi: record.id_cuti_konfigurasi,
    id_user: record.id_user,
    bulan: record.bulan,
    kouta_cuti: typeof record.kouta_cuti === 'number' ? record.kouta_cuti : 0,
  };
}

export async function rolloverCutiKonfigurasi(prisma, options = {}) {
  if (!prisma) throw new Error('A prisma client instance is required');

  const { referenceDate = new Date() } = options;
  const { currentMonth, previousMonth } = getMonthPair(referenceDate);

  const activeUsers = await prisma.user.findMany({
    where: { status_cuti: 'aktif', deleted_at: null },
    select: { id_user: true, status_cuti: true, deleted_at: true },
  });
  const filteredUsers = filterActiveUsers(activeUsers);

  if (filteredUsers.length === 0) {
    return {
      fromMonth: previousMonth,
      toMonth: currentMonth,
      processedUsers: 0,
      carriedOverUsers: 0,
      totalCarriedOver: 0,
      createdConfigurations: 0,
      updatedConfigurations: 0,
      zeroedUsers: 0,
      details: [],
    };
  }

  const userIds = filteredUsers.map((user) => user.id_user);

  const [previousConfigsRaw, nextConfigsRaw] = await Promise.all([
    prisma.cutiKonfigurasi.findMany({ where: { bulan: previousMonth, id_user: { in: userIds } } }),
    prisma.cutiKonfigurasi.findMany({ where: { bulan: currentMonth, id_user: { in: userIds } } }),
  ]);

  const previousConfigs = new Map();
  for (const record of previousConfigsRaw.map(normalizeConfigRecord)) {
    if (record) previousConfigs.set(record.id_user, record);
  }

  const nextConfigs = new Map();
  for (const record of nextConfigsRaw.map(normalizeConfigRecord)) {
    if (record) nextConfigs.set(record.id_user, record);
  }

  const details = [];

  let carriedOverUsers = 0;
  let totalCarriedOver = 0;
  let createdConfigurations = 0;
  let updatedConfigurations = 0;
  let zeroedUsers = 0;

  for (const userId of userIds) {
    const previousRecord = previousConfigs.get(userId);
    if (!previousRecord) continue;

    const leftoverRaw = typeof previousRecord.kouta_cuti === 'number' ? previousRecord.kouta_cuti : 0;
    const leftover = leftoverRaw > 0 ? leftoverRaw : 0;
    let createdNext = false;
    let updatedNext = false;

    if (leftover > 0) {
      const nextRecord = nextConfigs.get(userId);
      if (nextRecord) {
        const newQuota = (nextRecord.kouta_cuti || 0) + leftover;
        const updated = await prisma.cutiKonfigurasi.update({
          where: { id_cuti_konfigurasi: nextRecord.id_cuti_konfigurasi },
          data: { kouta_cuti: newQuota },
        });
        nextConfigs.set(userId, normalizeConfigRecord(updated));
        updatedConfigurations += 1;
        updatedNext = true;
      } else {
        const created = await prisma.cutiKonfigurasi.create({
          data: {
            id_user: userId,
            bulan: currentMonth,
            kouta_cuti: leftover,
            cuti_tabung: 0,
          },
        });
        nextConfigs.set(userId, normalizeConfigRecord(created));
        createdConfigurations += 1;
        createdNext = true;
      }
      carriedOverUsers += 1;
      totalCarriedOver += leftover;
    }

    if (leftoverRaw !== 0) {
      const updatedPrevious = await prisma.cutiKonfigurasi.update({
        where: { id_cuti_konfigurasi: previousRecord.id_cuti_konfigurasi },
        data: { kouta_cuti: 0 },
      });
      previousConfigs.set(userId, normalizeConfigRecord(updatedPrevious));
      zeroedUsers += 1;
    }

    details.push({
      userId,
      leftover,
      createdNext,
      updatedNext,
      previousQuotaBeforeReset: leftoverRaw,
    });
  }

  return {
    fromMonth: previousMonth,
    toMonth: currentMonth,
    processedUsers: details.length,
    carriedOverUsers,
    totalCarriedOver,
    createdConfigurations,
    updatedConfigurations,
    zeroedUsers,
    details,
  };
}

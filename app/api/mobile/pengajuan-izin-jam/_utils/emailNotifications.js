import transporter from '@/app/utils/mailer/mailer';

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: '2-digit',
});

const timeDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function stripUserIds(text) {
  if (!text) return '-';

  return text
    .replace(/@\[[^\]]+\]\s*\(\s*([^)]+)\s*\)/g, '$1')
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
    .replace(/@/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDateDisplay(value) {
  if (!value) return '-';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return dateDisplayFormatter.format(d);
  } catch {
    return '-';
  }
}

function formatTimeDisplay(value) {
  if (!value) return '-';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return timeDisplayFormatter.format(d);
  } catch {
    return '-';
  }
}

function escapeHtml(value) {
  const s = String(value ?? '');
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function normalizeEmail(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || !s.includes('@')) return null;
  return s;
}

function uniqueEmails(values) {
  const out = [];
  const seen = new Set();
  for (const v of values || []) {
    const email = normalizeEmail(v);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function makeEmailHtml({ title, introLines = [], fields = [], buttonUrl, buttonText }) {
  const titleHtml = escapeHtml(title || 'E-HRM');
  const introHtml = (introLines || [])
    .filter(Boolean)
    .map((l) => `<p style="margin:0 0 10px 0;">${escapeHtml(l)}</p>`)
    .join('');
  const rowsHtml = (fields || [])
    .filter((f) => f && f.label)
    .map((f) => {
      const label = escapeHtml(f.label);
      const value = escapeHtml(f.value ?? '-');
      return `
        <tr>
          <td style="padding:8px 10px; border:1px solid #e5e7eb; width:220px; font-weight:600; background:#f9fafb;">${label}</td>
          <td style="padding:8px 10px; border:1px solid #e5e7eb;">${value}</td>
        </tr>
      `;
    })
    .join('');
  const table = rowsHtml ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; margin-top:14px;"><tbody>${rowsHtml}</tbody></table>` : '';
  const btn = buttonUrl
    ? `<div style="margin-top:18px;"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block; padding:10px 14px; text-decoration:none; border-radius:10px; background:#111827; color:#ffffff; font-weight:700;">${escapeHtml(
        buttonText || 'Buka'
      )}</a></div>`
    : '';
  return `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; color:#111827; padding:16px;">
      <div style="max-width:640px; margin:0 auto; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden;">
        <div style="padding:16px 18px; background:#f3f4f6;"><h2 style="margin:0; font-size:18px;">${titleHtml}</h2></div>
        <div style="padding:18px;">${introHtml}${table}${btn}<p style="margin:18px 0 0 0; font-size:12px; color:#6b7280;">Email ini dikirim otomatis oleh sistem E-HRM.</p></div>
      </div>
    </div>
  `;
}

async function sendBatch({ from, to, subject, html }) {
  const recipients = uniqueEmails(to);
  if (!recipients.length) return [];
  const tasks = recipients.map((email) => transporter.sendMail({ from, to: email, subject, html }));
  return await Promise.allSettled(tasks);
}

export async function sendPengajuanIzinJamEmailNotifications(req, pengajuan) {
  const username = process.env.MAIL_USERNAME;
  const password = process.env.MAIL_PASSWORD;
  const from = process.env.MAIL_FROM || username;
  if (!from || !username || !password || !pengajuan) return;

  const url = 'https://e-hrm.onestepsolutionbali.com/home/pengajuan/izinJam';
  const pemohonNama = pengajuan.user?.nama_pengguna || 'Karyawan';
  const pemohonEmail = normalizeEmail(pengajuan.user?.email);
  const kategori = pengajuan.kategori?.nama_kategori || '-';
  const tanggalIzinDisplay = formatDateDisplay(pengajuan.tanggal_izin);
  const jamMulaiDisplay = formatTimeDisplay(pengajuan.jam_mulai);
  const jamSelesaiDisplay = formatTimeDisplay(pengajuan.jam_selesai);
  const jenisPengajuan = (pengajuan.jenis_pengajuan || '').trim() || '-';
  const keperluanText = stripUserIds(pengajuan.keperluan);
  const handoverText = stripUserIds(pengajuan.handover);
  const lampiranUrl = (pengajuan.lampiran_izin_jam_url || '').trim() || '-';

  const fields = [
    { label: 'Pemohon', value: pemohonNama },
    { label: 'Kategori', value: kategori },
    { label: 'Tanggal Izin', value: tanggalIzinDisplay },
    { label: 'Jam Izin', value: `${jamMulaiDisplay} - ${jamSelesaiDisplay}` },
    { label: 'Jenis Pengajuan', value: jenisPengajuan },
    { label: 'Keperluan', value: keperluanText },
    { label: 'Handover', value: handoverText },
  ];

  const hasPengganti = Boolean(pengajuan.tanggal_pengganti || pengajuan.jam_mulai_pengganti || pengajuan.jam_selesai_pengganti);
  if (hasPengganti) {
    fields.push({ label: 'Tanggal Pengganti', value: formatDateDisplay(pengajuan.tanggal_pengganti) });
    fields.push({ label: 'Jam Pengganti', value: `${formatTimeDisplay(pengajuan.jam_mulai_pengganti)} - ${formatTimeDisplay(pengajuan.jam_selesai_pengganti)}` });
  }

  if (lampiranUrl && lampiranUrl !== '-') {
    fields.push({ label: 'Lampiran', value: lampiranUrl });
  }

  const approverEmails = uniqueEmails((pengajuan.approvals || []).map((a) => a?.approver?.email));
  const handoverEmails = uniqueEmails((pengajuan.handover_users || []).map((h) => h?.user?.email));
  const ops = [];

  if (pemohonEmail) {
    ops.push(
      sendBatch({
        from,
        to: [pemohonEmail],
        subject: `[E-HRM] Pengajuan Izin Jam Berhasil Dikirim`,
        html: makeEmailHtml({
          title: 'Pengajuan Izin Jam Berhasil Dikirim',
          introLines: ['Pengajuan izin jam Anda telah berhasil dibuat dan dikirim untuk diproses.'],
          fields,
          buttonUrl: url,
          buttonText: 'Lihat Daftar Pengajuan',
        }),
      })
    );
  }

  if (approverEmails.length) {
    ops.push(
      sendBatch({
        from,
        to: approverEmails,
        subject: `[E-HRM] Permintaan Persetujuan Izin Jam (${pemohonNama})`,
        html: makeEmailHtml({
          title: 'Permintaan Persetujuan Izin Jam',
          introLines: [`Anda dipilih sebagai approver untuk pengajuan izin jam dari ${pemohonNama}.`],
          fields,
          buttonUrl: url,
          buttonText: 'Buka Menu Approval',
        }),
      })
    );
  }

  if (handoverEmails.length) {
    ops.push(
      sendBatch({
        from,
        to: handoverEmails,
        subject: `[E-HRM] Anda Ditunjuk Sebagai Handover Izin Jam (${pemohonNama})`,
        html: makeEmailHtml({
          title: 'Permintaan Handover Izin Jam',
          introLines: [`Anda ditandai sebagai pihak handover untuk pengajuan izin jam dari ${pemohonNama}.`],
          fields,
          buttonUrl: url,
          buttonText: 'Lihat Daftar Pengajuan',
        }),
      })
    );
  }

  if (ops.length) await Promise.allSettled(ops);
}

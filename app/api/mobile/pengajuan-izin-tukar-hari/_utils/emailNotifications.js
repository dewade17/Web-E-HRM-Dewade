import transporter from '@/app/utils/mailer/mailer';

const dateDisplayFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: '2-digit',
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

function escapeHtml(value) {
  const s = String(value ?? '');
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function normalizeEmail(email) {
  const v = String(email || '')
    .trim()
    .toLowerCase();
  if (!v || !v.includes('@')) return null;
  return v;
}

function uniqueEmails(emails) {
  const out = [];
  const seen = new Set();
  for (const e of emails || []) {
    const v = normalizeEmail(e);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
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
  const table = rowsHtml
    ? `
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; margin-top:14px;">
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `
    : '';
  const btn = buttonUrl
    ? `
      <div style="margin-top:18px;">
        <a href="${escapeHtml(buttonUrl)}"
           style="display:inline-block; padding:10px 14px; text-decoration:none; border-radius:10px; background:#111827; color:#ffffff; font-weight:700;">
          ${escapeHtml(buttonText || 'Buka')}
        </a>
      </div>
    `
    : '';
  return `
    <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; color:#111827; padding:166px;">
      <div style="max-width:640px; margin:0 auto; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden;">
        <div style="padding:16px 18px; background:#f3f4f6;">
          <h2 style="margin:0; font-size:18px;">${titleHtml}</h2>
        </div>
        <div style="padding:18px;">
          ${introHtml}
          ${table}
          ${btn}
          <p style="margin:18px 0 0 0; font-size:12px; color:#6b7280;">
            Email ini dikirim otomatis oleh sistem E-HRM.
          </p>
        </div>
      </div>
    </div>
  `;
}

async function sendBatch({ from, to, subject, html }) {
  const recipients = uniqueEmails(to);
  if (!recipients.length) return [];
  const tasks = recipients.map((email) =>
    transporter.sendMail({
      from,
      to: email,
      subject,
      html,
    })
  );
  const results = await Promise.allSettled(tasks);
  return results;
}

function formatPairs(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (!list.length) return '-';
  const lines = list.map((p) => {
    const a = formatDateDisplay(p?.hari_izin);
    const b = formatDateDisplay(p?.hari_pengganti);
    const note = (p?.catatan_pair || '').trim();
    return note ? `${a} → ${b} (${note})` : `${a} → ${b}`;
  });
  return lines.join('\n');
}

export async function sendPengajuanIzinTukarHariEmailNotifications(req, pengajuan) {
  const username = process.env.MAIL_USERNAME;
  const password = process.env.MAIL_PASSWORD;
  const from = process.env.MAIL_FROM || username;
  if (!from || !username || !password || !pengajuan) return;
  const url = 'https://e-hrm.onestepsolutionbali.com/home/pengajuan/tukarHari';
  const pemohonName = pengajuan.user?.nama_pengguna || 'Karyawan';
  const pemohonEmail = normalizeEmail(pengajuan.user?.email);
  const kategori = (pengajuan.kategori || '').trim() || '-';
  const keperluan = stripUserIds(pengajuan.keperluan);
  const handover = stripUserIds(pengajuan.handover);
  const lampiranUrl = (pengajuan.lampiran_izin_tukar_hari_url || '').trim() || '-';
  const pairsText = formatPairs(pengajuan.pairs);
  const fields = [
    { label: 'Pemohon', value: pemohonName },
    { label: 'Kategori', value: kategori },
    { label: 'Keperluan', value: keperluan },
    { label: 'Handover', value: handover },
    { label: 'Tanggal Tukar', value: pairsText },
  ];
  if (lampiranUrl && lampiranUrl !== '-') {
    fields.push({ label: 'Lampiran', value: lampiranUrl });
  }
  const approverEmails = uniqueEmails((pengajuan.approvals || []).map((a) => a?.approver?.email));
  const handoverEmails = uniqueEmails((pengajuan.handover_users || []).map((h) => h?.user?.email));
  const ops = [];
  if (pemohonEmail) {
    const subject = `[E-HRM] Pengajuan Tukar Hari Berhasil Dikirim`;
    const html = makeEmailHtml({
      title: 'Pengajuan Tukar Hari Berhasil Dikirim',
      introLines: ['Pengajuan tukar hari Anda telah berhasil dibuat dan dikirim untuk diproses.'],
      fields,
      buttonUrl: url,
      buttonText: 'Lihat Daftar Pengajuan',
    });
    ops.push(sendBatch({ from, to: [pemohonEmail], subject, html }));
  }
  if (approverEmails.length) {
    const subject = `[E-HRM] Permintaan Persetujuan Tukar Hari (${pemohonName})`;
    const html = makeEmailHtml({
      title: 'Permintaan Persetujuan Tukar Hari',
      introLines: [`Anda dipilih sebagai approver untuk pengajuan tukar hari dari ${pemohonName}.`],
      fields,
      buttonUrl: url,
      buttonText: 'Buka Menu Approval',
    });
    ops.push(sendBatch({ from, to: approverEmails, subject, html }));
  }
  if (handoverEmails.length) {
    const subject = `[E-HRM] Anda Ditunjuk Sebagai Handover Tukar Hari (${pemohonName})`;
    const html = makeEmailHtml({
      title: 'Penunjukan Handover Tukar Hari',
      introLines: [`Anda ditandai sebagai handover untuk pengajuan tukar hari dari ${pemohonName}.`],
      fields,
      buttonUrl: url,
      buttonText: 'Buka Daftar Pengajuan',
    });
    ops.push(sendBatch({ from, to: handoverEmails, subject, html }));
  }
  if (!ops.length) return;
  await Promise.allSettled(ops);
}

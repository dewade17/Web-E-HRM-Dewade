// app/api/admin/agenda-kerja-admin/import/template/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  const XLSX = await import('xlsx');

  const headers = ['Tanggal Proyek', 'Aktivitas', 'Proyek/Agenda', 'Mulai', 'Selesai', 'Status'];
  const sample = [
    {
      'Tanggal Proyek': '2025-01-01',
      Aktivitas: 'Contoh pekerjaan',
      'Proyek/Agenda': 'E-HRM',
      Mulai: '08:00',
      Selesai: '17:00',
      Status: 'diproses',
    },
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sample, { header: headers });
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new Response(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="format-import-timesheet.xlsx"',
    },
  });
}

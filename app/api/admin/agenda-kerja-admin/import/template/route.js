export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  const XLSX = await import('xlsx');

  // Hanya 3 kolom: Tanggal Proyek, Aktivitas, Proyek/Agenda
  const headers = ['Tanggal Proyek', 'Aktivitas', 'Proyek/Agenda'];
  const sample = [
    {
      'Tanggal Proyek': '2025-01-01',
      'Aktivitas': 'Contoh pekerjaan',
      'Proyek/Agenda': 'E-HRM',
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

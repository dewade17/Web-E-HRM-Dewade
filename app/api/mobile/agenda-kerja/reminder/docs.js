/**
 * @swagger
 * /api/mobile/agenda-kerja/reminder:
 * post:
 * summary: Proses pengiriman reminder agenda
 * description: Memicu pengiriman notifikasi reminder untuk agenda kerja yang akan berakhir dalam jendela waktu tertentu.
 * tags: [Mobile - Agenda Kerja]
 * parameters:
 * - in: query
 * name: windowMinutes
 * schema:
 * type: integer
 * minimum: 1
 * maximum: 1440
 * default: 60
 * description: Rentang menit ke depan untuk memeriksa deadline agenda.
 * responses:
 * '200':
 * description: Proses reminder selesai.
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * ok:
 * type: boolean
 * message:
 * type: string
 * data:
 * type: object
 * properties:
 * windowMinutes:
 * type: integer
 * totalCandidates:
 * type: integer
 * totalSent:
 * type: integer
 * totalSkipped:
 * type: integer
 * '401':
 * description: Tidak terautentikasi.
 * '500':
 * description: Gagal memproses reminder agenda kerja.
 */
export const agendaReminderDocs = {};

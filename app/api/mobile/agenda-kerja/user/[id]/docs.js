/**
 * @swagger
 * /api/mobile/agenda-kerja/user/{id}:
 * get:
 * summary: Daftar agenda kerja per pengguna
 * description: Ambil agenda kerja milik pengguna tertentu dengan filter status, rentang tanggal, dan keterkaitan absensi.
 * tags: [Mobile - Agenda Kerja]
 * security:
 * - BearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * description: ID pengguna.
 * - in: query
 * name: status
 * schema:
 * type: string
 * enum: [teragenda, diproses, ditunda, selesai]
 * description: Filter berdasarkan status agenda.
 * - in: query
 * name: from
 * schema:
 * type: string
 * format: date-time
 * description: Batas awal start_date.
 * - in: query
 * name: to
 * schema:
 * type: string
 * format: date-time
 * description: Batas akhir start_date.
 * - in: query
 * name: has_absensi
 * schema:
 * type: string
 * enum: ['1', '0', 'true', 'false']
 * description: Filter apakah agenda memiliki absensi terkait.
 * - in: query
 * name: limit
 * schema:
 * type: integer
 * minimum: 1
 * maximum: 200
 * default: 50
 * - in: query
 * name: offset
 * schema:
 * type: integer
 * minimum: 0
 * default: 0
 * responses:
 * '200':
 * description: Daftar agenda kerja pengguna.
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * ok:
 * type: boolean
 * meta:
 * type: object
 * properties:
 * total:
 * type: integer
 * limit:
 * type: integer
 * offset:
 * type: integer
 * nextOffset:
 * type: integer
 * nullable: true
 * data:
 * type: array
 * items:
 * $ref: '#/components/schemas/MobileAgendaKerja'
 * '400':
 * description: Parameter tidak valid.
 * '401':
 * description: Tidak terautentikasi.
 * '500':
 * description: Gagal mengambil daftar agenda kerja.
 */
export const agendaUserIdDocs = {};

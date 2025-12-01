/**
 * BAGIAN 1: DEFINISI SCHEMA (MODEL DATA)
 * Digunakan untuk mereferensikan objek data ($ref) di dalam routes.
 */

/**
 * @swagger
 * components:
 * schemas:
 * MobileAgendaKerja:
 * type: object
 * properties:
 * id_agenda_kerja:
 * type: string
 * id_user:
 * type: string
 * id_agenda:
 * type: string
 * deskripsi_kerja:
 * type: string
 * status:
 * type: string
 * enum: [teragenda, diproses, ditunda, selesai]
 * start_date:
 * type: string
 * format: date-time
 * nullable: true
 * end_date:
 * type: string
 * format: date-time
 * nullable: true
 * duration_seconds:
 * type: integer
 * nullable: true
 * kebutuhan_agenda:
 * type: string
 * nullable: true
 * id_absensi:
 * type: string
 * nullable: true
 * created_at:
 * type: string
 * format: date-time
 * updated_at:
 * type: string
 * format: date-time
 * deleted_at:
 * type: string
 * format: date-time
 * nullable: true
 */
export const mobileAgendaSchema = {};

/**
 * BAGIAN 2: DEFINISI PATHS (ROUTES API)
 * Berisi semua endpoint: List, Create, Detail, Update, Delete, User Filter, Reminder.
 */

/**
 * @swagger
 * /api/mobile/agenda-kerja:
 * get:
 * summary: Daftar agenda kerja mobile
 * description: Ambil daftar agenda kerja dengan filter user, agenda, absensi, status, kebutuhan, serta rentang tanggal.
 * tags: [Mobile - Agenda Kerja]
 * security:
 * - BearerAuth: []
 * parameters:
 * - in: query
 * name: page
 * schema:
 * type: integer
 * minimum: 1
 * default: 1
 * - in: query
 * name: perPage
 * schema:
 * type: integer
 * minimum: 1
 * maximum: 100
 * default: 20
 * - in: query
 * name: user_id
 * schema:
 * type: string
 * - in: query
 * name: id_agenda
 * schema:
 * type: string
 * - in: query
 * name: id_absensi
 * schema:
 * type: string
 * - in: query
 * name: status
 * schema:
 * type: string
 * enum: [teragenda, diproses, ditunda, selesai]
 * - in: query
 * name: date
 * schema:
 * type: string
 * format: date-time
 * - in: query
 * name: from
 * schema:
 * type: string
 * format: date-time
 * - in: query
 * name: to
 * schema:
 * type: string
 * format: date-time
 * responses:
 * '200':
 * description: Daftar agenda kerja berhasil diambil.
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * ok:
 * type: boolean
 * data:
 * type: array
 * items:
 * $ref: '#/components/schemas/MobileAgendaKerja'
 * meta:
 * type: object
 * properties:
 * page:
 * type: integer
 * perPage:
 * type: integer
 * total:
 * type: integer
 * totalPages:
 * type: integer
 * '401':
 * description: Tidak terautentikasi.
 * '500':
 * description: Gagal mengambil data.
 * post:
 * summary: Tambah agenda kerja
 * description: Membuat agenda kerja baru dari aplikasi mobile.
 * tags: [Mobile - Agenda Kerja]
 * security:
 * - BearerAuth: []
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * required: [id_user, id_agenda, deskripsi_kerja]
 * properties:
 * id_user:
 * type: string
 * id_agenda:
 * type: string
 * deskripsi_kerja:
 * type: string
 * status:
 * type: string
 * enum: [teragenda, diproses, ditunda, selesai]
 * default: teragenda
 * start_date:
 * type: string
 * format: date-time
 * end_date:
 * type: string
 * format: date-time
 * duration_seconds:
 * type: integer
 * id_absensi:
 * type: string
 * nullable: true
 * kebutuhan_agenda:
 * type: string
 * nullable: true
 * responses:
 * '201':
 * description: Agenda kerja berhasil dibuat.
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
 * $ref: '#/components/schemas/MobileAgendaKerja'
 * '400':
 * description: Input tidak valid.
 * '401':
 * description: Tidak terautentikasi.
 * '500':
 * description: Gagal membuat agenda kerja.
 *
 * /api/mobile/agenda-kerja/{id}:
 * get:
 * summary: Detail agenda kerja
 * tags: [Mobile - Agenda Kerja]
 * security:
 * - BearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * responses:
 * '200':
 * description: Detail agenda kerja.
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * ok:
 * type: boolean
 * data:
 * $ref: '#/components/schemas/MobileAgendaKerja'
 * '404':
 * description: Agenda kerja tidak ditemukan.
 * put:
 * summary: Perbarui agenda kerja
 * tags: [Mobile - Agenda Kerja]
 * security:
 * - BearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * requestBody:
 * required: true
 * content:
 * application/json:
 * schema:
 * type: object
 * properties:
 * id_user:
 * type: string
 * id_agenda:
 * type: string
 * deskripsi_kerja:
 * type: string
 * status:
 * type: string
 * enum: [teragenda, diproses, ditunda, selesai]
 * start_date:
 * type: string
 * format: date-time
 * end_date:
 * type: string
 * format: date-time
 * duration_seconds:
 * type: integer
 * id_absensi:
 * type: string
 * nullable: true
 * kebutuhan_agenda:
 * type: string
 * nullable: true
 * responses:
 * '200':
 * description: Agenda kerja berhasil diperbarui.
 * '404':
 * description: Agenda kerja tidak ditemukan.
 * delete:
 * summary: Hapus agenda kerja
 * tags: [Mobile - Agenda Kerja]
 * security:
 * - BearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * - in: query
 * name: hard
 * schema:
 * type: string
 * enum: ['0', '1', 'true', 'false']
 * description: Gunakan `1` untuk menghapus permanen.
 * responses:
 * '200':
 * description: Agenda kerja berhasil dihapus.
 *
 * /api/mobile/agenda-kerja/user/{id}:
 * get:
 * summary: Daftar agenda kerja per pengguna
 * tags: [Mobile - Agenda Kerja]
 * security:
 * - BearerAuth: []
 * parameters:
 * - in: path
 * name: id
 * required: true
 * schema:
 * type: string
 * - in: query
 * name: status
 * schema:
 * type: string
 * enum: [teragenda, diproses, ditunda, selesai]
 * - in: query
 * name: from
 * schema:
 * type: string
 * format: date-time
 * - in: query
 * name: to
 * schema:
 * type: string
 * format: date-time
 * - in: query
 * name: has_absensi
 * schema:
 * type: string
 * enum: ['1', '0', 'true', 'false']
 * - in: query
 * name: limit
 * schema:
 * type: integer
 * default: 50
 * - in: query
 * name: offset
 * schema:
 * type: integer
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
 * data:
 * type: array
 * items:
 * $ref: '#/components/schemas/MobileAgendaKerja'
 *
 * /api/mobile/agenda-kerja/reminder:
 * post:
 * summary: Proses pengiriman reminder agenda
 * tags: [Mobile - Agenda Kerja]
 * parameters:
 * - in: query
 * name: windowMinutes
 * schema:
 * type: integer
 * default: 60
 * responses:
 * '200':
 * description: Proses reminder selesai.
 */
export const mobileAgendaPaths = {};

// BAGIAN 3: PENGGABUNGAN (EXPORT)
// Kita gabungkan kedua objek di atas agar Swagger membacanya sebagai satu kesatuan.

const mobileAgendaDocs = {
  ...mobileAgendaSchema,
  ...mobileAgendaPaths,
};

export default mobileAgendaDocs;

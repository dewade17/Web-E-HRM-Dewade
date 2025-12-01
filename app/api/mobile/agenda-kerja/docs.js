/**
 * @swagger
 * tags:
 *   - name: Mobile - Agenda Kerja
 *     description: Endpoint manajemen agenda kerja untuk aplikasi mobile.
 * /api/mobile/agenda-kerja:
 *   get:
 *     summary: Daftar agenda kerja
 *     description: Mengambil daftar agenda kerja dengan filter, paginasi, dan rentang tanggal.
 *     tags: [Mobile - Agenda Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Halaman yang akan diambil.
 *       - in: query
 *         name: perPage
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Jumlah data per halaman.
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter berdasarkan ID pengguna.
 *       - in: query
 *         name: id_agenda
 *         schema:
 *           type: string
 *         description: Filter berdasarkan ID agenda master.
 *       - in: query
 *         name: id_absensi
 *         schema:
 *           type: string
 *         description: Filter berdasarkan ID absensi.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [teragenda, diproses, ditunda, selesai]
 *         description: Filter berdasarkan status agenda.
 *       - in: query
 *         name: kebutuhan_agenda
 *         schema:
 *           type: string
 *           nullable: true
 *         description: Filter berdasarkan kebutuhan agenda. Kirim string kosong untuk nilai `null`.
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Ambil agenda yang aktif pada tanggal tertentu (UTC).
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Batas awal rentang tanggal (UTC). Gunakan bersama `to`.
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Batas akhir rentang tanggal (UTC). Gunakan bersama `from`.
 *     responses:
 *       '200':
 *         description: Daftar agenda kerja berhasil diambil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MobileAgendaKerja'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Terjadi kesalahan saat mengambil data.
 *   post:
 *     summary: Tambah agenda kerja
 *     description: Membuat agenda kerja baru untuk pengguna.
 *     tags: [Mobile - Agenda Kerja]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - id_user
 *               - id_agenda
 *               - deskripsi_kerja
 *             properties:
 *               id_user:
 *                 type: string
 *               id_agenda:
 *                 type: string
 *               deskripsi_kerja:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [teragenda, diproses, ditunda, selesai]
 *                 default: teragenda
 *               start_date:
 *                 type: string
 *                 format: date-time
 *               end_date:
 *                 type: string
 *                 format: date-time
 *               duration_seconds:
 *                 type: integer
 *               id_absensi:
 *                 type: string
 *                 nullable: true
 *               kebutuhan_agenda:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       '201':
 *         description: Agenda kerja berhasil dibuat.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MobileAgendaKerja'
 *       '400':
 *         description: Data yang dikirim tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: ID user atau agenda tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan saat membuat agenda.
 * components:
 *   schemas:
 *     MobileAgendaKerja:
 *       type: object
 *       properties:
 *         id_agenda_kerja:
 *           type: string
 *         id_user:
 *           type: string
 *         id_agenda:
 *           type: string
 *         id_absensi:
 *           type: string
 *           nullable: true
 *         deskripsi_kerja:
 *           type: string
 *         start_date:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         end_date:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         duration_seconds:
 *           type: integer
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [teragenda, diproses, ditunda, selesai]
 *         kebutuhan_agenda:
 *           type: string
 *           nullable: true
 *         created_by_snapshot:
 *           type: string
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *         deleted_at:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         agenda:
 *           type: object
 *           nullable: true
 *           properties:
 *             id_agenda:
 *               type: string
 *             nama_agenda:
 *               type: string
 *         absensi:
 *           type: object
 *           nullable: true
 *           properties:
 *             id_absensi:
 *               type: string
 *             tanggal:
 *               type: string
 *               format: date-time
 *               nullable: true
 *             jam_masuk:
 *               type: string
 *               nullable: true
 *             jam_pulang:
 *               type: string
 *               nullable: true
 *         user:
 *           type: object
 *           nullable: true
 *           properties:
 *             id_user:
 *               type: string
 *             nama_pengguna:
 *               type: string
 *             email:
 *               type: string
 *             role:
 *               type: string
 *     PaginationMeta:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *         perPage:
 *           type: integer
 *         total:
 *           type: integer
 *         totalPages:
 *           type: integer
 */
const agendaKerjaDocs = {};

export default agendaKerjaDocs;

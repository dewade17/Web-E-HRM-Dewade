/**
 * @swagger
 * tags:
 *   - name: Mobile - Kunjungan Klien
 *     description: Endpoint pengelolaan kunjungan klien pada aplikasi mobile.
 * components:
 *   schemas:
 *     MobileKunjunganKlienKategori:
 *       type: object
 *       properties:
 *         id_kategori_kunjungan:
 *           type: string
 *         kategori_kunjungan:
 *           type: string
 *     MobileKunjunganKlienReport:
 *       type: object
 *       properties:
 *         id_kunjungan_report_recipient:
 *           type: string
 *         id_user:
 *           type: string
 *         recipient_nama_snapshot:
 *           type: string
 *         recipient_role_snapshot:
 *           type: string
 *         catatan:
 *           type: string
 *         status:
 *           type: string
 *         notified_at:
 *           type: string
 *           format: date-time
 *         read_at:
 *           type: string
 *           format: date-time
 *         acted_at:
 *           type: string
 *           format: date-time
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 *     MobileKunjunganKlienUser:
 *       type: object
 *       properties:
 *         id_user:
 *           type: string
 *         nama_pengguna:
 *           type: string
 *         email:
 *           type: string
 *     MobileKunjunganKlien:
 *       type: object
 *       properties:
 *         id_kunjungan:
 *           type: string
 *         id_user:
 *           type: string
 *         id_kategori_kunjungan:
 *           type: string
 *         deskripsi:
 *           type: string
 *           nullable: true
 *         hand_over:
 *           type: string
 *           nullable: true
 *         tanggal:
 *           type: string
 *           format: date-time
 *         jam_mulai:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         jam_selesai:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         jam_checkin:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         jam_checkout:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         start_latitude:
 *           type: number
 *           nullable: true
 *         start_longitude:
 *           type: number
 *           nullable: true
 *         end_latitude:
 *           type: number
 *           nullable: true
 *         end_longitude:
 *           type: number
 *           nullable: true
 *         lampiran_kunjungan_url:
 *           type: string
 *           nullable: true
 *         status_kunjungan:
 *           type: string
 *           enum: [diproses, berlangsung, selesai]
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
 *         kategori:
 *           $ref: '#/components/schemas/MobileKunjunganKlienKategori'
 *         user:
 *           $ref: '#/components/schemas/MobileKunjunganKlienUser'
 *         reports:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/MobileKunjunganKlienReport'
 *     PaginationMeta:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *         pageSize:
 *           type: integer
 *         total:
 *           type: integer
 *         totalPages:
 *           type: integer
 * /api/mobile/kunjungan-klien:
 *   get:
 *     summary: Daftar kunjungan klien
 *     description: Mengambil daftar rencana kunjungan klien dengan filter, pencarian, dan paginasi.
 *     tags: [Mobile - Kunjungan Klien]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *       - in: query
 *         name: perPage
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *         description: Alias untuk `pageSize`.
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Kata kunci pencarian pada deskripsi atau hand-over.
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Alias untuk `q`.
 *       - in: query
 *         name: id_kategori_kunjungan
 *         schema:
 *           type: string
 *         description: Filter berdasarkan kategori kunjungan.
 *       - in: query
 *         name: kategoriId
 *         schema:
 *           type: string
 *         description: Alias untuk `id_kategori_kunjungan`.
 *       - in: query
 *         name: tanggal
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter kunjungan pada tanggal tertentu (format YYYY-MM-DD).
 *     responses:
 *       '200':
 *         description: Daftar kunjungan klien berhasil diambil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MobileKunjunganKlien'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       '400':
 *         description: Parameter pencarian tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Terjadi kesalahan pada server.
 *   post:
 *     summary: Tambah rencana kunjungan
 *     description: Membuat entri kunjungan klien baru. User dengan peran operasional dapat membuatkan kunjungan untuk pengguna lain.
 *     tags: [Mobile - Kunjungan Klien]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_kategori_kunjungan, tanggal]
 *             properties:
 *               id_kategori_kunjungan:
 *                 type: string
 *               id_user:
 *                 type: string
 *                 description: Opsional, hanya dipakai oleh Operasional/Superadmin untuk menetapkan ke user lain.
 *               deskripsi:
 *                 type: string
 *                 nullable: true
 *               tanggal:
 *                 type: string
 *                 format: date
 *                 description: Tanggal kunjungan (format YYYY-MM-DD).
 *               jam_mulai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *               jam_selesai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *     responses:
 *       '201':
 *         description: Kunjungan klien berhasil dibuat.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MobileKunjunganKlien'
 *       '400':
 *         description: Data yang dikirim tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Kesalahan server saat membuat kunjungan.
 */

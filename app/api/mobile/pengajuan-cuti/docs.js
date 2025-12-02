/**
 * @swagger
 * tags:
 *   - name: Mobile - Pengajuan Cuti
 *     description: Endpoint pengajuan cuti untuk aplikasi mobile.
 * /api/mobile/pengajuan-cuti:
 *   get:
 *     summary: Daftar pengajuan cuti
 *     description: Mengambil daftar pengajuan cuti dengan filter status, kategori, tanggal cuti, dan tanggal masuk kerja.
 *     tags: [Mobile - Pengajuan Cuti]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Nomor halaman.
 *       - in: query
 *         name: perPage
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Jumlah data per halaman.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, disetujui, ditolak]
 *         description: Filter berdasarkan status persetujuan.
 *       - in: query
 *         name: id_user
 *         schema:
 *           type: string
 *         description: Filter ID pemohon (khusus role admin).
 *       - in: query
 *         name: id_kategori_cuti
 *         schema:
 *           type: string
 *         description: Filter berdasarkan kategori cuti.
 *       - in: query
 *         name: tanggal_cuti
 *         schema:
 *           type: string
 *           format: date
 *         description: Cari pengajuan yang memiliki tanggal cuti tertentu.
 *       - in: query
 *         name: tanggal_cuti_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas awal rentang tanggal cuti.
 *       - in: query
 *         name: tanggal_cuti_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas akhir rentang tanggal cuti.
 *       - in: query
 *         name: tanggal_masuk_kerja
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tanggal masuk kerja pada satu tanggal tertentu.
 *       - in: query
 *         name: tanggal_masuk_kerja_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas awal rentang tanggal masuk kerja.
 *       - in: query
 *         name: tanggal_masuk_kerja_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas akhir rentang tanggal masuk kerja.
 *     responses:
 *       '200':
 *         description: Daftar pengajuan cuti berhasil diambil.
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
 *                     $ref: '#/components/schemas/MobilePengajuanCuti'
 *                 meta:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       '400':
 *         description: Parameter filter tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Terjadi kesalahan saat mengambil data.
 *   post:
 *     summary: Ajukan cuti baru
 *     description: Membuat pengajuan cuti baru berikut tanggal cuti, tanggal masuk kerja, lampiran, dan daftar handover.
 *     tags: [Mobile - Pengajuan Cuti]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePengajuanCutiPayload'
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/CreatePengajuanCutiPayload'
 *               - type: object
 *                 properties:
 *                   lampiran_cuti:
 *                     type: string
 *                     format: binary
 *     responses:
 *       '200':
 *         description: Pengajuan cuti berhasil dibuat.
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
 *                   $ref: '#/components/schemas/MobilePengajuanCuti'
 *                 upload:
 *                   type: object
 *                   nullable: true
 *       '400':
 *         description: Data yang dikirim tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Kategori cuti atau pengguna tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan saat membuat pengajuan.
 * components:
 *   schemas:
 *     CreatePengajuanCutiPayload:
 *       type: object
 *       required:
 *         - id_kategori_cuti
 *         - tanggal_cuti
 *         - tanggal_masuk_kerja
 *       properties:
 *         id_kategori_cuti:
 *           type: string
 *         tanggal_cuti:
 *           type: array
 *           items:
 *             type: string
 *             format: date
 *           description: Daftar tanggal cuti (format YYYY-MM-DD).
 *         tanggal_masuk_kerja:
 *           type: string
 *           format: date
 *           description: Tanggal kembali masuk kerja (format YYYY-MM-DD) dan harus setelah tanggal cuti.
 *         keperluan:
 *           type: string
 *           nullable: true
 *         handover:
 *           type: string
 *           nullable: true
 *         handover_tag_user_ids:
 *           type: array
 *           items:
 *             type: string
 *           description: Daftar ID pengguna yang ditandai sebagai handover.
 *         approvals:
 *           type: array
 *           nullable: true
 *           description: Rantai persetujuan opsional yang dikirim dari klien.
 *           items:
 *             type: object
 *             properties:
 *               level:
 *                 type: integer
 *               approver_user_id:
 *                 type: string
 *               approver_role:
 *                 type: string
 *         lampiran_cuti:
 *           type: string
 *           format: binary
 *           nullable: true
 *     MobilePengajuanCuti:
 *       type: object
 *       properties:
 *         id_pengajuan_cuti:
 *           type: string
 *         id_user:
 *           type: string
 *         id_kategori_cuti:
 *           type: string
 *         status:
 *           type: string
 *           enum: [pending, disetujui, ditolak]
 *         keperluan:
 *           type: string
 *           nullable: true
 *         handover:
 *           type: string
 *           nullable: true
 *         tanggal_cuti:
 *           type: string
 *           format: date
 *           nullable: true
 *         tanggal_selesai:
 *           type: string
 *           format: date
 *           nullable: true
 *         tanggal_masuk_kerja:
 *           type: string
 *           format: date
 *         tanggal_list:
 *           type: array
 *           items:
 *             type: string
 *             format: date
 *         lampiran_cuti_url:
 *           type: string
 *           format: uri
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
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

/**
 * @swagger
 * tags:
 *   - name: Mobile - Pengajuan Izin Jam
 *     description: Endpoint pengajuan izin jam karyawan (mobile).
 * /api/mobile/pengajuan-izin-jam:
 *   get:
 *     summary: Daftar pengajuan izin jam
 *     description: Mengambil daftar pengajuan izin jam dengan filter status, rentang tanggal, dan kata kunci.
 *     tags: [Mobile - Pengajuan Izin Jam]
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
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, disetujui, ditolak]
 *         description: Filter berdasarkan status pengajuan.
 *       - in: query
 *         name: id_user
 *         schema:
 *           type: string
 *         description: ID user pemohon (khusus role admin/supervisor).
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Cari berdasarkan nama kategori, keperluan, atau handover.
 *       - in: query
 *         name: tanggal
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tanggal izin spesifik (UTC).
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         description: Tanggal awal rentang izin (UTC).
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         description: Tanggal akhir rentang izin (UTC).
 *     responses:
 *       '200':
 *         description: Daftar pengajuan izin jam berhasil diambil.
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
 *                     $ref: '#/components/schemas/PengajuanIzinJam'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     pageSize:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Server error.
 *   post:
 *     summary: Buat pengajuan izin jam
 *     description: Membuat pengajuan izin jam baru, termasuk upload lampiran dan daftar approver.
 *     tags: [Mobile - Pengajuan Izin Jam]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tanggal_izin, jam_mulai, jam_selesai, id_kategori_izin_jam]
 *             properties:
 *               tanggal_izin:
 *                 type: string
 *                 format: date
 *               jam_mulai:
 *                 type: string
 *                 format: date-time
 *               jam_selesai:
 *                 type: string
 *                 format: date-time
 *               id_kategori_izin_jam:
 *                 type: string
 *               keperluan:
 *                 type: string
 *                 nullable: true
 *               handover:
 *                 type: string
 *                 nullable: true
 *               tanggal_pengganti:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *               jam_mulai_pengganti:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *               jam_selesai_pengganti:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *               id_user:
 *                 type: string
 *                 description: Opsional, hanya dipakai admin untuk mendaftarkan atas nama user lain.
 *               tag_user_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Daftar user yang ditandai sebagai handover.
 *               approvals:
 *                 type: array
 *                 description: Rantai persetujuan berurutan.
 *                 items:
 *                   type: object
 *                   required: [level]
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: ID approval (opsional saat create).
 *                     level:
 *                       type: integer
 *                     approver_user_id:
 *                       type: string
 *                       nullable: true
 *                     approver_role:
 *                       type: string
 *                       nullable: true
 *               lampiran_izin_jam_url:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *               lampiran:
 *                 type: string
 *                 format: byte
 *                 nullable: true
 *                 description: File base64 / multipart binary jika menggunakan form-data.
 *     responses:
 *       '201':
 *         description: Pengajuan izin jam berhasil dibuat.
 *       '400':
 *         description: Data yang dikirim tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Kategori tidak ditemukan.
 *       '502':
 *         description: Gagal mengunggah lampiran.
 *       '500':
 *         description: Server error.
 * components:
 *   schemas:
 *     PengajuanIzinJam:
 *       type: object
 *       properties:
 *         id_pengajuan_izin_jam:
 *           type: string
 *         id_user:
 *           type: string
 *         id_kategori_izin_jam:
 *           type: string
 *         tanggal_izin:
 *           type: string
 *           format: date-time
 *         tanggal_pengganti:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         jam_mulai:
 *           type: string
 *           format: date-time
 *         jam_selesai:
 *           type: string
 *           format: date-time
 *         jam_mulai_pengganti:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         jam_selesai_pengganti:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         keperluan:
 *           type: string
 *           nullable: true
 *         handover:
 *           type: string
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [pending, disetujui, ditolak]
 *         current_level:
 *           type: integer
 *           nullable: true
 *         lampiran_izin_jam_url:
 *           type: string
 *           format: uri
 *           nullable: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * tags:
 *   - name: Mobile - Pengajuan Izin Sakit
 *     description: Endpoint pengajuan izin sakit karyawan (mobile).
 * /api/mobile/pengajuan-izin-sakit:
 *   get:
 *     summary: Daftar pengajuan izin sakit
 *     description: Mengambil daftar pengajuan izin sakit dengan filter status, pemohon, dan kata kunci.
 *     tags: [Mobile - Pengajuan Izin Sakit]
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
 *         description: Cari berdasarkan nama kategori, handover, atau nama pemohon.
 *     responses:
 *       '200':
 *         description: Daftar pengajuan izin sakit berhasil diambil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PengajuanIzinSakit'
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
 *       '400':
 *         description: Parameter tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Server error.
 *   post:
 *     summary: Buat pengajuan izin sakit
 *     description: Membuat pengajuan izin sakit baru dengan lampiran opsional, daftar approver, serta tag handover.
 *     tags: [Mobile - Pengajuan Izin Sakit]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreatePengajuanIzinSakitPayload'
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/CreatePengajuanIzinSakitPayload'
 *               - type: object
 *                 properties:
 *                   lampiran_izin_sakit:
 *                     type: string
 *                     format: binary
 *     responses:
 *       '201':
 *         description: Pengajuan izin sakit berhasil dibuat.
 *       '400':
 *         description: Data tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Referensi user atau kategori tidak ditemukan.
 *       '502':
 *         description: Gagal mengunggah lampiran.
 *       '500':
 *         description: Server error.
 * components:
 *   schemas:
 *     CreatePengajuanIzinSakitPayload:
 *       type: object
 *       required:
 *         - id_kategori_sakit
 *       properties:
 *         id_kategori_sakit:
 *           type: string
 *         id_user:
 *           type: string
 *           description: Opsional, hanya dipakai admin untuk mendaftarkan atas nama user lain.
 *         tanggal_pengajuan:
 *           type: string
 *           format: date
 *           nullable: true
 *         handover:
 *           type: string
 *           nullable: true
 *         tag_user_ids:
 *           type: array
 *           items:
 *             type: string
 *           description: Daftar user yang ditandai sebagai handover.
 *         status:
 *           type: string
 *           enum: [pending, disetujui, ditolak]
 *           description: Nilai default pending.
 *         current_level:
 *           type: integer
 *           nullable: true
 *         approvals:
 *           type: array
 *           description: Rantai persetujuan berurutan.
 *           items:
 *             type: object
 *             required: [level]
 *             properties:
 *               id:
 *                 type: string
 *                 description: ID approval (opsional saat create).
 *               level:
 *                 type: integer
 *               approver_user_id:
 *                 type: string
 *                 nullable: true
 *               approver_role:
 *                 type: string
 *                 nullable: true
 *         lampiran_izin_sakit_url:
 *           type: string
 *           format: uri
 *           nullable: true
 *         lampiran:
 *           type: string
 *           format: byte
 *           nullable: true
 *           description: File base64 / multipart binary jika menggunakan form-data.
 *     PengajuanIzinSakit:
 *       type: object
 *       properties:
 *         id_pengajuan_izin_sakit:
 *           type: string
 *         id_user:
 *           type: string
 *         id_kategori_sakit:
 *           type: string
 *         tanggal_pengajuan:
 *           type: string
 *           format: date
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
 *         lampiran_izin_sakit_url:
 *           type: string
 *           format: uri
 *           nullable: true
 *         jenis_pengajuan:
 *           type: string
 *           example: sakit
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 */

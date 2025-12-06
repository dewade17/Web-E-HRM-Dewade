/**
 * @swagger
 * tags:
 *   - name: Mobile - Pengajuan Izin Tukar Hari
 *     description: Endpoint pengajuan tukar hari pada aplikasi mobile.
 * components:
 *   schemas:
 *     PengajuanIzinTukarHariPair:
 *       type: object
 *       properties:
 *         hari_izin:
 *           type: string
 *           format: date
 *         hari_pengganti:
 *           type: string
 *           format: date
 *         catatan_pair:
 *           type: string
 *           nullable: true
 *     PengajuanIzinTukarHari:
 *       type: object
 *       properties:
 *         id_izin_tukar_hari:
 *           type: string
 *         id_user:
 *           type: string
 *         kategori:
 *           type: string
 *         keperluan:
 *           type: string
 *           nullable: true
 *         handover:
 *           type: string
 *           nullable: true
 *         status:
 *           type: string
 *           enum: [pending, disetujui, ditolak]
 *         lampiran_izin_tukar_hari_url:
 *           type: string
 *           format: uri
 *           nullable: true
 *         pairs:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/PengajuanIzinTukarHariPair'
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 * /api/mobile/pengajuan-izin-tukar-hari:
 *   get:
 *     summary: Daftar pengajuan izin tukar hari
 *     description: Mengambil daftar pengajuan tukar hari dengan filter status, kategori, tanggal izin, dan tanggal pengganti.
 *     tags: [Mobile - Pengajuan Izin Tukar Hari]
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
 *         name: kategori
 *         schema:
 *           type: string
 *         description: Filter berdasarkan kategori pengajuan.
 *       - in: query
 *         name: id_user
 *         schema:
 *           type: string
 *         description: ID user pemohon (hanya dapat digunakan oleh peran admin/pengawas).
 *       - in: query
 *         name: hari_izin
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tanggal izin spesifik (YYYY-MM-DD).
 *       - in: query
 *         name: hari_izin_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: hari_izin_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Rentang tanggal izin.
 *       - in: query
 *         name: hari_pengganti
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter tanggal pengganti spesifik (YYYY-MM-DD).
 *       - in: query
 *         name: hari_pengganti_from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: hari_pengganti_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Rentang tanggal pengganti.
 *     responses:
 *       '200':
 *         description: Daftar pengajuan berhasil diambil.
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
 *                     $ref: '#/components/schemas/PengajuanIzinTukarHari'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     perPage:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       '400':
 *         description: Parameter filter tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Kesalahan server saat mengambil data.
 *   post:
 *     summary: Buat pengajuan tukar hari
 *     description: Membuat pengajuan tukar hari baru beserta pasangan hari, lampiran, dan daftar approver.
 *     tags: [Mobile - Pengajuan Izin Tukar Hari]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kategori, pairs]
 *             properties:
 *               kategori:
 *                 type: string
 *               keperluan:
 *                 type: string
 *                 nullable: true
 *               handover:
 *                 type: string
 *                 nullable: true
 *               handover_tag_user_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Daftar user yang ditandai sebagai handover.
 *               pairs:
 *                 type: array
 *                 description: Pasangan hari izin dan hari pengganti.
 *                 items:
 *                   $ref: '#/components/schemas/PengajuanIzinTukarHariPair'
 *               approvals:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     level:
 *                       type: integer
 *                     approver_user_id:
 *                       type: string
 *                       nullable: true
 *                     approver_role:
 *                       type: string
 *                       nullable: true
 *               lampiran_izin_tukar_hari:
 *                 type: string
 *                 format: binary
 *                 nullable: true
 *                 description: Lampiran pendukung jika menggunakan multipart/form-data.
 *     responses:
 *       '201':
 *         description: Pengajuan berhasil dibuat.
 *       '400':
 *         description: Data yang dikirim tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '409':
 *         description: Pasangan tanggal bertabrakan dengan pengajuan lain.
 *       '502':
 *         description: Gagal mengunggah lampiran.
 *       '500':
 *         description: Kesalahan server saat membuat pengajuan.
 */

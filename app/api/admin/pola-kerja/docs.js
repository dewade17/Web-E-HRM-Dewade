/**
 * @swagger
 * tags:
 *   - name: Admin - Pola Kerja
 *     description: Manajemen pola kerja termasuk jam kerja dan jendela istirahat.
 * /api/admin/pola-kerja:
 *   get:
 *     summary: Daftar pola kerja
 *     description: Mengambil daftar pola kerja dengan dukungan pencarian, sortir, paginasi, serta pilihan menampilkan data yang sudah dihapus.
 *     tags: [Admin - Pola Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Nomor halaman yang ingin diambil.
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Jumlah item per halaman (maksimal 100).
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Pencarian dengan kata kunci pada nama pola kerja.
 *       - in: query
 *         name: includeDeleted
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *           default: 0
 *         description: Isi 1 untuk menyertakan data yang sudah dihapus (soft delete).
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum:
 *             [nama_pola_kerja, jam_mulai, jam_selesai, jam_istirahat_mulai, jam_istirahat_selesai, maks_jam_istirahat, created_at, updated_at, deleted_at]
 *           default: created_at
 *         description: Kolom yang digunakan untuk penyortiran.
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Arah penyortiran.
 *     responses:
 *       '200':
 *         description: Daftar pola kerja berhasil diambil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PolaKerja'
 *                 pagination:
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
 *         description: Terjadi kesalahan di server.
 *   post:
 *     summary: Buat pola kerja baru
 *     description: Menambahkan pola kerja baru beserta pengaturan jendela istirahat dan durasi maksimal istirahat.
 *     tags: [Admin - Pola Kerja]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - nama_pola_kerja
 *               - jam_mulai
 *               - jam_selesai
 *             properties:
 *               nama_pola_kerja:
 *                 type: string
 *                 description: Nama pola kerja.
 *               jam_mulai:
 *                 type: string
 *                 format: date-time
 *                 description: Jam mulai kerja (UTC atau ISO dengan offset jelas).
 *               jam_selesai:
 *                 type: string
 *                 format: date-time
 *                 description: Jam selesai kerja (tidak boleh lebih awal dari jam mulai).
 *               jam_istirahat_mulai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Awal jendela istirahat; wajib diisi bila `jam_istirahat_selesai` diisi.
 *               jam_istirahat_selesai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Akhir jendela istirahat; wajib diisi bila `jam_istirahat_mulai` diisi.
 *               maks_jam_istirahat:
 *                 type: integer
 *                 nullable: true
 *                 description: Batas maksimal durasi istirahat dalam menit. Wajib disertai jendela istirahat dan tidak boleh melebihi durasi jendela.
 *     responses:
 *       '201':
 *         description: Pola kerja berhasil dibuat.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/PolaKerja'
 *       '400':
 *         description: Data yang dikirim tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Terjadi kesalahan di server.
 * components:
 *   schemas:
 *     PolaKerja:
 *       type: object
 *       properties:
 *         id_pola_kerja:
 *           type: string
 *         nama_pola_kerja:
 *           type: string
 *         jam_mulai:
 *           type: string
 *           format: date-time
 *         jam_selesai:
 *           type: string
 *           format: date-time
 *         jam_istirahat_mulai:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         jam_istirahat_selesai:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         maks_jam_istirahat:
 *           type: integer
 *           nullable: true
 *           description: Durasi maksimal istirahat dalam menit.
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
 */

const adminPolaKerjaDocs = {};

export default adminPolaKerjaDocs;

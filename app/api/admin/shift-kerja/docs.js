/**
 * @swagger
 * tags:
 *   - name: Admin - Shift Kerja
 *     description: Manajemen shift kerja karyawan dari panel admin.
 * /api/admin/shift-kerja:
 *   get:
 *     summary: Daftar shift kerja
 *     description: Mengambil daftar shift kerja dengan filter pengguna, pola kerja, status, dan rentang tanggal.
 *     tags: [Admin - Shift Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Halaman data yang diambil.
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Jumlah data per halaman.
 *       - in: query
 *         name: includeDeleted
 *         schema:
 *           type: string
 *           enum: ['0', '1']
 *         description: Setel ke `1` untuk menyertakan data yang sudah di-soft delete.
 *       - in: query
 *         name: orderBy
 *         schema:
 *           type: string
 *           enum: [tanggal_mulai, tanggal_selesai, created_at, updated_at, status]
 *           default: created_at
 *         description: Kolom pengurutan.
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Arah pengurutan.
 *       - in: query
 *         name: id_user
 *         schema:
 *           type: string
 *         description: Filter berdasarkan ID pengguna.
 *       - in: query
 *         name: id_pola_kerja
 *         schema:
 *           type: string
 *           nullable: true
 *         description: Filter berdasarkan ID pola kerja. Kirim nilai `null` (string) untuk mencari yang bernilai null.
 *       - in: query
 *         name: id_jabatan
 *         schema:
 *           type: string
 *           nullable: true
 *         description: Filter jabatan pada relasi user. Gunakan string `null` untuk data tanpa jabatan.
 *       - in: query
 *         name: searchJabatan
 *         schema:
 *           type: string
 *         description: Cari nama jabatan (case-insensitive) pada relasi user.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [KERJA, LIBUR]
 *         description: Filter status shift.
 *       - in: query
 *         name: tanggalMulaiFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas awal rentang tanggal_mulai (UTC).
 *       - in: query
 *         name: tanggalMulaiTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas akhir rentang tanggal_mulai (UTC).
 *       - in: query
 *         name: tanggalSelesaiFrom
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas awal rentang tanggal_selesai (UTC).
 *       - in: query
 *         name: tanggalSelesaiTo
 *         schema:
 *           type: string
 *           format: date
 *         description: Batas akhir rentang tanggal_selesai (UTC).
 *     responses:
 *       '200':
 *         description: Daftar shift kerja berhasil diambil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AdminShiftKerja'
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
 *       '400':
 *         description: Parameter filter tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Kesalahan server.
 *   post:
 *     summary: Menambahkan shift berdasarkan tanggal
 *     description: Membuat shift baru atau memperbarui data yang sudah ada untuk kombinasi pengguna dan tanggal mulai yang sama.
 *     tags: [Admin - Shift Kerja]
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
 *               - status
 *             properties:
 *               id_user:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [KERJA, LIBUR]
 *               hari_kerja:
 *                 description: Jadwal dalam format string/array/objek. Jika tidak memakai `weekly_schedule`, wajib diisi.
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *                   - type: object
 *               weekly_schedule:
 *                 description: Alternatif input jadwal mingguan. Dapat menggunakan properti `days`, `start_date`, `end_date`.
 *                 type: object
 *               tanggal_mulai:
 *                 type: string
 *                 format: date
 *               tanggal_selesai:
 *                 type: string
 *                 format: date
 *               id_pola_kerja:
 *                 type: string
 *                 nullable: true
 *                 description: Pola kerja yang di-assign. Diabaikan jika status LIBUR.
 *     responses:
 *       '201':
 *         description: Shift kerja berhasil dibuat atau diperbarui.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/AdminShiftKerja'
 *       '400':
 *         description: Data tidak valid atau field wajib kosong.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: User atau pola kerja tidak ditemukan.
 *       '500':
 *         description: Kesalahan server.
 * components:
 *   schemas:
 *     AdminShiftKerja:
 *       type: object
 *       properties:
 *         id_shift_kerja:
 *           type: string
 *         id_user:
 *           type: string
 *         tanggal_mulai:
 *           type: string
 *           format: date
 *         tanggal_selesai:
 *           type: string
 *           format: date
 *         hari_kerja:
 *           description: Jadwal yang sudah dinormalisasi.
 *           type: object
 *         status:
 *           type: string
 *           enum: [KERJA, LIBUR]
 *         id_pola_kerja:
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
 *         polaKerja:
 *           type: object
 *           nullable: true
 *           properties:
 *             id_pola_kerja:
 *               type: string
 *             nama_pola_kerja:
 *               type: string
 */

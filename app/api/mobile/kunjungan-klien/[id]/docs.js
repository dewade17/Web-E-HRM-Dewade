/**
 * @swagger
 * /api/mobile/kunjungan-klien/{id}:
 *   get:
 *     summary: Detail kunjungan klien
 *     description: Mengambil detail kunjungan klien milik pengguna atau, untuk peran tertentu, milik pengguna lain.
 *     tags: [Mobile - Kunjungan Klien]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID kunjungan klien.
 *     responses:
 *       '200':
 *         description: Data kunjungan ditemukan.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/MobileKunjunganKlien'
 *       '400':
 *         description: Parameter path tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Kunjungan tidak ditemukan.
 *       '500':
 *         description: Kesalahan server saat mengambil data.
 *   put:
 *     summary: Perbarui kunjungan klien
 *     description: Memperbarui informasi rencana kunjungan. Operasional/Superadmin dapat memperbarui rencana milik pengguna lain.
 *     tags: [Mobile - Kunjungan Klien]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID kunjungan klien.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_master_data_kunjungan:
 *                 type: string
 *                 description: ID master/kategori kunjungan. Gunakan null/"" untuk mengosongkan.
 *               tanggal:
 *                 type: string
 *                 format: date
 *                 nullable: true
 *               jam_mulai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *               jam_selesai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *               deskripsi:
 *                 type: string
 *                 nullable: true
 *               hand_over:
 *                 type: string
 *                 nullable: true
 *               start_latitude:
 *                 type: number
 *                 nullable: true
 *               start_longitude:
 *                 type: number
 *                 nullable: true
 *               end_latitude:
 *                 type: number
 *                 nullable: true
 *               end_longitude:
 *                 type: number
 *                 nullable: true
 *               lampiran_kunjungan_url:
 *                 type: string
 *                 nullable: true
 *                 description: URL lampiran yang sudah diunggah. Abaikan jika mengunggah file baru via form-data.
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               lampiran_kunjungan:
 *                 type: string
 *                 format: binary
 *                 description: Lampiran file baru. Jika dikirim, lampiran lama akan diganti.
 *     responses:
 *       '200':
 *         description: Kunjungan berhasil diperbarui.
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
 *         description: Data yang diberikan tidak valid atau tidak ada perubahan.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Kunjungan tidak ditemukan atau tidak berhak diakses.
 *       '500':
 *         description: Kesalahan server saat memperbarui data.
 *   delete:
 *     summary: Hapus kunjungan klien
 *     description: Menandai kunjungan klien dan laporan penerima sebagai terhapus.
 *     tags: [Mobile - Kunjungan Klien]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Kunjungan berhasil dihapus.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Data tidak ditemukan atau tidak dapat diakses.
 *       '500':
 *         description: Kesalahan server saat menghapus data.
 */

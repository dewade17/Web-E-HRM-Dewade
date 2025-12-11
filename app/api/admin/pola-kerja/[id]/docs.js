/**
 * @swagger
 * /api/admin/pola-kerja/{id}:
 *   get:
 *     summary: Detail pola kerja
 *     description: Mengambil detail satu pola kerja termasuk informasi jendela istirahat.
 *     tags: [Admin - Pola Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID pola kerja.
 *     responses:
 *       '200':
 *         description: Detail pola kerja ditemukan.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/PolaKerja'
 *       '404':
 *         description: Data tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan di server.
 *   put:
 *     summary: Perbarui pola kerja
 *     description: Memperbarui atribut pola kerja. Setiap field bersifat opsional namun mengikuti validasi urutan jam kerja, jendela istirahat, dan batas maksimal istirahat.
 *     tags: [Admin - Pola Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID pola kerja yang akan diperbarui.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nama_pola_kerja:
 *                 type: string
 *                 description: Nama pola kerja baru (tidak boleh kosong jika dikirim).
 *               jam_mulai:
 *                 type: string
 *                 format: date-time
 *                 description: Jam mulai kerja baru.
 *               jam_selesai:
 *                 type: string
 *                 format: date-time
 *                 description: Jam selesai kerja baru; tidak boleh lebih awal dari jam mulai.
 *               jam_istirahat_mulai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Awal jendela istirahat. Jika dikirim harus disertai `jam_istirahat_selesai`.
 *               jam_istirahat_selesai:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Akhir jendela istirahat. Jika dikirim harus disertai `jam_istirahat_mulai`.
 *               maks_jam_istirahat:
 *                 type: integer
 *                 nullable: true
 *                 description: Batas maksimal durasi istirahat (menit). Hanya boleh diisi bila jendela istirahat tersedia dan tidak boleh melebihi durasi jendela.
 *     responses:
 *       '200':
 *         description: Pola kerja berhasil diperbarui.
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
 *         description: Data tidak valid atau tidak ada perubahan.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Data tidak ditemukan.
 *       '409':
 *         description: Konflik validasi data yang masih dipakai.
 *       '500':
 *         description: Terjadi kesalahan di server.
 *   delete:
 *     summary: Hapus pola kerja
 *     description: Menghapus pola kerja.
 *     tags: [Admin - Pola Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID pola kerja.
 *       - in: query
 *         name: hard
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *         description: Set 1 untuk menghapus permanen.
 *       - in: query
 *         name: force
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *         description: Alias untuk hard delete.
 *     responses:
 *       '200':
 *         description: Pola kerja berhasil dihapus atau sudah terhapus.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Data tidak ditemukan.
 *       '409':
 *         description: Gagal hard delete karena pola kerja masih dipakai.
 *       '500':
 *         description: Terjadi kesalahan di server.
 */

const adminPolaKerjaDetailDocs = {};

export default adminPolaKerjaDetailDocs;

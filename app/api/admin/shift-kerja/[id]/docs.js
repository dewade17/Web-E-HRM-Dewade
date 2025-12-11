/**
 * @swagger
 * /api/admin/shift-kerja/{id}:
 *   get:
 *     summary: Detail shift kerja
 *     description: Mengambil detail shift kerja berdasarkan ID.
 *     tags: [Admin - Shift Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID shift kerja.
 *     responses:
 *       '200':
 *         description: Detail shift kerja ditemukan.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/AdminShiftKerja'
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Shift kerja tidak ditemukan.
 *       '500':
 *         description: Kesalahan server.
 *   put:
 *     summary: Perbarui shift kerja
 *     description: Memperbarui informasi shift kerja yang ada, termasuk jadwal mingguan maupun pola kerja.
 *     tags: [Admin - Shift Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_user:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [KERJA, LIBUR]
 *               hari_kerja:
 *                 description: Jadwal dalam format string/array/objek. Jika tidak memakai `weekly_schedule`, wajib diisi saat mengubah jadwal.
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *                   - type: object
 *               weekly_schedule:
 *                 description: Alternatif input jadwal mingguan, menerima properti seperti `days`, `start_date`, `end_date`.
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
 *                 description: Pola kerja yang di-assign. Otomatis di-nolkan ketika status LIBUR.
 *     responses:
 *       '200':
 *         description: Shift kerja berhasil diperbarui.
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
 *         description: Data tidak valid atau tidak ada perubahan.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Shift kerja tidak ditemukan.
 *       '409':
 *         description: Kombinasi pengguna dan tanggal sudah digunakan.
 *       '500':
 *         description: Kesalahan server.
 *   delete:
 *     summary: Hapus shift kerja
 *     description: Menghapus shift kerja karyawan.
 *     tags: [Admin - Shift Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: hard
 *         schema:
 *           type: string
 *           enum: ['0', '1']
 *         description: Setel `1` untuk hard delete.
 *       - in: query
 *         name: force
 *         schema:
 *           type: string
 *           enum: ['0', '1']
 *         description: Alias `hard`. Jika tidak diisi maka soft delete.
 *     responses:
 *       '200':
 *         description: Shift kerja berhasil dihapus atau sudah terhapus.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Shift kerja tidak ditemukan.
 *       '409':
 *         description: Gagal hard delete karena masih direferensikan entitas lain.
 *       '500':
 *         description: Kesalahan server.
 */

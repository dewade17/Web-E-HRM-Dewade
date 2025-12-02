/**
 * @swagger
 * /api/mobile/pengajuan-cuti/{id}:
 *   put:
 *     summary: Perbarui pengajuan cuti
 *     description: Memperbarui detail pengajuan cuti milik pengguna, termasuk tanggal cuti, kategori, handover, dan lampiran.
 *     tags: [Mobile - Pengajuan Cuti]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID pengajuan cuti.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdatePengajuanCutiPayload'
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/UpdatePengajuanCutiPayload'
 *               - type: object
 *                 properties:
 *                   lampiran_cuti:
 *                     type: string
 *                     format: binary
 *                     description: Lampiran baru (opsional).
 *     responses:
 *       '200':
 *         description: Pengajuan cuti berhasil diperbarui.
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
 *       '400':
 *         description: Permintaan tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Pengguna tidak memiliki akses untuk mengubah pengajuan.
 *       '404':
 *         description: Pengajuan tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan saat memperbarui pengajuan.
 *   patch:
 *     summary: Perbarui pengajuan cuti (parsial)
 *     description: Memperbarui sebagian data pengajuan cuti. Perilaku sama dengan PUT.
 *     tags: [Mobile - Pengajuan Cuti]
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
 *             $ref: '#/components/schemas/UpdatePengajuanCutiPayload'
 *     responses:
 *       '200':
 *         description: Pengajuan cuti berhasil diperbarui.
 *       '400':
 *         description: Permintaan tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Pengguna tidak memiliki akses untuk mengubah pengajuan.
 *       '404':
 *         description: Pengajuan tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan saat memperbarui pengajuan.
 *   delete:
 *     summary: Hapus pengajuan cuti
 *     description: Menghapus permanen pengajuan cuti. Hanya pemilik atau admin yang dapat menghapus.
 *     tags: [Mobile - Pengajuan Cuti]
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
 *         description: Pengajuan cuti berhasil dihapus.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Pengguna tidak memiliki akses untuk menghapus pengajuan.
 *       '404':
 *         description: Pengajuan tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan saat menghapus pengajuan.
 * components:
 *   schemas:
 *     UpdatePengajuanCutiPayload:
 *       type: object
 *       properties:
 *         id_kategori_cuti:
 *           type: string
 *           nullable: true
 *         keperluan:
 *           type: string
 *           nullable: true
 *         handover:
 *           type: string
 *           nullable: true
 *         tanggal_masuk_kerja:
 *           type: string
 *           format: date
 *           nullable: true
 *         tanggal_list:
 *           type: array
 *           nullable: true
 *           description: Daftar tanggal cuti baru (format YYYY-MM-DD). Jika dikirim, seluruh tanggal lama akan diganti.
 *           items:
 *             type: string
 *             format: date
 *         lampiran_cuti:
 *           type: string
 *           format: binary
 *           nullable: true
 */

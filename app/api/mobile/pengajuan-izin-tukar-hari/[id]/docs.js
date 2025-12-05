/**
 * @swagger
 * /api/mobile/pengajuan-izin-tukar-hari/{id}:
 *   get:
 *     summary: Detail pengajuan tukar hari
 *     description: Mengambil detail pengajuan tukar hari berdasarkan ID.
 *     tags: [Mobile - Pengajuan Izin Tukar Hari]
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
 *         description: Detail pengajuan ditemukan.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/PengajuanIzinTukarHari'
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Tidak memiliki akses ke data ini.
 *       '404':
 *         description: Data tidak ditemukan.
 *   put:
 *     summary: Perbarui pengajuan tukar hari
 *     description: Memperbarui kategori, keperluan, handover, lampiran, pasangan hari, atau daftar approver pada pengajuan yang masih pending.
 *     tags: [Mobile - Pengajuan Izin Tukar Hari]
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
 *               kategori:
 *                 type: string
 *                 description: Kosongkan jika tidak ingin mengubah.
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
 *                 description: Menggantikan daftar handover jika dikirim.
 *               pairs:
 *                 type: array
 *                 description: Mengganti seluruh pasangan hari izin/pengganti jika dikirim.
 *                 items:
 *                   $ref: '#/components/schemas/PengajuanIzinTukarHariPair'
 *               approvals:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       description: ID approval existing untuk update.
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
 *     responses:
 *       '200':
 *         description: Pengajuan berhasil diperbarui.
 *       '400':
 *         description: Body atau pasangan tanggal tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Tidak memiliki akses untuk memperbarui data ini.
 *       '404':
 *         description: Data tidak ditemukan.
 *       '409':
 *         description: Pengajuan sudah diputus atau jadwal bertabrakan.
 *       '502':
 *         description: Gagal mengunggah lampiran.
 *   delete:
 *     summary: Hapus pengajuan tukar hari
 *     description: Menghapus pengajuan tukar hari yang dimiliki oleh pengguna (atau admin) jika masih pending.
 *     tags: [Mobile - Pengajuan Izin Tukar Hari]
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
 *         description: Pengajuan berhasil dihapus.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Tidak memiliki akses untuk menghapus data ini.
 *       '404':
 *         description: Data tidak ditemukan.
 *       '409':
 *         description: Pengajuan tidak dapat dihapus karena status sudah diputus.
 */

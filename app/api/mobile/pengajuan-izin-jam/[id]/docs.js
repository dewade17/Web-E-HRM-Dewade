/**
 * @swagger
 * /api/mobile/pengajuan-izin-jam/{id}:
 *   get:
 *     summary: Detail pengajuan izin jam
 *     tags: [Mobile - Pengajuan Izin Jam]
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
 *         description: Data pengajuan izin jam ditemukan.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Pengajuan tidak ditemukan.
 *       '500':
 *         description: Server error.
 *   put:
 *     summary: Perbarui pengajuan izin jam
 *     description: Mengubah data pengajuan. Hanya pemohon atau admin yang dapat memperbarui.
 *     tags: [Mobile - Pengajuan Izin Jam]
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
 *                 description: Ganti pemohon (khusus admin/supervisor).
 *               tanggal_izin:
 *                 type: string
 *                 format: date
 *               jam_mulai:
 *                 type: string
 *                 format: date-time
 *               jam_selesai:
 *                 type: string
 *                 format: date-time
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
 *               id_kategori_izin_jam:
 *                 type: string
 *               keperluan:
 *                 type: string
 *                 nullable: true
 *               handover:
 *                 type: string
 *                 nullable: true
 *               status:
 *                 type: string
 *                 enum: [pending, disetujui, ditolak]
 *               current_level:
 *                 type: integer
 *                 nullable: true
 *               lampiran_izin_jam_url:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *               lampiran:
 *                 type: string
 *                 format: byte
 *                 nullable: true
 *               tag_user_ids:
 *                 type: array
 *                 items:
 *                   type: string
 *               approvals:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     level:
 *                       type: integer
 *                     approver_user_id:
 *                       type: string
 *                       nullable: true
 *                     approver_role:
 *                       type: string
 *                       nullable: true
 *     responses:
 *       '200':
 *         description: Pengajuan berhasil diperbarui.
 *       '400':
 *         description: Data tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Tidak memiliki izin memperbarui.
 *       '404':
 *         description: Pengajuan atau referensi tidak ditemukan.
 *       '502':
 *         description: Gagal mengunggah lampiran.
 *       '500':
 *         description: Server error.
 *   delete:
 *     summary: Hapus pengajuan izin jam
 *     description:  Menghapus permanen pengajuan izin jam. Hanya pemilik atau admin yang dapat menghapus.
 *     tags: [Mobile - Pengajuan Izin Jam]
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
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Jika true/1 maka hapus permanen.
 *     responses:
 *       '200':
 *         description: Pengajuan berhasil dihapus.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Tidak memiliki izin.
 *       '404':
 *         description: Pengajuan tidak ditemukan.
 *       '500':
 *         description: Server error.
 */

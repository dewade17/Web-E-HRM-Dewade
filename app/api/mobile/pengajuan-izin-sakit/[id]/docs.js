/**
 * @swagger
 * /api/mobile/pengajuan-izin-sakit/{id}:
 *   get:
 *     summary: Detail pengajuan izin sakit
 *     tags: [Mobile - Pengajuan Izin Sakit]
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
 *         description: Data pengajuan izin sakit ditemukan.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Pengajuan tidak ditemukan.
 *       '500':
 *         description: Server error.
 *   put:
 *     summary: Perbarui pengajuan izin sakit
 *     description: Mengubah data pengajuan. Hanya pemohon atau admin yang dapat memperbarui.
 *     tags: [Mobile - Pengajuan Izin Sakit]
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
 *               id_kategori_sakit:
 *                 type: string
 *               tanggal_pengajuan:
 *                 type: string
 *                 format: date
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
 *               lampiran_izin_sakit_url:
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
 *         multipart/form-data:
 *           schema:
 *             allOf:
 *               - type: object
 *                 properties:
 *                   lampiran:
 *                     type: string
 *                     format: binary
 *               - type: object
 *                 properties:
 *                   lampiran_izin_sakit_url:
 *                     type: string
 *                     format: uri
 *                     nullable: true
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
 *     summary: Hapus pengajuan izin sakit
 *     description: Hapus permanen pengajuan. Hanya pemohon atau admin yang dapat menghapus.
 *     tags: [Mobile - Pengajuan Izin Sakit]
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
 *         description: Tidak memiliki izin.
 *       '404':
 *         description: Pengajuan tidak ditemukan.
 *       '409':
 *         description: Pengajuan masih direferensikan data lain.
 *       '500':
 *         description: Server error.
 */

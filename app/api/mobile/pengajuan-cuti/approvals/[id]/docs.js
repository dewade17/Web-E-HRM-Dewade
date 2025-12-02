/**
 * @swagger
 * /api/mobile/pengajuan-cuti/approvals/{id}:
 *   patch:
 *     summary: Beri keputusan approval pengajuan cuti
 *     description: Memberikan keputusan menyetujui atau menolak pada sebuah approval pengajuan cuti beserta catatan dan pengaturan shift kembali bekerja.
 *     tags: [Mobile - Pengajuan Cuti]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID approval pengajuan cuti.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - decision
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [disetujui, ditolak]
 *                 description: Keputusan approver.
 *               note:
 *                 type: string
 *                 nullable: true
 *                 description: Catatan tambahan dari approver.
 *               return_shift:
 *                 type: object
 *                 nullable: true
 *                 description: Jadwal shift saat kembali masuk kerja (opsional).
 *                 properties:
 *                   date:
 *                     type: string
 *                     format: date
 *                     description: Tanggal kembali bekerja (format YYYY-MM-DD).
 *                   id_pola_kerja:
 *                     type: string
 *                     description: ID pola kerja yang akan diterapkan saat kembali.
 *     responses:
 *       '200':
 *         description: Keputusan approval berhasil disimpan.
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
 *                 shift_adjustment:
 *                   type: object
 *                   nullable: true
 *                   description: Ringkasan sinkronisasi shift jika ada penyesuaian LIBUR.
 *                   properties:
 *                     updatedCount:
 *                       type: integer
 *                     createdCount:
 *                       type: integer
 *                     affectedDates:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: date
 *                     returnShift:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         id_shift_kerja:
 *                           type: string
 *                         tanggal_mulai:
 *                           type: string
 *                           format: date
 *                         id_pola_kerja:
 *                           type: string
 *                         status:
 *                           type: string
 *                         tanggal_mulai_display:
 *                           type: string
 *       '400':
 *         description: Permintaan tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Pengguna tidak memiliki akses pada approval ini.
 *       '404':
 *         description: Approval atau pengajuan tidak ditemukan.
 *       '409':
 *         description: Approval sudah diproses sebelumnya.
 *       '500':
 *         description: Terjadi kesalahan saat memproses approval.
 *   put:
 *     summary: Beri keputusan approval pengajuan cuti
 *     description: Sama seperti PATCH, digunakan untuk mengirim keputusan approval.
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
 *             $ref: '#/components/schemas/ApprovalDecisionPayload'
 *     responses:
 *       '200':
 *         description: Keputusan approval berhasil disimpan.
 *       '400':
 *         description: Permintaan tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Pengguna tidak memiliki akses pada approval ini.
 *       '404':
 *         description: Approval atau pengajuan tidak ditemukan.
 *       '409':
 *         description: Approval sudah diproses sebelumnya.
 *       '500':
 *         description: Terjadi kesalahan saat memproses approval.
 * components:
 *   schemas:
 *     ApprovalDecisionPayload:
 *       type: object
 *       required:
 *         - decision
 *       properties:
 *         decision:
 *           type: string
 *           enum: [disetujui, ditolak]
 *         note:
 *           type: string
 *           nullable: true
 *         return_shift:
 *           type: object
 *           nullable: true
 *           properties:
 *             date:
 *               type: string
 *               format: date
 *             id_pola_kerja:
 *               type: string
 */

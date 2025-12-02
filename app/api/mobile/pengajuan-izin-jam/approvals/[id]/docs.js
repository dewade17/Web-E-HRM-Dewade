/**
 * @swagger
 * /api/mobile/pengajuan-izin-jam/approvals/{id}:
 *   patch:
 *     summary: Beri keputusan approval pengajuan izin jam
 *     description: Approver (berdasarkan user atau role) menyetujui atau menolak pengajuan.
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
 *             required: [decision]
 *             properties:
 *               decision:
 *                 type: string
 *                 enum: [disetujui, ditolak]
 *               note:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: Keputusan approval berhasil disimpan.
 *       '400':
 *         description: Data tidak valid atau approval sudah diproses.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '403':
 *         description: Tidak memiliki akses ke approval ini.
 *       '404':
 *         description: Approval atau pengajuan tidak ditemukan.
 *       '500':
 *         description: Server error.
 */

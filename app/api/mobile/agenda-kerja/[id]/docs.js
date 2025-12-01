/**
 * @swagger
 * /api/mobile/agenda-kerja/{id}:
 *   get:
 *     summary: Detail agenda kerja
 *     tags: [Mobile - Agenda Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID agenda kerja.
 *     responses:
 *       '200':
 *         description: Detail agenda kerja.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/MobileAgendaKerja'
 *       '404':
 *         description: Agenda kerja tidak ditemukan.
 *       '500':
 *         description: Gagal mengambil detail agenda kerja.
 *   put:
 *     summary: Perbarui agenda kerja
 *     tags: [Mobile - Agenda Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID agenda kerja.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_user:
 *                 type: string
 *               id_agenda:
 *                 type: string
 *               deskripsi_kerja:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [teragenda, diproses, ditunda, selesai]
 *               start_date:
 *                 type: string
 *                 format: date-time
 *               end_date:
 *                 type: string
 *                 format: date-time
 *               duration_seconds:
 *                 type: integer
 *               id_absensi:
 *                 type: string
 *                 nullable: true
 *               kebutuhan_agenda:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       '200':
 *         description: Agenda kerja berhasil diperbarui.
 *       '400':
 *         description: Data tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Agenda kerja tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan saat memperbarui.
 *   delete:
 *     summary: Hapus agenda kerja
 *     tags: [Mobile - Agenda Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID agenda kerja.
 *       - in: query
 *         name: hard
 *         schema:
 *           type: string
 *           enum: ['0', '1', 'true', 'false']
 *         description: Gunakan `1` untuk menghapus permanen.
 *     responses:
 *       '200':
 *         description: Agenda kerja berhasil dihapus (soft/hard delete).
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Agenda kerja tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan saat menghapus.
 */
export const agendaDetailDocs = {};

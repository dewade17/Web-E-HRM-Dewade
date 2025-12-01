/**
 * @swagger
 * /api/mobile/agenda-kerja/reminder:
 *   post:
 *     summary: Kirim pengingat agenda yang mendekati batas akhir
 *     description: Memproses dan mengirim notifikasi untuk agenda dengan status diproses atau ditunda yang akan berakhir dalam rentang waktu tertentu.
 *     tags: [Mobile - Agenda Kerja]
 *     parameters:
 *       - in: query
 *         name: windowMinutes
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1440
 *         description: Rentang waktu ke depan (menit) untuk memeriksa agenda yang akan selesai. Default 60 menit, maksimum 24 jam.
 *     responses:
 *       '200':
 *         description: Pengingat agenda kerja berhasil diproses.
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
 *                   type: object
 *                   properties:
 *                     windowMinutes:
 *                       type: integer
 *                     totalCandidates:
 *                       type: integer
 *                     totalSent:
 *                       type: integer
 *                     totalSkipped:
 *                       type: integer
 *       '500':
 *         description: Terjadi kesalahan saat memproses pengingat agenda.
 */
const agendaReminderDocs = {};

export default agendaReminderDocs;

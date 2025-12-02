/**
 * @swagger
 * /api/mobile/kunjungan-klien/reminder:
 *   post:
 *     summary: Kirim notifikasi pengingat akhir kunjungan
 *     description: Memproses pengiriman notifikasi pengingat untuk kunjungan klien yang akan berakhir dalam rentang waktu tertentu.
 *     tags: [Mobile - Kunjungan Klien]
 *     parameters:
 *       - in: query
 *         name: windowMinutes
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1440
 *           default: 60
 *         description: Rentang waktu (menit) ke depan untuk mencari kunjungan yang akan selesai.
 *     responses:
 *       '200':
 *         description: Proses pengiriman pengingat selesai.
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
 *         description: Kesalahan server saat memproses pengingat.
 */

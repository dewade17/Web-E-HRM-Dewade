/**
 * @swagger
 * /api/mobile/kunjungan-klien/status-diproses:
 *   get:
 *     summary: Daftar kunjungan dengan status diproses
 *     description: Mengambil daftar kunjungan klien berstatus "diproses" untuk pengguna saat ini dengan opsi filter tanggal.
 *     tags: [Mobile - Kunjungan Klien]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *       - in: query
 *         name: tanggal
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter pada tanggal tertentu (format YYYY-MM-DD).
 *     responses:
 *       '200':
 *         description: Daftar kunjungan berstatus diproses berhasil diambil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MobileKunjunganKlien'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationMeta'
 *       '400':
 *         description: Parameter tanggal tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '500':
 *         description: Kesalahan server saat mengambil data.
 */

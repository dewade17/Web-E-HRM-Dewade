/**
 * @swagger
 * /api/mobile/agenda-kerja/user/{id}:
 *   get:
 *     summary: Daftar agenda kerja per pengguna
 *     description: Mengambil daftar agenda kerja untuk pengguna tertentu dengan filter status, rentang tanggal, absensi, dan paginasi.
 *     tags: [Mobile - Agenda Kerja]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID pengguna yang akan diambil agenda kerjanya.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [teragenda, diproses, ditunda, selesai]
 *         description: Filter berdasarkan status agenda kerja.
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Tanggal mulai (UTC) untuk rentang pencarian. Gunakan bersama parameter `to`.
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Tanggal akhir (UTC) untuk rentang pencarian. Tidak boleh lebih awal dari `from`.
 *       - in: query
 *         name: has_absensi
 *         schema:
 *           type: string
 *           enum: ['1', '0', 'true', 'false']
 *         description: Filter agenda yang memiliki absensi (`1`/`true`) atau yang belum memiliki absensi (`0`/`false`).
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 50
 *         description: Jumlah data yang diambil.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Posisi data awal untuk paginasi.
 *     responses:
 *       '200':
 *         description: Daftar agenda kerja berhasil diambil.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 meta:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     nextOffset:
 *                       type: integer
 *                       nullable: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MobileAgendaKerja'
 *       '400':
 *         description: Permintaan tidak valid (misal status tidak dikenali, rentang tanggal tidak sesuai, atau user_id kosong).
 *       '401':
 *         description: Tidak terautentikasi atau token tidak valid.
 *       '500':
 *         description: Terjadi kesalahan saat mengambil daftar agenda kerja.
 */
const agendaKerjaUserDocs = {};

export default agendaKerjaUserDocs;

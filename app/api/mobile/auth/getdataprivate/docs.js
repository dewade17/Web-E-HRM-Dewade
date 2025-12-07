/**
 * @swagger
 * /api/mobile/auth/getdataprivate:
 *   get:
 *     summary: Ambil data profil pengguna (privat)
 *     description: Mengambil data profil pengguna yang sudah terautentikasi menggunakan token Bearer.
 *     tags:
 *       - Auth
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       '200':
 *         description: Berhasil mengambil data user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id_user:
 *                       type: string
 *                     nama_pengguna:
 *                       type: string
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *                     tanggal_lahir:
 *                       type: string
 *                       format: date
 *                     kontak:
 *                       type: string
 *                     foto_profil_user:
 *                       type: string
 *                     id_departement:
 *                       type: string
 *                     id_location:
 *                       type: string
 *                     password_updated_at:
 *                       type: string
 *                       format: date-time
 *                     created_at:
 *                       type: string
 *                       format: date-time
 *                     updated_at:
 *                       type: string
 *                       format: date-time
 *                     departement:
 *                       type: object
 *                       properties:
 *                         id_departement:
 *                           type: string
 *                         nama_departement:
 *                           type: string
 *                     kantor:
 *                       type: object
 *                       properties:
 *                         id_location:
 *                           type: string
 *                         nama_kantor:
 *                           type: string
 *                         latitude:
 *                           type: number
 *                         longitude:
 *                           type: number
 *                         radius:
 *                           type: number
 *       '401':
 *         description: Token tidak ditemukan, tidak valid, atau sudah kedaluwarsa.
 *       '404':
 *         description: User tidak ditemukan.
 *       '500':
 *         description: Terjadi kesalahan tak terduga.
 */

const getDataPrivateDocs = {};

export default getDataPrivateDocs;

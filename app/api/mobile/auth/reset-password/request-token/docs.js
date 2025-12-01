/**
 * @swagger
 * /api/mobile/auth/reset-password/request-token:
 *   post:
 *     summary: Meminta kode reset password
 *     description: Mengirim kode OTP reset password ke email pengguna jika terdaftar.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *     responses:
 *       '200':
 *         description: Kode reset telah dikirim (respons generik, bahkan bila email tidak terdaftar)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       '400':
 *         description: Email wajib diisi.
 *       '500':
 *         description: Terjadi kesalahan pada server.
 */

const requestResetTokenDocs = {};

export default requestResetTokenDocs;

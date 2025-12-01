/**
 * @swagger
 * /api/mobile/auth/reset-password:
 *   post:
 *     summary: Reset password menggunakan token
 *     description: Mengatur ulang password dengan kode/ token reset yang masih berlaku.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *                 example: "123456"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "PasswordBaru123!"
 *     responses:
 *       '200':
 *         description: Password berhasil direset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       '400':
 *         description: Token tidak valid/kedaluwarsa atau password tidak memenuhi ketentuan.
 *       '500':
 *         description: Terjadi kesalahan pada server.
 */

const resetPasswordDocs = {};

export default resetPasswordDocs;

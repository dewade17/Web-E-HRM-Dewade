/**
 * @swagger
 * /api/mobile/auth/login:
 *   post:
 *     summary: Login Pengguna
 *     description: Autentikasi pengguna untuk mendapatkan token akses.
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
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Rahasia123!
 *     responses:
 *       '200':
 *         description: Login berhasil
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 accessToken:
 *                   type: string
 *       '400':
 *         description: Email dan password wajib diisi.
 *       '401':
 *         description: Email atau password salah.
 *       '500':
 *         description: Terjadi kesalahan pada server.
 */

const loginDocs = {};

export default loginDocs;

/**
 * @swagger
 * /api/mobile/kunjungan-klien/{id}/submit-start-kunjungan:
 *   put:
 *     summary: Check-in kunjungan klien
 *     description: Mengubah status kunjungan menjadi "berlangsung" dan mencatat waktu serta lokasi mulai kunjungan.
 *     tags: [Mobile - Kunjungan Klien]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID kunjungan klien.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jam_checkin:
 *                 type: string
 *                 format: date-time
 *                 description: Waktu check-in kunjungan.
 *               start_latitude:
 *                 type: number
 *                 description: Koordinat latitude lokasi mulai.
 *               start_longitude:
 *                 type: number
 *                 description: Koordinat longitude lokasi mulai.
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               jam_checkin:
 *                 type: string
 *                 format: date-time
 *                 description: Waktu check-in kunjungan.
 *               start_latitude:
 *                 type: number
 *                 description: Koordinat latitude lokasi mulai.
 *               start_longitude:
 *                 type: number
 *                 description: Koordinat longitude lokasi mulai.
 *               lampiran_kunjungan:
 *                 type: string
 *                 format: binary
 *                 description: Lampiran foto check-in (.jpg/.png). Nama field alternatif: lampiran, lampiran_file, lampiran_kunjungan_file, file.
 *     responses:
 *       '200':
 *         description: Check-in kunjungan berhasil diproses.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MobileKunjunganKlien'
 *       '400':
 *         description: Data check-in tidak valid atau tidak ada perubahan.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Kunjungan tidak ditemukan atau bukan milik pengguna.
 *       '500':
 *         description: Kesalahan server saat memproses check-in.
 */

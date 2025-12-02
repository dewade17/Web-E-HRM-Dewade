/**
 * @swagger
 * /api/mobile/kunjungan-klien/{id}/submit-end-kunjungan:
 *   put:
 *     summary: Check-out kunjungan klien
 *     description: Mencatat selesai kunjungan, memperbarui lokasi akhir, durasi, lampiran, dan daftar penerima laporan jika diperlukan.
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
 *               deskripsi:
 *                 type: string
 *                 description: Catatan akhir kunjungan.
 *               jam_checkout:
 *                 type: string
 *                 format: date-time
 *                 description: Waktu check-out (harus setelah jam_checkin jika ada).
 *               end_latitude:
 *                 type: number
 *                 description: Koordinat latitude lokasi selesai.
 *               end_longitude:
 *                 type: number
 *                 description: Koordinat longitude lokasi selesai.
 *               id_kategori_kunjungan:
 *                 type: string
 *                 description: Kategori kunjungan yang dipilih saat selesai.
 *               recipients:
 *                 type: array
 *                 description: Daftar penerima laporan (alias field: report_recipients, kunjungan_report_recipients).
 *                 items:
 *                   type: object
 *                   required: [id_user, recipient_nama_snapshot]
 *                   properties:
 *                     id_user:
 *                       type: string
 *                     recipient_nama_snapshot:
 *                       type: string
 *                     recipient_role_snapshot:
 *                       type: string
 *                       enum: [HR, OPERASIONAL, DIREKTUR, SUPERADMIN]
 *                       description: Peran penerima (opsional).
 *                     status:
 *                       type: string
 *                       enum: [terkirim, disetujui, ditolak]
 *                       description: Status laporan untuk penerima (opsional).
 *                     catatan:
 *                       type: string
 *                       nullable: true
 *                       description: Catatan untuk penerima laporan.
 *               lampiran_kunjungan_url:
 *                 type: string
 *                 description: URL lampiran yang sudah diunggah (jika tidak mengirim file baru).
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               deskripsi:
 *                 type: string
 *               jam_checkout:
 *                 type: string
 *                 format: date-time
 *               end_latitude:
 *                 type: number
 *               end_longitude:
 *                 type: number
 *               id_kategori_kunjungan:
 *                 type: string
 *               recipients:
 *                 type: string
 *                 description: JSON array string daftar penerima laporan. Alias field: report_recipients, kunjungan_report_recipients.
 *               lampiran_kunjungan:
 *                 type: string
 *                 format: binary
 *                 description: Lampiran foto check-out. Nama field alternatif: lampiran, lampiran_file, lampiran_kunjungan_file, file.
 *     responses:
 *       '200':
 *         description: Check-out kunjungan berhasil.
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
 *         description: Data check-out tidak valid.
 *       '401':
 *         description: Tidak terautentikasi.
 *       '404':
 *         description: Kunjungan tidak ditemukan atau bukan milik pengguna.
 *       '500':
 *         description: Kesalahan server saat memproses check-out.
 */

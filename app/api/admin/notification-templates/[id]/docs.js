// /**
//  * @swagger
//  * /api/admin/notification-templates/{id}:
//  *   put:
//  *     summary: Memperbarui template notifikasi
//  *     tags: [Admin - Notification Templates]
//  *     security:
//  *       - bearerAuth: []
//  *     parameters:
//  *       - name: id
//  *         in: path
//  *         required: true
//  *         schema:
//  *           type: string
//  *         description: ID dari notification template
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             required:
//  *               - titleTemplate
//  *               - bodyTemplate
//  *             properties:
//  *               titleTemplate:
//  *                 type: string
//  *                 description: Template judul notifikasi
//  *               bodyTemplate:
//  *                 type: string
//  *                 description: Template isi notifikasi
//  *               isActive:
//  *                 type: boolean
//  *                 description: Status aktif/nonaktif template
//  *     responses:
//  *       '200':
//  *         description: Template berhasil diperbarui
//  *       '400':
//  *         description: Bad Request (e.g., field yang dibutuhkan kosong)
//  *       '401':
//  *         description: Unauthorized
//  *       '404':
//  *         description: Template tidak ditemukan
//  *       '500':
//  *         description: Internal Server Error
//  */
// const notificationTemplateid = {};

// export default notificationTemplateid;

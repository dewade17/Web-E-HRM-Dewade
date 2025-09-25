-- AlterTable
ALTER TABLE `kunjungan` ADD COLUMN `hand_over` LONGTEXT NULL;

-- CreateTable
CREATE TABLE `kunjungan_handover` (
    `id_kunjungan_handover` CHAR(36) NOT NULL,
    `id_kunjungan` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `nama_karyawan_snapshot` VARCHAR(255) NULL,
    `meta_json` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `kunjungan_handover_id_kunjungan_idx`(`id_kunjungan`),
    INDEX `kunjungan_handover_id_user_idx`(`id_user`),
    UNIQUE INDEX `kunjungan_handover_id_kunjungan_id_user_key`(`id_kunjungan`, `id_user`),
    PRIMARY KEY (`id_kunjungan_handover`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `kunjungan_handover` ADD CONSTRAINT `kunjungan_handover_id_kunjungan_fkey` FOREIGN KEY (`id_kunjungan`) REFERENCES `kunjungan`(`id_kunjungan`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan_handover` ADD CONSTRAINT `kunjungan_handover_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

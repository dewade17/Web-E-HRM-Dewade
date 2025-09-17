-- CreateTable
CREATE TABLE `catatan` (
    `id_catatan` CHAR(36) NOT NULL,
    `id_absensi` CHAR(36) NOT NULL,
    `deskripsi_catatan` LONGTEXT NOT NULL,
    `lampiran_url` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `catatan_id_absensi_idx`(`id_absensi`),
    PRIMARY KEY (`id_catatan`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `catatan` ADD CONSTRAINT `catatan_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `Absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

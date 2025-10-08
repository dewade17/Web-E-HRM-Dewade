-- AlterTable
ALTER TABLE `todo` ADD COLUMN `date` DATE NULL,
    ADD COLUMN `end_time` DATETIME(0) NULL,
    ADD COLUMN `start_time` DATETIME(0) NULL,
    ADD COLUMN `status` ENUM('diproses', 'selesai', 'ditunda') NOT NULL DEFAULT 'diproses';

-- CreateTable
CREATE TABLE `absensi_report_recipients` (
    `id_absensi_report_recipient` CHAR(36) NOT NULL,
    `id_absensi` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `recipient_role_snapshot` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR') NULL,
    `catatan` LONGTEXT NULL,
    `status` ENUM('terkirim', 'dilihat', 'diproses') NOT NULL DEFAULT 'terkirim',
    `notified_at` DATETIME(0) NULL,
    `read_at` DATETIME(0) NULL,
    `acted_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `absensi_report_recipients_id_absensi_idx`(`id_absensi`),
    INDEX `absensi_report_recipients_id_user_idx`(`id_user`),
    UNIQUE INDEX `absensi_report_recipients_id_absensi_id_user_key`(`id_absensi`, `id_user`),
    PRIMARY KEY (`id_absensi_report_recipient`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `todo_id_user_date_idx` ON `todo`(`id_user`, `date`);

-- AddForeignKey
ALTER TABLE `absensi_report_recipients` ADD CONSTRAINT `absensi_report_recipients_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `Absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absensi_report_recipients` ADD CONSTRAINT `absensi_report_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

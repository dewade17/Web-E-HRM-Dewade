/*
  Warnings:

  - You are about to drop the column `status` on the `absensi` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[id_supervisor]` on the table `departement` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[nomor_induk_karyawan]` on the table `user` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `recipient_nama_snapshot` to the `absensi_report_recipients` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `absensi` DROP COLUMN `status`,
    ADD COLUMN `status_masuk` ENUM('tepat', 'terlambat') NULL,
    ADD COLUMN `status_pulang` ENUM('tepat', 'terlambat') NULL;

-- AlterTable
ALTER TABLE `absensi_report_recipients` ADD COLUMN `recipient_nama_snapshot` VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE `agenda_kerja` ADD COLUMN `kebutuhan_agenda` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `cuti` ADD COLUMN `hand_over` LONGTEXT NULL,
    ADD COLUMN `impact` ENUM('PERSONAL', 'COMPANY') NULL,
    MODIFY `status` ENUM('disetujui', 'ditolak', 'pending', 'menunggu') NOT NULL;

-- AlterTable
ALTER TABLE `cuti_approval` MODIFY `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    MODIFY `decision` ENUM('disetujui', 'ditolak', 'pending', 'menunggu') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `departement` ADD COLUMN `id_supervisor` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `device` ADD COLUMN `failed_push_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `fcm_token` VARCHAR(1024) NULL,
    ADD COLUMN `fcm_token_updated_at` DATETIME(0) NULL,
    ADD COLUMN `last_push_at` DATETIME(0) NULL,
    ADD COLUMN `push_enabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `lembur_approval` MODIFY `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    MODIFY `decision` ENUM('disetujui', 'ditolak', 'pending', 'menunggu') NOT NULL DEFAULT 'pending';

-- AlterTable
ALTER TABLE `pola_kerja` ADD COLUMN `jam_istirahat_mulai` DATETIME(0) NULL,
    ADD COLUMN `jam_istirahat_selesai` DATETIME(0) NULL,
    ADD COLUMN `maks_jam_istirahat` INTEGER NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `alamat_domisili` LONGTEXT NULL,
    ADD COLUMN `alamat_domisili_kota` VARCHAR(255) NULL,
    ADD COLUMN `alamat_domisili_provinsi` VARCHAR(255) NULL,
    ADD COLUMN `alamat_ktp` LONGTEXT NULL,
    ADD COLUMN `alamat_ktp_kota` VARCHAR(255) NULL,
    ADD COLUMN `alamat_ktp_provinsi` VARCHAR(255) NULL,
    ADD COLUMN `divisi` VARCHAR(100) NULL,
    ADD COLUMN `golongan_darah` VARCHAR(5) NULL,
    ADD COLUMN `id_jabatan` CHAR(36) NULL,
    ADD COLUMN `jenis_bank` VARCHAR(50) NULL,
    ADD COLUMN `jenis_kelamin` ENUM('LAKI_LAKI', 'PEREMPUAN') NULL,
    ADD COLUMN `jenjang_pendidikan` VARCHAR(50) NULL,
    ADD COLUMN `jurusan` VARCHAR(100) NULL,
    ADD COLUMN `kontak_darurat` VARCHAR(32) NULL,
    ADD COLUMN `nama_institusi_pendidikan` VARCHAR(255) NULL,
    ADD COLUMN `nomor_induk_karyawan` VARCHAR(100) NULL,
    ADD COLUMN `nomor_rekening` VARCHAR(50) NULL,
    ADD COLUMN `status_kerja` ENUM('AKTIF', 'TIDAK_AKTIF', 'CUTI') NULL,
    ADD COLUMN `status_perkawinan` VARCHAR(50) NULL,
    ADD COLUMN `tahun_lulus` INTEGER NULL,
    ADD COLUMN `tanggal_mulai_bekerja` DATE NULL,
    ADD COLUMN `tempat_lahir` VARCHAR(255) NULL,
    ADD COLUMN `zona_waktu` VARCHAR(50) NULL,
    MODIFY `role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NOT NULL;

-- CreateTable
CREATE TABLE `cuti_konfigurasi` (
    `id_cuti_konfigurasi` CHAR(36) NOT NULL,
    `bulan` ENUM('JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER') NOT NULL,
    `kouta_cuti` INTEGER NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_cuti_konfigurasi`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kategori_kunjungan` (
    `id_kategori_kunjungan` CHAR(36) NOT NULL,
    `kategori_kunjungan` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `kategori_kunjungan_kategori_kunjungan_key`(`kategori_kunjungan`),
    PRIMARY KEY (`id_kategori_kunjungan`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kunjungan` (
    `id_kunjungan` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `id_kategori_kunjungan` CHAR(36) NULL,
    `tanggal` DATE NULL,
    `jam_mulai` DATETIME(0) NULL,
    `jam_selesai` DATETIME(0) NULL,
    `deskripsi` LONGTEXT NULL,
    `jam_checkin` DATETIME(0) NULL,
    `jam_checkout` DATETIME(0) NULL,
    `start_latitude` DECIMAL(10, 6) NULL,
    `start_longitude` DECIMAL(10, 6) NULL,
    `end_latitude` DECIMAL(10, 6) NULL,
    `end_longitude` DECIMAL(10, 6) NULL,
    `lampiran_kunjungan_url` LONGTEXT NULL,
    `status_kunjungan` ENUM('diproses', 'berlangsung', 'selesai') NOT NULL DEFAULT 'diproses',
    `duration` INTEGER NULL,
    `hand_over` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `kunjungan_id_user_tanggal_idx`(`id_user`, `tanggal`),
    INDEX `kunjungan_id_kategori_kunjungan_idx`(`id_kategori_kunjungan`),
    PRIMARY KEY (`id_kunjungan`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kunjungan_report_recipients` (
    `id_kunjungan_report_recipient` CHAR(36) NOT NULL,
    `id_kunjungan` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `recipient_nama_snapshot` VARCHAR(255) NOT NULL,
    `recipient_role_snapshot` ENUM('HR', 'OPERASIONAL', 'DIREKTUR') NULL,
    `catatan` LONGTEXT NULL,
    `status` ENUM('terkirim', 'disetujui', 'ditolak') NOT NULL DEFAULT 'terkirim',
    `notified_at` DATETIME(0) NULL,
    `read_at` DATETIME(0) NULL,
    `acted_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `kunjungan_report_recipients_id_kunjungan_idx`(`id_kunjungan`),
    INDEX `kunjungan_report_recipients_id_user_idx`(`id_user`),
    UNIQUE INDEX `kunjungan_report_recipients_id_kunjungan_id_user_key`(`id_kunjungan`, `id_user`),
    PRIMARY KEY (`id_kunjungan_report_recipient`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jabatan` (
    `id_jabatan` CHAR(36) NOT NULL,
    `nama_jabatan` VARCHAR(256) NOT NULL,
    `id_departement` CHAR(36) NULL,
    `id_induk_jabatan` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `jabatan_id_departement_idx`(`id_departement`),
    INDEX `jabatan_id_induk_jabatan_idx`(`id_induk_jabatan`),
    PRIMARY KEY (`id_jabatan`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `istirahat` (
    `id_istirahat` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `id_absensi` CHAR(36) NOT NULL,
    `tanggal_istirahat` DATE NOT NULL,
    `start_istirahat` DATETIME(0) NOT NULL,
    `end_istirahat` DATETIME(0) NULL,
    `start_istirahat_latitude` DECIMAL(10, 6) NULL,
    `start_istirahat_longitude` DECIMAL(10, 6) NULL,
    `end_istirahat_latitude` DECIMAL(10, 6) NULL,
    `end_istirahat_longitude` DECIMAL(10, 6) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `istirahat_id_user_tanggal_istirahat_idx`(`id_user`, `tanggal_istirahat`),
    INDEX `istirahat_id_absensi_idx`(`id_absensi`),
    PRIMARY KEY (`id_istirahat`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- CreateTable
CREATE TABLE `notifications` (
    `id_notification` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `data_json` LONGTEXT NULL,
    `related_table` VARCHAR(64) NULL,
    `related_id` CHAR(36) NULL,
    `status` ENUM('unread', 'read', 'archived') NOT NULL DEFAULT 'unread',
    `seen_at` DATETIME(0) NULL,
    `read_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `notifications_id_user_status_created_at_idx`(`id_user`, `status`, `created_at`),
    INDEX `notifications_related_table_related_id_idx`(`related_table`, `related_id`),
    PRIMARY KEY (`id_notification`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_templates` (
    `id` VARCHAR(191) NOT NULL,
    `event_trigger` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `title_template` VARCHAR(191) NOT NULL,
    `body_template` TEXT NOT NULL,
    `placeholders` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_templates_event_trigger_key`(`event_trigger`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `departement_id_supervisor_key` ON `departement`(`id_supervisor`);

-- CreateIndex
CREATE INDEX `device_device_identifier_idx` ON `device`(`device_identifier`);

-- CreateIndex
CREATE INDEX `device_fcm_token_idx` ON `device`(`fcm_token`(191));

-- CreateIndex
CREATE UNIQUE INDEX `user_nomor_induk_karyawan_key` ON `user`(`nomor_induk_karyawan`);

-- CreateIndex
CREATE INDEX `user_id_jabatan_idx` ON `user`(`id_jabatan`);

-- AddForeignKey
ALTER TABLE `kunjungan` ADD CONSTRAINT `kunjungan_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan` ADD CONSTRAINT `kunjungan_id_kategori_kunjungan_fkey` FOREIGN KEY (`id_kategori_kunjungan`) REFERENCES `kategori_kunjungan`(`id_kategori_kunjungan`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan_report_recipients` ADD CONSTRAINT `kunjungan_report_recipients_id_kunjungan_fkey` FOREIGN KEY (`id_kunjungan`) REFERENCES `kunjungan`(`id_kunjungan`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan_report_recipients` ADD CONSTRAINT `kunjungan_report_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_jabatan_fkey` FOREIGN KEY (`id_jabatan`) REFERENCES `jabatan`(`id_jabatan`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departement` ADD CONSTRAINT `departement_id_supervisor_fkey` FOREIGN KEY (`id_supervisor`) REFERENCES `user`(`id_user`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jabatan` ADD CONSTRAINT `jabatan_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jabatan` ADD CONSTRAINT `jabatan_id_induk_jabatan_fkey` FOREIGN KEY (`id_induk_jabatan`) REFERENCES `jabatan`(`id_jabatan`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `istirahat` ADD CONSTRAINT `istirahat_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `istirahat` ADD CONSTRAINT `istirahat_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `Absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catatan` ADD CONSTRAINT `catatan_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `Absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

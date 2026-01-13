-- DropForeignKey
ALTER TABLE `absensi` DROP FOREIGN KEY `Absensi_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `absensi_report_recipients` DROP FOREIGN KEY `absensi_report_recipients_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `agenda_kerja` DROP FOREIGN KEY `agenda_kerja_id_agenda_fkey`;

-- DropForeignKey
ALTER TABLE `agenda_kerja` DROP FOREIGN KEY `agenda_kerja_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `approval_izin_sakit` DROP FOREIGN KEY `approval_izin_sakit_approver_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `approval_izin_tukar_hari` DROP FOREIGN KEY `approval_izin_tukar_hari_approver_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `approval_pengajuan_cuti` DROP FOREIGN KEY `approval_pengajuan_cuti_approver_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `approval_pengajuan_izin_jam` DROP FOREIGN KEY `approval_pengajuan_izin_jam_approver_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `broadcasts_recipients` DROP FOREIGN KEY `broadcasts_recipients_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `cuti_konfigurasi` DROP FOREIGN KEY `cuti_konfigurasi_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `handover_cuti` DROP FOREIGN KEY `handover_cuti_id_user_tagged_fkey`;

-- DropForeignKey
ALTER TABLE `handover_izin_jam` DROP FOREIGN KEY `handover_izin_jam_id_user_tagged_fkey`;

-- DropForeignKey
ALTER TABLE `handover_izin_sakit` DROP FOREIGN KEY `handover_izin_sakit_id_user_tagged_fkey`;

-- DropForeignKey
ALTER TABLE `handover_tukar_hari` DROP FOREIGN KEY `handover_tukar_hari_id_user_tagged_fkey`;

-- DropForeignKey
ALTER TABLE `istirahat` DROP FOREIGN KEY `istirahat_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `izin_tukar_hari` DROP FOREIGN KEY `izin_tukar_hari_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `kunjungan` DROP FOREIGN KEY `kunjungan_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `kunjungan_report_recipients` DROP FOREIGN KEY `kunjungan_report_recipients_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `lembur` DROP FOREIGN KEY `Lembur_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `lembur_approval` DROP FOREIGN KEY `lembur_approval_approver_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `pengajuan_cuti` DROP FOREIGN KEY `pengajuan_cuti_id_kategori_cuti_fkey`;

-- DropForeignKey
ALTER TABLE `pengajuan_cuti` DROP FOREIGN KEY `pengajuan_cuti_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `pengajuan_izin_jam` DROP FOREIGN KEY `pengajuan_izin_jam_id_kategori_izin_jam_fkey`;

-- DropForeignKey
ALTER TABLE `pengajuan_izin_jam` DROP FOREIGN KEY `pengajuan_izin_jam_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `pengajuan_izin_sakit` DROP FOREIGN KEY `pengajuan_izin_sakit_id_kategori_sakit_fkey`;

-- DropForeignKey
ALTER TABLE `pengajuan_izin_sakit` DROP FOREIGN KEY `pengajuan_izin_sakit_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `shift_kerja` DROP FOREIGN KEY `shift_kerja_id_pola_kerja_fkey`;

-- DropForeignKey
ALTER TABLE `shift_kerja` DROP FOREIGN KEY `shift_kerja_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `shift_story_planer` DROP FOREIGN KEY `shift_story_planer_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `story_planner` DROP FOREIGN KEY `story_planner_id_user_fkey`;

-- DropForeignKey
ALTER TABLE `user` DROP FOREIGN KEY `user_id_location_fkey`;

-- AlterTable
ALTER TABLE `cuti_konfigurasi` ALTER COLUMN `cuti_tabung` DROP DEFAULT;

-- AlterTable
ALTER TABLE `user` MODIFY `status_cuti` ENUM('aktif', 'nonaktif') NOT NULL DEFAULT 'aktif';

-- CreateTable
CREATE TABLE `kategori_keperluan` (
    `id_kategori_keperluan` CHAR(36) NOT NULL,
    `nama_keperluan` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_kategori_keperluan`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reimburse` (
    `id_reimburse` CHAR(36) NOT NULL,
    `id_departement` CHAR(36) NOT NULL,
    `id_kategori_keperluan` CHAR(36) NULL,
    `tanggal` DATE NOT NULL,
    `keterangan` LONGTEXT NULL,
    `total_pengeluaran` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `metode_pembayaran` VARCHAR(50) NOT NULL,
    `nomor_rekening` VARCHAR(50) NULL,
    `nama_pemilik_rekening` VARCHAR(255) NULL,
    `jenis_bank` VARCHAR(50) NULL,
    `bukti_pembayaran_url` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `current_level` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `reimburse_id_departement_tanggal_idx`(`id_departement`, `tanggal`),
    INDEX `reimburse_metode_pembayaran_idx`(`metode_pembayaran`),
    INDEX `reimburse_id_kategori_keperluan_idx`(`id_kategori_keperluan`),
    PRIMARY KEY (`id_reimburse`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reimburse_items` (
    `id_reimburse_item` CHAR(36) NOT NULL,
    `id_reimburse` CHAR(36) NOT NULL,
    `nama_item_reimburse` LONGTEXT NOT NULL,
    `harga` DECIMAL(15, 2) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `reimburse_items_id_reimburse_idx`(`id_reimburse`),
    PRIMARY KEY (`id_reimburse_item`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pocket_money` (
    `id_pocket_money` CHAR(36) NOT NULL,
    `id_departement` CHAR(36) NOT NULL,
    `id_kategori_keperluan` CHAR(36) NULL,
    `tanggal` DATE NOT NULL,
    `keterangan` LONGTEXT NULL,
    `total_pengeluaran` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `metode_pembayaran` VARCHAR(50) NOT NULL,
    `nomor_rekening` VARCHAR(50) NULL,
    `nama_pemilik_rekening` VARCHAR(255) NULL,
    `jenis_bank` VARCHAR(50) NULL,
    `bukti_pembayaran_url` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `current_level` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `pocket_money_id_departement_tanggal_idx`(`id_departement`, `tanggal`),
    INDEX `pocket_money_metode_pembayaran_idx`(`metode_pembayaran`),
    INDEX `pocket_money_id_kategori_keperluan_idx`(`id_kategori_keperluan`),
    PRIMARY KEY (`id_pocket_money`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pocket_money_items` (
    `id_pocket_money_item` CHAR(36) NOT NULL,
    `id_pocket_money` CHAR(36) NOT NULL,
    `nama_item_pocket_money` LONGTEXT NOT NULL,
    `harga` DECIMAL(15, 2) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `pocket_money_items_id_pocket_money_idx`(`id_pocket_money`),
    PRIMARY KEY (`id_pocket_money_item`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment` (
    `id_payment` CHAR(36) NOT NULL,
    `id_departement` CHAR(36) NOT NULL,
    `id_kategori_keperluan` CHAR(36) NULL,
    `tanggal` DATE NOT NULL,
    `keterangan` LONGTEXT NULL,
    `nominal_pembayaran` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `metode_pembayaran` VARCHAR(50) NOT NULL,
    `nomor_rekening` VARCHAR(50) NULL,
    `nama_pemilik_rekening` VARCHAR(255) NULL,
    `jenis_bank` VARCHAR(50) NULL,
    `bukti_pembayaran_url` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `current_level` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `payment_id_departement_tanggal_idx`(`id_departement`, `tanggal`),
    INDEX `payment_metode_pembayaran_idx`(`metode_pembayaran`),
    INDEX `payment_id_kategori_keperluan_idx`(`id_kategori_keperluan`),
    PRIMARY KEY (`id_payment`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_reimburse` (
    `id_approval_reimburse` CHAR(36) NOT NULL,
    `id_reimburse` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `bukti_approval_reimburse_url` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `approval_reimburse_id_reimburse_level_idx`(`id_reimburse`, `level`),
    INDEX `approval_reimburse_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_approval_reimburse`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_payment` (
    `id_approval_payment` CHAR(36) NOT NULL,
    `id_payment` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `bukti_approval_payment_url` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `approval_payment_id_payment_level_idx`(`id_payment`, `level`),
    INDEX `approval_payment_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_approval_payment`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_pocket_money` (
    `id_approval_pocket_money` CHAR(36) NOT NULL,
    `id_pocket_money` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `bukti_approval_pocket_money_url` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `approval_pocket_money_id_pocket_money_level_idx`(`id_pocket_money`, `level`),
    INDEX `approval_pocket_money_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_approval_pocket_money`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `broadcasts_recipients` ADD CONSTRAINT `broadcasts_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_kerja` ADD CONSTRAINT `shift_kerja_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_kerja` ADD CONSTRAINT `shift_kerja_id_pola_kerja_fkey` FOREIGN KEY (`id_pola_kerja`) REFERENCES `pola_kerja`(`id_pola_kerja`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_agenda_fkey` FOREIGN KEY (`id_agenda`) REFERENCES `agenda`(`id_agenda`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan` ADD CONSTRAINT `kunjungan_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan_report_recipients` ADD CONSTRAINT `kunjungan_report_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_location_fkey` FOREIGN KEY (`id_location`) REFERENCES `location`(`id_location`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `istirahat` ADD CONSTRAINT `istirahat_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_planner` ADD CONSTRAINT `story_planner_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Absensi` ADD CONSTRAINT `Absensi_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absensi_report_recipients` ADD CONSTRAINT `absensi_report_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lembur` ADD CONSTRAINT `Lembur_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lembur_approval` ADD CONSTRAINT `lembur_approval_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_story_planer` ADD CONSTRAINT `shift_story_planer_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuti_konfigurasi` ADD CONSTRAINT `cuti_konfigurasi_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_cuti` ADD CONSTRAINT `pengajuan_cuti_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_cuti` ADD CONSTRAINT `pengajuan_cuti_id_kategori_cuti_fkey` FOREIGN KEY (`id_kategori_cuti`) REFERENCES `kategori_cuti`(`id_kategori_cuti`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pengajuan_cuti` ADD CONSTRAINT `approval_pengajuan_cuti_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_sakit` ADD CONSTRAINT `pengajuan_izin_sakit_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_sakit` ADD CONSTRAINT `pengajuan_izin_sakit_id_kategori_sakit_fkey` FOREIGN KEY (`id_kategori_sakit`) REFERENCES `kategori_sakit`(`id_kategori_sakit`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_izin_sakit` ADD CONSTRAINT `approval_izin_sakit_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_jam` ADD CONSTRAINT `pengajuan_izin_jam_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_jam` ADD CONSTRAINT `pengajuan_izin_jam_id_kategori_izin_jam_fkey` FOREIGN KEY (`id_kategori_izin_jam`) REFERENCES `kategori_izin_jam`(`id_kategori_izin_jam`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pengajuan_izin_jam` ADD CONSTRAINT `approval_pengajuan_izin_jam_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `izin_tukar_hari` ADD CONSTRAINT `izin_tukar_hari_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_izin_tukar_hari` ADD CONSTRAINT `approval_izin_tukar_hari_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_cuti` ADD CONSTRAINT `handover_cuti_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_izin_sakit` ADD CONSTRAINT `handover_izin_sakit_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_izin_jam` ADD CONSTRAINT `handover_izin_jam_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_tukar_hari` ADD CONSTRAINT `handover_tukar_hari_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reimburse` ADD CONSTRAINT `reimburse_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reimburse` ADD CONSTRAINT `reimburse_id_kategori_keperluan_fkey` FOREIGN KEY (`id_kategori_keperluan`) REFERENCES `kategori_keperluan`(`id_kategori_keperluan`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reimburse_items` ADD CONSTRAINT `reimburse_items_id_reimburse_fkey` FOREIGN KEY (`id_reimburse`) REFERENCES `reimburse`(`id_reimburse`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pocket_money` ADD CONSTRAINT `pocket_money_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pocket_money` ADD CONSTRAINT `pocket_money_id_kategori_keperluan_fkey` FOREIGN KEY (`id_kategori_keperluan`) REFERENCES `kategori_keperluan`(`id_kategori_keperluan`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pocket_money_items` ADD CONSTRAINT `pocket_money_items_id_pocket_money_fkey` FOREIGN KEY (`id_pocket_money`) REFERENCES `pocket_money`(`id_pocket_money`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_id_kategori_keperluan_fkey` FOREIGN KEY (`id_kategori_keperluan`) REFERENCES `kategori_keperluan`(`id_kategori_keperluan`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_reimburse` ADD CONSTRAINT `approval_reimburse_id_reimburse_fkey` FOREIGN KEY (`id_reimburse`) REFERENCES `reimburse`(`id_reimburse`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_reimburse` ADD CONSTRAINT `approval_reimburse_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_payment` ADD CONSTRAINT `approval_payment_id_payment_fkey` FOREIGN KEY (`id_payment`) REFERENCES `payment`(`id_payment`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_payment` ADD CONSTRAINT `approval_payment_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pocket_money` ADD CONSTRAINT `approval_pocket_money_id_pocket_money_fkey` FOREIGN KEY (`id_pocket_money`) REFERENCES `pocket_money`(`id_pocket_money`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pocket_money` ADD CONSTRAINT `approval_pocket_money_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

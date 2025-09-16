-- CreateTable
CREATE TABLE `location` (
    `id_location` CHAR(36) NOT NULL,
    `nama_kantor` VARCHAR(255) NOT NULL,
    `latitude` DECIMAL(10, 6) NOT NULL,
    `longitude` DECIMAL(10, 6) NOT NULL,
    `radius` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_location`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broadcasts` (
    `id_broadcasts` CHAR(36) NOT NULL,
    `title` LONGTEXT NOT NULL,
    `message` LONGTEXT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_broadcasts`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broadcasts_recipients` (
    `id_broadcast_recipients` CHAR(36) NOT NULL,
    `id_broadcast` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `nama_karyawan_snapshot` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `broadcasts_recipients_id_broadcast_idx`(`id_broadcast`),
    INDEX `broadcasts_recipients_id_user_idx`(`id_user`),
    PRIMARY KEY (`id_broadcast_recipients`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Cuti` (
    `id_cuti` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `tanggal_pengajuan` DATE NULL,
    `tanggal_mulai` DATE NULL,
    `tanggal_selesai` DATE NULL,
    `bukti_url` LONGTEXT NULL,
    `keterangan` ENUM('cuti', 'sakit', 'izin') NOT NULL,
    `alasan` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL,
    `current_level` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `Cuti_id_user_idx`(`id_user`),
    PRIMARY KEY (`id_cuti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cuti_approval` (
    `id_cuti_approval` CHAR(36) NOT NULL,
    `id_cuti` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `cuti_approval_id_cuti_level_idx`(`id_cuti`, `level`),
    INDEX `cuti_approval_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_cuti_approval`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pola_kerja` (
    `id_pola_kerja` CHAR(36) NOT NULL,
    `nama_pola_kerja` VARCHAR(255) NOT NULL,
    `jam_mulai` DATETIME(0) NOT NULL,
    `jam_selesai` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_pola_kerja`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_kerja` (
    `id_shift_kerja` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `tanggal_mulai` DATE NULL,
    `tanggal_selesai` DATE NULL,
    `hari_kerja` VARCHAR(191) NOT NULL,
    `status` ENUM('KERJA', 'LIBUR') NOT NULL,
    `id_pola_kerja` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `shift_kerja_id_user_tanggal_mulai_idx`(`id_user`, `tanggal_mulai`),
    INDEX `shift_kerja_id_pola_kerja_idx`(`id_pola_kerja`),
    PRIMARY KEY (`id_shift_kerja`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenda_kerja` (
    `id_agenda` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `deskripsi_kerja` LONGTEXT NOT NULL,
    `tanggal` DATE NULL,
    `count_time` DATETIME(0) NULL,
    `status` ENUM('berjalan', 'berhenti', 'selesai') NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `agenda_kerja_id_user_idx`(`id_user`),
    PRIMARY KEY (`id_agenda`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user` (
    `id_user` CHAR(36) NOT NULL,
    `nama_pengguna` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `kontak` VARCHAR(32) NULL,
    `password_updated_at` DATETIME(0) NULL,
    `foto_profil_user` LONGTEXT NULL,
    `tanggal_lahir` DATE NULL,
    `role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR') NOT NULL,
    `id_departement` CHAR(36) NOT NULL,
    `id_location` CHAR(36) NOT NULL,
    `reset_password_token` VARCHAR(255) NULL,
    `reset_password_expires_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `user_email_key`(`email`),
    INDEX `user_id_departement_idx`(`id_departement`),
    INDEX `user_id_location_idx`(`id_location`),
    PRIMARY KEY (`id_user`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departement` (
    `id_departement` CHAR(36) NOT NULL,
    `nama_departement` VARCHAR(256) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_departement`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `face` (
    `id_face` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `image_face` LONGTEXT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `face_id_user_idx`(`id_user`),
    PRIMARY KEY (`id_face`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `story_planner` (
    `id_story` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `id_departement` CHAR(36) NOT NULL,
    `deskripsi_kerja` LONGTEXT NOT NULL,
    `count_time` DATETIME(0) NULL,
    `status` ENUM('berjalan', 'berhenti', 'selesai') NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `story_planner_id_user_idx`(`id_user`),
    INDEX `story_planner_id_departement_idx`(`id_departement`),
    PRIMARY KEY (`id_story`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device` (
    `id_device` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `device_label` VARCHAR(255) NULL,
    `platform` VARCHAR(50) NULL,
    `os_version` VARCHAR(50) NULL,
    `app_version` VARCHAR(50) NULL,
    `device_identifier` VARCHAR(191) NULL,
    `last_seen` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `device_id_user_idx`(`id_user`),
    PRIMARY KEY (`id_device`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Absensi` (
    `id_absensi` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `face_verified_masuk` BOOLEAN NOT NULL,
    `face_verified_pulang` BOOLEAN NOT NULL,
    `tanggal` DATE NULL,
    `id_lokasi_pulang` CHAR(36) NULL,
    `id_lokasi_datang` CHAR(36) NULL,
    `jam_masuk` DATETIME(0) NULL,
    `jam_pulang` DATETIME(0) NULL,
    `status` ENUM('tepat', 'terlambat') NOT NULL,
    `id_device` CHAR(36) NULL,
    `in_latitude` DECIMAL(10, 6) NULL,
    `in_longitude` DECIMAL(10, 6) NULL,
    `out_latitude` DECIMAL(10, 6) NULL,
    `out_longitude` DECIMAL(10, 6) NULL,
    `device_info` VARCHAR(255) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `Absensi_id_user_tanggal_idx`(`id_user`, `tanggal`),
    INDEX `Absensi_id_lokasi_datang_idx`(`id_lokasi_datang`),
    INDEX `Absensi_id_lokasi_pulang_idx`(`id_lokasi_pulang`),
    INDEX `Absensi_id_device_idx`(`id_device`),
    UNIQUE INDEX `Absensi_id_user_tanggal_key`(`id_user`, `tanggal`),
    PRIMARY KEY (`id_absensi`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Lembur` (
    `id_lembur` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `tanggal` DATE NULL,
    `jam_mulai` DATETIME(0) NULL,
    `jam_selesai` DATETIME(0) NULL,
    `alasan` LONGTEXT NULL,
    `status` ENUM('pending', 'disetujui', 'ditolak') NOT NULL,
    `current_level` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `Lembur_id_user_tanggal_idx`(`id_user`, `tanggal`),
    INDEX `Lembur_status_idx`(`status`),
    PRIMARY KEY (`id_lembur`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lembur_approval` (
    `id_lembur_approval` CHAR(36) NOT NULL,
    `id_lembur` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `lembur_approval_id_lembur_level_idx`(`id_lembur`, `level`),
    INDEX `lembur_approval_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_lembur_approval`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jadwal_piket` (
    `id_jadwal_piket` CHAR(36) NOT NULL,
    `Tahun` DATE NULL,
    `Bulan` ENUM('JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER') NOT NULL,
    `keterangan` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_jadwal_piket`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jadwal_story_planer` (
    `id_jadwal_story_planner` CHAR(36) NOT NULL,
    `Tahun` DATE NULL,
    `Bulan` ENUM('JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER') NOT NULL,
    `keterangan` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_jadwal_story_planner`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_piket` (
    `id_shift_piket` CHAR(36) NOT NULL,
    `id_jadwal_piket` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `hari_piket` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `shift_piket_id_jadwal_piket_idx`(`id_jadwal_piket`),
    INDEX `shift_piket_id_user_idx`(`id_user`),
    PRIMARY KEY (`id_shift_piket`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_story_planer` (
    `id_shift_story_planner` CHAR(36) NOT NULL,
    `id_jadwal_story_planner` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `hari_story_planner` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `shift_story_planer_id_jadwal_story_planner_idx`(`id_jadwal_story_planner`),
    INDEX `shift_story_planer_id_user_idx`(`id_user`),
    PRIMARY KEY (`id_shift_story_planner`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `broadcasts_recipients` ADD CONSTRAINT `broadcasts_recipients_id_broadcast_fkey` FOREIGN KEY (`id_broadcast`) REFERENCES `broadcasts`(`id_broadcasts`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broadcasts_recipients` ADD CONSTRAINT `broadcasts_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Cuti` ADD CONSTRAINT `Cuti_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuti_approval` ADD CONSTRAINT `cuti_approval_id_cuti_fkey` FOREIGN KEY (`id_cuti`) REFERENCES `Cuti`(`id_cuti`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuti_approval` ADD CONSTRAINT `cuti_approval_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_kerja` ADD CONSTRAINT `shift_kerja_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_kerja` ADD CONSTRAINT `shift_kerja_id_pola_kerja_fkey` FOREIGN KEY (`id_pola_kerja`) REFERENCES `pola_kerja`(`id_pola_kerja`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_location_fkey` FOREIGN KEY (`id_location`) REFERENCES `location`(`id_location`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `face` ADD CONSTRAINT `face_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_planner` ADD CONSTRAINT `story_planner_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_planner` ADD CONSTRAINT `story_planner_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device` ADD CONSTRAINT `device_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Absensi` ADD CONSTRAINT `Absensi_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Absensi` ADD CONSTRAINT `Absensi_id_device_fkey` FOREIGN KEY (`id_device`) REFERENCES `device`(`id_device`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Absensi` ADD CONSTRAINT `Absensi_id_lokasi_datang_fkey` FOREIGN KEY (`id_lokasi_datang`) REFERENCES `location`(`id_location`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Absensi` ADD CONSTRAINT `Absensi_id_lokasi_pulang_fkey` FOREIGN KEY (`id_lokasi_pulang`) REFERENCES `location`(`id_location`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Lembur` ADD CONSTRAINT `Lembur_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lembur_approval` ADD CONSTRAINT `lembur_approval_id_lembur_fkey` FOREIGN KEY (`id_lembur`) REFERENCES `Lembur`(`id_lembur`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lembur_approval` ADD CONSTRAINT `lembur_approval_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_piket` ADD CONSTRAINT `shift_piket_id_jadwal_piket_fkey` FOREIGN KEY (`id_jadwal_piket`) REFERENCES `jadwal_piket`(`id_jadwal_piket`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_piket` ADD CONSTRAINT `shift_piket_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_story_planer` ADD CONSTRAINT `shift_story_planer_id_jadwal_story_planner_fkey` FOREIGN KEY (`id_jadwal_story_planner`) REFERENCES `jadwal_story_planer`(`id_jadwal_story_planner`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_story_planer` ADD CONSTRAINT `shift_story_planer_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

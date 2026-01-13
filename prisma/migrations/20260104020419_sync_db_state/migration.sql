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
CREATE TABLE `broadcast_attachments` (
    `id_broadcast_attachment` CHAR(36) NOT NULL,
    `id_broadcast` CHAR(36) NOT NULL,
    `lampiran_url` LONGTEXT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `broadcast_attachments_id_broadcast_idx`(`id_broadcast`),
    PRIMARY KEY (`id_broadcast_attachment`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pola_kerja` (
    `id_pola_kerja` CHAR(36) NOT NULL,
    `nama_pola_kerja` VARCHAR(255) NOT NULL,
    `jam_mulai` DATETIME(0) NOT NULL,
    `jam_selesai` DATETIME(0) NOT NULL,
    `jam_istirahat_mulai` DATETIME(0) NULL,
    `jam_istirahat_selesai` DATETIME(0) NULL,
    `maks_jam_istirahat` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_pola_kerja`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shift_kerja` (
    `id_shift_kerja` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `tanggal_mulai` DATE NOT NULL,
    `tanggal_selesai` DATE NOT NULL,
    `hari_kerja` VARCHAR(191) NOT NULL,
    `status` ENUM('KERJA', 'LIBUR') NOT NULL,
    `id_pola_kerja` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `shift_kerja_id_user_tanggal_mulai_idx`(`id_user`, `tanggal_mulai`),
    INDEX `shift_kerja_id_pola_kerja_idx`(`id_pola_kerja`),
    UNIQUE INDEX `shift_kerja_id_user_tanggal_mulai_key`(`id_user`, `tanggal_mulai`),
    PRIMARY KEY (`id_shift_kerja`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenda` (
    `id_agenda` CHAR(36) NOT NULL,
    `nama_agenda` LONGTEXT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_agenda`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenda_kerja` (
    `id_agenda_kerja` CHAR(36) NOT NULL,
    `id_absensi` CHAR(36) NULL,
    `id_agenda` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `deskripsi_kerja` LONGTEXT NOT NULL,
    `start_date` DATETIME(0) NULL,
    `end_date` DATETIME(0) NULL,
    `duration_seconds` INTEGER NULL,
    `status` ENUM('teragenda', 'diproses', 'ditunda', 'selesai') NOT NULL,
    `kebutuhan_agenda` VARCHAR(255) NULL,
    `created_by_snapshot` VARCHAR(255) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `agenda_kerja_id_user_start_date_idx`(`id_user`, `start_date`),
    INDEX `agenda_kerja_id_absensi_idx`(`id_absensi`),
    INDEX `agenda_kerja_id_agenda_idx`(`id_agenda`),
    PRIMARY KEY (`id_agenda_kerja`)
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
    `created_by_snapshot` VARCHAR(255) NULL,
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
    `recipient_role_snapshot` ENUM('HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN') NULL,
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
CREATE TABLE `user` (
    `id_user` CHAR(36) NOT NULL,
    `nama_pengguna` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `kontak` VARCHAR(32) NULL,
    `nama_kontak_darurat` VARCHAR(32) NULL,
    `kontak_darurat` VARCHAR(32) NULL,
    `password_updated_at` DATETIME(0) NULL,
    `agama` VARCHAR(32) NULL,
    `foto_profil_user` LONGTEXT NULL,
    `tanggal_lahir` DATE NULL,
    `role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NOT NULL,
    `id_departement` CHAR(36) NULL,
    `id_location` CHAR(36) NULL,
    `reset_password_token` VARCHAR(255) NULL,
    `reset_password_expires_at` DATETIME(0) NULL,
    `tempat_lahir` VARCHAR(255) NULL,
    `jenis_kelamin` ENUM('LAKI_LAKI', 'PEREMPUAN') NULL,
    `golongan_darah` VARCHAR(5) NULL,
    `status_perkawinan` VARCHAR(50) NULL,
    `alamat_ktp` LONGTEXT NULL,
    `alamat_ktp_provinsi` VARCHAR(255) NULL,
    `alamat_ktp_kota` VARCHAR(255) NULL,
    `alamat_domisili` LONGTEXT NULL,
    `alamat_domisili_provinsi` VARCHAR(255) NULL,
    `alamat_domisili_kota` VARCHAR(255) NULL,
    `zona_waktu` VARCHAR(50) NULL,
    `jenjang_pendidikan` VARCHAR(50) NULL,
    `jurusan` VARCHAR(100) NULL,
    `nama_institusi_pendidikan` VARCHAR(255) NULL,
    `tahun_lulus` INTEGER NULL,
    `nomor_induk_karyawan` VARCHAR(100) NULL,
    `divisi` VARCHAR(100) NULL,
    `id_jabatan` CHAR(36) NULL,
    `status_kerja` ENUM('AKTIF', 'TIDAK_AKTIF', 'CUTI') NULL,
    `status_cuti` ENUM('aktif', 'nonaktif') NOT NULL DEFAULT 'nonaktif',
    `tanggal_mulai_bekerja` DATE NULL,
    `nomor_rekening` VARCHAR(50) NULL,
    `jenis_bank` VARCHAR(50) NULL,
    `catatan_delete` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `user_email_key`(`email`),
    UNIQUE INDEX `user_nomor_induk_karyawan_key`(`nomor_induk_karyawan`),
    INDEX `user_id_departement_idx`(`id_departement`),
    INDEX `user_id_location_idx`(`id_location`),
    INDEX `user_id_jabatan_idx`(`id_jabatan`),
    PRIMARY KEY (`id_user`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `departement` (
    `id_departement` CHAR(36) NOT NULL,
    `nama_departement` VARCHAR(256) NOT NULL,
    `id_supervisor` CHAR(36) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `departement_id_supervisor_key`(`id_supervisor`),
    PRIMARY KEY (`id_departement`)
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
    `id_departement` CHAR(36) NULL,
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
    `fcm_token` VARCHAR(1024) NULL,
    `fcm_token_updated_at` DATETIME(0) NULL,
    `push_enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_push_at` DATETIME(0) NULL,
    `failed_push_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `device_id_user_idx`(`id_user`),
    INDEX `device_device_identifier_idx`(`device_identifier`),
    INDEX `device_fcm_token_idx`(`fcm_token`(191)),
    PRIMARY KEY (`id_device`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `absensi_report_recipients` (
    `id_absensi_report_recipient` CHAR(36) NOT NULL,
    `id_absensi` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `recipient_nama_snapshot` VARCHAR(255) NOT NULL,
    `recipient_role_snapshot` ENUM('HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN') NULL,
    `catatan` LONGTEXT NULL,
    `status` ENUM('terkirim', 'disetujui', 'ditolak') NOT NULL DEFAULT 'terkirim',
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

-- CreateTable
CREATE TABLE `lembur_approval` (
    `id_lembur_approval` CHAR(36) NOT NULL,
    `id_lembur` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
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

-- CreateTable
CREATE TABLE `kategori_sakit` (
    `id_kategori_sakit` CHAR(36) NOT NULL,
    `nama_kategori` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_kategori_sakit`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kategori_izin_jam` (
    `id_kategori_izin_jam` CHAR(36) NOT NULL,
    `nama_kategori` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_kategori_izin_jam`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cuti_konfigurasi` (
    `id_cuti_konfigurasi` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `bulan` ENUM('JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER') NOT NULL,
    `kouta_cuti` INTEGER NOT NULL,
    `cuti_tabung` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `cuti_konfigurasi_id_user_idx`(`id_user`),
    UNIQUE INDEX `cuti_konfigurasi_id_user_bulan_key`(`id_user`, `bulan`),
    PRIMARY KEY (`id_cuti_konfigurasi`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kategori_cuti` (
    `id_kategori_cuti` CHAR(36) NOT NULL,
    `nama_kategori` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,
    `pengurangan_kouta` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id_kategori_cuti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pengajuan_cuti` (
    `id_pengajuan_cuti` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `id_kategori_cuti` CHAR(36) NOT NULL,
    `keperluan` LONGTEXT NULL,
    `tanggal_masuk_kerja` DATE NOT NULL,
    `handover` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `current_level` INTEGER NULL,
    `jenis_pengajuan` VARCHAR(32) NOT NULL,
    `lampiran_cuti_url` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `pengajuan_cuti_id_user_idx`(`id_user`),
    INDEX `pengajuan_cuti_id_kategori_cuti_idx`(`id_kategori_cuti`),
    PRIMARY KEY (`id_pengajuan_cuti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pengajuan_cuti_tanggal` (
    `id_pengajuan_cuti_tanggal` CHAR(36) NOT NULL,
    `id_pengajuan_cuti` CHAR(36) NOT NULL,
    `tanggal_cuti` DATE NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `pengajuan_cuti_tanggal_id_pengajuan_cuti_tanggal_cuti_idx`(`id_pengajuan_cuti`, `tanggal_cuti`),
    UNIQUE INDEX `pengajuan_cuti_tanggal_id_pengajuan_cuti_tanggal_cuti_key`(`id_pengajuan_cuti`, `tanggal_cuti`),
    PRIMARY KEY (`id_pengajuan_cuti_tanggal`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_pengajuan_cuti` (
    `id_approval_pengajuan_cuti` CHAR(36) NOT NULL,
    `id_pengajuan_cuti` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `approval_pengajuan_cuti_id_pengajuan_cuti_level_idx`(`id_pengajuan_cuti`, `level`),
    INDEX `approval_pengajuan_cuti_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_approval_pengajuan_cuti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pengajuan_izin_sakit` (
    `id_pengajuan_izin_sakit` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `id_kategori_sakit` CHAR(36) NOT NULL,
    `handover` LONGTEXT NULL,
    `lampiran_izin_sakit_url` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `current_level` INTEGER NULL,
    `jenis_pengajuan` VARCHAR(32) NOT NULL,
    `tanggal_pengajuan` DATE NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `pengajuan_izin_sakit_id_user_idx`(`id_user`),
    INDEX `pengajuan_izin_sakit_id_kategori_sakit_idx`(`id_kategori_sakit`),
    PRIMARY KEY (`id_pengajuan_izin_sakit`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_izin_sakit` (
    `id_approval_izin_sakit` CHAR(36) NOT NULL,
    `id_pengajuan_izin_sakit` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `approval_izin_sakit_id_pengajuan_izin_sakit_level_idx`(`id_pengajuan_izin_sakit`, `level`),
    INDEX `approval_izin_sakit_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_approval_izin_sakit`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pengajuan_izin_jam` (
    `id_pengajuan_izin_jam` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `id_kategori_izin_jam` CHAR(36) NOT NULL,
    `tanggal_izin` DATE NOT NULL,
    `jam_mulai` DATETIME(0) NOT NULL,
    `jam_selesai` DATETIME(0) NOT NULL,
    `tanggal_pengganti` DATE NULL,
    `jam_mulai_pengganti` DATETIME(0) NULL,
    `jam_selesai_pengganti` DATETIME(0) NULL,
    `keperluan` LONGTEXT NULL,
    `handover` LONGTEXT NULL,
    `lampiran_izin_jam_url` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `current_level` INTEGER NULL,
    `jenis_pengajuan` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `pengajuan_izin_jam_id_user_tanggal_izin_idx`(`id_user`, `tanggal_izin`),
    INDEX `pengajuan_izin_jam_id_kategori_izin_jam_idx`(`id_kategori_izin_jam`),
    PRIMARY KEY (`id_pengajuan_izin_jam`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_pengajuan_izin_jam` (
    `id_approval_pengajuan_izin_jam` CHAR(36) NOT NULL,
    `id_pengajuan_izin_jam` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `approval_pengajuan_izin_jam_id_pengajuan_izin_jam_level_idx`(`id_pengajuan_izin_jam`, `level`),
    INDEX `approval_pengajuan_izin_jam_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_approval_pengajuan_izin_jam`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `izin_tukar_hari` (
    `id_izin_tukar_hari` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `kategori` VARCHAR(255) NOT NULL,
    `keperluan` LONGTEXT NULL,
    `handover` LONGTEXT NULL,
    `lampiran_izin_tukar_hari_url` LONGTEXT NULL,
    `status` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `current_level` INTEGER NULL,
    `jenis_pengajuan` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `izin_tukar_hari_id_user_created_at_idx`(`id_user`, `created_at`),
    PRIMARY KEY (`id_izin_tukar_hari`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `izin_tukar_hari_pair` (
    `id_izin_tukar_hari_pair` CHAR(36) NOT NULL,
    `id_izin_tukar_hari` CHAR(36) NOT NULL,
    `hari_izin` DATE NOT NULL,
    `hari_pengganti` DATE NOT NULL,
    `catatan_pair` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `izin_tukar_hari_pair_id_izin_tukar_hari_hari_izin_idx`(`id_izin_tukar_hari`, `hari_izin`),
    INDEX `izin_tukar_hari_pair_id_izin_tukar_hari_hari_pengganti_idx`(`id_izin_tukar_hari`, `hari_pengganti`),
    UNIQUE INDEX `izin_tukar_hari_pair_id_izin_tukar_hari_hari_izin_hari_pengg_key`(`id_izin_tukar_hari`, `hari_izin`, `hari_pengganti`),
    PRIMARY KEY (`id_izin_tukar_hari_pair`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_izin_tukar_hari` (
    `id_approval_izin_tukar_hari` CHAR(36) NOT NULL,
    `id_izin_tukar_hari` CHAR(36) NOT NULL,
    `level` INTEGER NOT NULL,
    `approver_user_id` CHAR(36) NULL,
    `approver_role` ENUM('KARYAWAN', 'HR', 'OPERASIONAL', 'DIREKTUR', 'SUPERADMIN', 'SUBADMIN', 'SUPERVISI') NULL,
    `decision` ENUM('disetujui', 'ditolak', 'pending') NOT NULL DEFAULT 'pending',
    `decided_at` DATETIME(0) NULL,
    `note` LONGTEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `approval_izin_tukar_hari_id_izin_tukar_hari_level_idx`(`id_izin_tukar_hari`, `level`),
    INDEX `approval_izin_tukar_hari_approver_user_id_idx`(`approver_user_id`),
    PRIMARY KEY (`id_approval_izin_tukar_hari`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `handover_cuti` (
    `id_handover_cuti` CHAR(36) NOT NULL,
    `id_pengajuan_cuti` CHAR(36) NOT NULL,
    `id_user_tagged` CHAR(36) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `handover_cuti_id_pengajuan_cuti_idx`(`id_pengajuan_cuti`),
    INDEX `handover_cuti_id_user_tagged_idx`(`id_user_tagged`),
    UNIQUE INDEX `handover_cuti_id_pengajuan_cuti_id_user_tagged_key`(`id_pengajuan_cuti`, `id_user_tagged`),
    PRIMARY KEY (`id_handover_cuti`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `handover_izin_sakit` (
    `id_handover_sakit` CHAR(36) NOT NULL,
    `id_pengajuan_izin_sakit` CHAR(36) NOT NULL,
    `id_user_tagged` CHAR(36) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `handover_izin_sakit_id_pengajuan_izin_sakit_idx`(`id_pengajuan_izin_sakit`),
    INDEX `handover_izin_sakit_id_user_tagged_idx`(`id_user_tagged`),
    UNIQUE INDEX `handover_izin_sakit_id_pengajuan_izin_sakit_id_user_tagged_key`(`id_pengajuan_izin_sakit`, `id_user_tagged`),
    PRIMARY KEY (`id_handover_sakit`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `handover_izin_jam` (
    `id_handover_jam` CHAR(36) NOT NULL,
    `id_pengajuan_izin_jam` CHAR(36) NOT NULL,
    `id_user_tagged` CHAR(36) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `handover_izin_jam_id_pengajuan_izin_jam_idx`(`id_pengajuan_izin_jam`),
    INDEX `handover_izin_jam_id_user_tagged_idx`(`id_user_tagged`),
    UNIQUE INDEX `handover_izin_jam_id_pengajuan_izin_jam_id_user_tagged_key`(`id_pengajuan_izin_jam`, `id_user_tagged`),
    PRIMARY KEY (`id_handover_jam`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `handover_tukar_hari` (
    `id_handover_tukar_hari` CHAR(36) NOT NULL,
    `id_izin_tukar_hari` CHAR(36) NOT NULL,
    `id_user_tagged` CHAR(36) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `handover_tukar_hari_id_izin_tukar_hari_idx`(`id_izin_tukar_hari`),
    INDEX `handover_tukar_hari_id_user_tagged_idx`(`id_user_tagged`),
    UNIQUE INDEX `handover_tukar_hari_id_izin_tukar_hari_id_user_tagged_key`(`id_izin_tukar_hari`, `id_user_tagged`),
    PRIMARY KEY (`id_handover_tukar_hari`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `absensi` (
    `id_absensi` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `face_verified_masuk` BOOLEAN NOT NULL,
    `face_verified_pulang` BOOLEAN NOT NULL,
    `tanggal` DATE NULL,
    `id_lokasi_pulang` CHAR(36) NULL,
    `id_lokasi_datang` CHAR(36) NULL,
    `jam_masuk` DATETIME(0) NULL,
    `jam_pulang` DATETIME(0) NULL,
    `status_masuk` ENUM('tepat', 'terlambat') NULL,
    `status_pulang` ENUM('tepat', 'terlambat') NULL,
    `in_latitude` DECIMAL(10, 6) NULL,
    `in_longitude` DECIMAL(10, 6) NULL,
    `out_latitude` DECIMAL(10, 6) NULL,
    `out_longitude` DECIMAL(10, 6) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `Absensi_id_lokasi_datang_idx`(`id_lokasi_datang`),
    INDEX `Absensi_id_lokasi_pulang_idx`(`id_lokasi_pulang`),
    INDEX `Absensi_id_user_tanggal_idx`(`id_user`, `tanggal`),
    UNIQUE INDEX `Absensi_id_user_tanggal_key`(`id_user`, `tanggal`),
    PRIMARY KEY (`id_absensi`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `lembur` (
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

-- AddForeignKey
ALTER TABLE `broadcasts_recipients` ADD CONSTRAINT `broadcasts_recipients_id_broadcast_fkey` FOREIGN KEY (`id_broadcast`) REFERENCES `broadcasts`(`id_broadcasts`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broadcasts_recipients` ADD CONSTRAINT `broadcasts_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broadcast_attachments` ADD CONSTRAINT `broadcast_attachments_id_broadcast_fkey` FOREIGN KEY (`id_broadcast`) REFERENCES `broadcasts`(`id_broadcasts`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_kerja` ADD CONSTRAINT `shift_kerja_id_pola_kerja_fkey` FOREIGN KEY (`id_pola_kerja`) REFERENCES `pola_kerja`(`id_pola_kerja`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_kerja` ADD CONSTRAINT `shift_kerja_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `absensi`(`id_absensi`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_agenda_fkey` FOREIGN KEY (`id_agenda`) REFERENCES `agenda`(`id_agenda`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan` ADD CONSTRAINT `kunjungan_id_kategori_kunjungan_fkey` FOREIGN KEY (`id_kategori_kunjungan`) REFERENCES `kategori_kunjungan`(`id_kategori_kunjungan`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan` ADD CONSTRAINT `kunjungan_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan_report_recipients` ADD CONSTRAINT `kunjungan_report_recipients_id_kunjungan_fkey` FOREIGN KEY (`id_kunjungan`) REFERENCES `kunjungan`(`id_kunjungan`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kunjungan_report_recipients` ADD CONSTRAINT `kunjungan_report_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_jabatan_fkey` FOREIGN KEY (`id_jabatan`) REFERENCES `jabatan`(`id_jabatan`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_location_fkey` FOREIGN KEY (`id_location`) REFERENCES `location`(`id_location`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `departement` ADD CONSTRAINT `departement_id_supervisor_fkey` FOREIGN KEY (`id_supervisor`) REFERENCES `user`(`id_user`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jabatan` ADD CONSTRAINT `jabatan_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jabatan` ADD CONSTRAINT `jabatan_id_induk_jabatan_fkey` FOREIGN KEY (`id_induk_jabatan`) REFERENCES `jabatan`(`id_jabatan`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `istirahat` ADD CONSTRAINT `istirahat_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `istirahat` ADD CONSTRAINT `istirahat_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `face` ADD CONSTRAINT `face_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_planner` ADD CONSTRAINT `story_planner_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_planner` ADD CONSTRAINT `story_planner_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device` ADD CONSTRAINT `device_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absensi_report_recipients` ADD CONSTRAINT `absensi_report_recipients_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absensi_report_recipients` ADD CONSTRAINT `absensi_report_recipients_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catatan` ADD CONSTRAINT `catatan_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lembur_approval` ADD CONSTRAINT `lembur_approval_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lembur_approval` ADD CONSTRAINT `lembur_approval_id_lembur_fkey` FOREIGN KEY (`id_lembur`) REFERENCES `lembur`(`id_lembur`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_story_planer` ADD CONSTRAINT `shift_story_planer_id_jadwal_story_planner_fkey` FOREIGN KEY (`id_jadwal_story_planner`) REFERENCES `jadwal_story_planer`(`id_jadwal_story_planner`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shift_story_planer` ADD CONSTRAINT `shift_story_planer_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cuti_konfigurasi` ADD CONSTRAINT `cuti_konfigurasi_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_cuti` ADD CONSTRAINT `pengajuan_cuti_id_kategori_cuti_fkey` FOREIGN KEY (`id_kategori_cuti`) REFERENCES `kategori_cuti`(`id_kategori_cuti`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_cuti` ADD CONSTRAINT `pengajuan_cuti_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_cuti_tanggal` ADD CONSTRAINT `pengajuan_cuti_tanggal_id_pengajuan_cuti_fkey` FOREIGN KEY (`id_pengajuan_cuti`) REFERENCES `pengajuan_cuti`(`id_pengajuan_cuti`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pengajuan_cuti` ADD CONSTRAINT `approval_pengajuan_cuti_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pengajuan_cuti` ADD CONSTRAINT `approval_pengajuan_cuti_id_pengajuan_cuti_fkey` FOREIGN KEY (`id_pengajuan_cuti`) REFERENCES `pengajuan_cuti`(`id_pengajuan_cuti`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_sakit` ADD CONSTRAINT `pengajuan_izin_sakit_id_kategori_sakit_fkey` FOREIGN KEY (`id_kategori_sakit`) REFERENCES `kategori_sakit`(`id_kategori_sakit`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_sakit` ADD CONSTRAINT `pengajuan_izin_sakit_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_izin_sakit` ADD CONSTRAINT `approval_izin_sakit_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_izin_sakit` ADD CONSTRAINT `approval_izin_sakit_id_pengajuan_izin_sakit_fkey` FOREIGN KEY (`id_pengajuan_izin_sakit`) REFERENCES `pengajuan_izin_sakit`(`id_pengajuan_izin_sakit`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_jam` ADD CONSTRAINT `pengajuan_izin_jam_id_kategori_izin_jam_fkey` FOREIGN KEY (`id_kategori_izin_jam`) REFERENCES `kategori_izin_jam`(`id_kategori_izin_jam`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pengajuan_izin_jam` ADD CONSTRAINT `pengajuan_izin_jam_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pengajuan_izin_jam` ADD CONSTRAINT `approval_pengajuan_izin_jam_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_pengajuan_izin_jam` ADD CONSTRAINT `approval_pengajuan_izin_jam_id_pengajuan_izin_jam_fkey` FOREIGN KEY (`id_pengajuan_izin_jam`) REFERENCES `pengajuan_izin_jam`(`id_pengajuan_izin_jam`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `izin_tukar_hari` ADD CONSTRAINT `izin_tukar_hari_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `izin_tukar_hari_pair` ADD CONSTRAINT `izin_tukar_hari_pair_id_izin_tukar_hari_fkey` FOREIGN KEY (`id_izin_tukar_hari`) REFERENCES `izin_tukar_hari`(`id_izin_tukar_hari`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_izin_tukar_hari` ADD CONSTRAINT `approval_izin_tukar_hari_approver_user_id_fkey` FOREIGN KEY (`approver_user_id`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `approval_izin_tukar_hari` ADD CONSTRAINT `approval_izin_tukar_hari_id_izin_tukar_hari_fkey` FOREIGN KEY (`id_izin_tukar_hari`) REFERENCES `izin_tukar_hari`(`id_izin_tukar_hari`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_cuti` ADD CONSTRAINT `handover_cuti_id_pengajuan_cuti_fkey` FOREIGN KEY (`id_pengajuan_cuti`) REFERENCES `pengajuan_cuti`(`id_pengajuan_cuti`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_cuti` ADD CONSTRAINT `handover_cuti_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_izin_sakit` ADD CONSTRAINT `handover_izin_sakit_id_pengajuan_izin_sakit_fkey` FOREIGN KEY (`id_pengajuan_izin_sakit`) REFERENCES `pengajuan_izin_sakit`(`id_pengajuan_izin_sakit`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_izin_sakit` ADD CONSTRAINT `handover_izin_sakit_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_izin_jam` ADD CONSTRAINT `handover_izin_jam_id_pengajuan_izin_jam_fkey` FOREIGN KEY (`id_pengajuan_izin_jam`) REFERENCES `pengajuan_izin_jam`(`id_pengajuan_izin_jam`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_izin_jam` ADD CONSTRAINT `handover_izin_jam_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_tukar_hari` ADD CONSTRAINT `handover_tukar_hari_id_izin_tukar_hari_fkey` FOREIGN KEY (`id_izin_tukar_hari`) REFERENCES `izin_tukar_hari`(`id_izin_tukar_hari`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `handover_tukar_hari` ADD CONSTRAINT `handover_tukar_hari_id_user_tagged_fkey` FOREIGN KEY (`id_user_tagged`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absensi` ADD CONSTRAINT `Absensi_id_lokasi_datang_fkey` FOREIGN KEY (`id_lokasi_datang`) REFERENCES `location`(`id_location`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absensi` ADD CONSTRAINT `Absensi_id_lokasi_pulang_fkey` FOREIGN KEY (`id_lokasi_pulang`) REFERENCES `location`(`id_location`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `absensi` ADD CONSTRAINT `Absensi_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `lembur` ADD CONSTRAINT `Lembur_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE NO ACTION ON UPDATE CASCADE;

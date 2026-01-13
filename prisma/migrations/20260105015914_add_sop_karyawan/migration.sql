-- CreateTable
CREATE TABLE `sop_karyawan` (
    `id_sop_karyawan` CHAR(36) NOT NULL,
    `nama_dokumen` VARCHAR(255) NOT NULL,
    `tanggal_terbit` DATE NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `sop_karyawan_tanggal_terbit_idx`(`tanggal_terbit`),
    PRIMARY KEY (`id_sop_karyawan`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

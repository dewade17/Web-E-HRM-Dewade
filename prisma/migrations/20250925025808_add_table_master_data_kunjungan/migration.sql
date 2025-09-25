/*
  Warnings:

  - You are about to drop the column `lokasi` on the `kunjungan` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `kunjungan` DROP COLUMN `lokasi`,
    ADD COLUMN `id_master_data_kunjungan` CHAR(36) NULL,
    ADD COLUMN `latitude` DECIMAL(10, 6) NULL,
    ADD COLUMN `longitude` DECIMAL(10, 6) NULL;

-- CreateTable
CREATE TABLE `master_data_kunjungan` (
    `id_master_data_kunjungan` CHAR(36) NOT NULL,
    `kategori_kunjungan` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `master_data_kunjungan_kategori_kunjungan_key`(`kategori_kunjungan`),
    PRIMARY KEY (`id_master_data_kunjungan`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `kunjungan_id_master_data_kunjungan_idx` ON `kunjungan`(`id_master_data_kunjungan`);

-- AddForeignKey
ALTER TABLE `kunjungan` ADD CONSTRAINT `kunjungan_id_master_data_kunjungan_fkey` FOREIGN KEY (`id_master_data_kunjungan`) REFERENCES `master_data_kunjungan`(`id_master_data_kunjungan`) ON DELETE SET NULL ON UPDATE CASCADE;

/*
  Warnings:

  - You are about to drop the column `latitude` on the `kunjungan` table. All the data in the column will be lost.
  - You are about to drop the column `longitude` on the `kunjungan` table. All the data in the column will be lost.
  - You are about to drop the `kunjungan_handover` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `kunjungan_handover` DROP FOREIGN KEY `kunjungan_handover_id_kunjungan_fkey`;

-- DropForeignKey
ALTER TABLE `kunjungan_handover` DROP FOREIGN KEY `kunjungan_handover_id_user_fkey`;

-- AlterTable
ALTER TABLE `device` ADD COLUMN `failed_push_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `fcm_token` VARCHAR(1024) NULL,
    ADD COLUMN `fcm_token_updated_at` DATETIME(0) NULL,
    ADD COLUMN `last_push_at` DATETIME(0) NULL,
    ADD COLUMN `push_enabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `kunjungan` DROP COLUMN `latitude`,
    DROP COLUMN `longitude`,
    ADD COLUMN `end_latitude` DECIMAL(10, 6) NULL,
    ADD COLUMN `end_longitude` DECIMAL(10, 6) NULL,
    ADD COLUMN `start_latitude` DECIMAL(10, 6) NULL,
    ADD COLUMN `start_longitude` DECIMAL(10, 6) NULL;

-- DropTable
DROP TABLE `kunjungan_handover`;

-- CreateIndex
CREATE INDEX `device_device_identifier_idx` ON `device`(`device_identifier`);

-- CreateIndex
CREATE INDEX `device_fcm_token_idx` ON `device`(`fcm_token`(191));

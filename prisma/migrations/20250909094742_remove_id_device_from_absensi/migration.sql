/*
  Warnings:

  - You are about to drop the column `id_device` on the `absensi` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE `absensi` DROP FOREIGN KEY `Absensi_id_device_fkey`;

-- DropIndex
DROP INDEX `Absensi_id_device_idx` ON `absensi`;

-- AlterTable
ALTER TABLE `absensi` DROP COLUMN `id_device`;

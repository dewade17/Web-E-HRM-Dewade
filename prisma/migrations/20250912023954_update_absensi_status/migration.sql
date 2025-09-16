/*
  Warnings:

  - You are about to alter the column `status` on the `absensi` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(15))` to `Enum(EnumId(8))`.

*/
-- AlterTable
ALTER TABLE `absensi` MODIFY `status` ENUM('terkirim', 'diterima', 'ditolak') NOT NULL DEFAULT 'terkirim';

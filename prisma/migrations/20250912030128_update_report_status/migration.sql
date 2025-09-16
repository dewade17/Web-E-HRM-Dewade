/*
  Warnings:

  - You are about to alter the column `status` on the `absensi` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(15))` to `Enum(EnumId(8))`.
  - The values [dilihat,diproses] on the enum `absensi_report_recipients_status` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `absensi` MODIFY `status` ENUM('tepat', 'terlambat') NOT NULL;

-- AlterTable
ALTER TABLE `absensi_report_recipients` MODIFY `status` ENUM('terkirim', 'diterima', 'ditolak') NOT NULL DEFAULT 'terkirim';

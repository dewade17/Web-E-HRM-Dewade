/*
  Warnings:

  - Added the required column `recipient_nama_snapshot` to the `absensi_report_recipients` table without a default value. This is not possible if the table is not empty.
  - Added the required column `recipient_nama_snapshot` to the `kunjungan_report_recipients` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `absensi_report_recipients` ADD COLUMN `recipient_nama_snapshot` VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE `kunjungan_report_recipients` ADD COLUMN `recipient_nama_snapshot` VARCHAR(255) NOT NULL;

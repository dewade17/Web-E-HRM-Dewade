/*
  Warnings:

  - The values [KARYAWAN] on the enum `absensi_report_recipients_recipient_role_snapshot` will be removed. If these variants are still used in the database, this will fail.
  - The values [diterima] on the enum `absensi_report_recipients_status` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterTable
ALTER TABLE `absensi_report_recipients` MODIFY `recipient_role_snapshot` ENUM('HR', 'OPERASIONAL', 'DIREKTUR') NULL,
    MODIFY `status` ENUM('terkirim', 'disetujui', 'ditolak') NOT NULL DEFAULT 'terkirim';

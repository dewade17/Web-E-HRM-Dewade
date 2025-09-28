/*
  Warnings:

  - You are about to drop the column `lampiran_kunjunganurl` on the `kunjungan` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `kunjungan` DROP COLUMN `lampiran_kunjunganurl`,
    ADD COLUMN `lampiran_kunjungan_url` LONGTEXT NULL;

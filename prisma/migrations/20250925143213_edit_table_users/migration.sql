/*
  Warnings:

  - You are about to drop the column `tahun_lusus` on the `user` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `user` DROP COLUMN `tahun_lusus`,
    ADD COLUMN `tahun_lulus` INTEGER NULL;

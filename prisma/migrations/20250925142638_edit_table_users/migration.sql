/*
  Warnings:

  - You are about to drop the column `tahun_lulus` on the `user` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `user` DROP COLUMN `tahun_lulus`,
    ADD COLUMN `tahun_lusus` INTEGER NULL;

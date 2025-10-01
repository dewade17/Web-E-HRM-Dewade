/*
  Warnings:

  - A unique constraint covering the columns `[id_supervisor]` on the table `departement` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `departement` ADD COLUMN `id_supervisor` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `kontak_darurat` VARCHAR(32) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `departement_id_supervisor_key` ON `departement`(`id_supervisor`);

-- AddForeignKey
ALTER TABLE `departement` ADD CONSTRAINT `departement_id_supervisor_fkey` FOREIGN KEY (`id_supervisor`) REFERENCES `user`(`id_user`) ON DELETE SET NULL ON UPDATE CASCADE;

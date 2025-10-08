/*
  Warnings:

  - You are about to drop the `todo` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `id_absensi` to the `agenda_kerja` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `todo` DROP FOREIGN KEY `todo_id_absensi_fkey`;

-- DropForeignKey
ALTER TABLE `todo` DROP FOREIGN KEY `todo_id_user_fkey`;

-- AlterTable
ALTER TABLE `agenda_kerja` ADD COLUMN `id_absensi` CHAR(36) NOT NULL;

-- DropTable
DROP TABLE `todo`;

-- CreateIndex
CREATE INDEX `agenda_kerja_id_absensi_idx` ON `agenda_kerja`(`id_absensi`);

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `Absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

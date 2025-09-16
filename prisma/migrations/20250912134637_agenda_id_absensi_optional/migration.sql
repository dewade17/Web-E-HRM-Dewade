-- DropForeignKey
ALTER TABLE `agenda_kerja` DROP FOREIGN KEY `agenda_kerja_id_absensi_fkey`;

-- AlterTable
ALTER TABLE `agenda_kerja` MODIFY `id_absensi` CHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `Absensi`(`id_absensi`) ON DELETE SET NULL ON UPDATE CASCADE;

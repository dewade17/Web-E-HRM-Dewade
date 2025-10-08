-- DropForeignKey
ALTER TABLE `story_planner` DROP FOREIGN KEY `story_planner_id_departement_fkey`;

-- DropForeignKey
ALTER TABLE `user` DROP FOREIGN KEY `user_id_departement_fkey`;

-- AlterTable
ALTER TABLE `story_planner` MODIFY `id_departement` CHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `user` ADD CONSTRAINT `user_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_planner` ADD CONSTRAINT `story_planner_id_departement_fkey` FOREIGN KEY (`id_departement`) REFERENCES `departement`(`id_departement`) ON DELETE SET NULL ON UPDATE CASCADE;

/*
  Warnings:

  - The primary key for the `agenda_kerja` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `count_time` on the `agenda_kerja` table. All the data in the column will be lost.
  - You are about to drop the column `end_time` on the `agenda_kerja` table. All the data in the column will be lost.
  - You are about to drop the column `start_time` on the `agenda_kerja` table. All the data in the column will be lost.
  - You are about to drop the column `tanggal` on the `agenda_kerja` table. All the data in the column will be lost.
  - The values [berjalan,berhenti] on the enum `agenda_kerja_status` will be removed. If these variants are still used in the database, this will fail.
  - The required column `id_agenda_kerja` was added to the `agenda_kerja` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable
ALTER TABLE `agenda_kerja` DROP PRIMARY KEY,
    DROP COLUMN `count_time`,
    DROP COLUMN `end_time`,
    DROP COLUMN `start_time`,
    DROP COLUMN `tanggal`,
    ADD COLUMN `duration_seconds` INTEGER NULL,
    ADD COLUMN `end_date` DATETIME(0) NULL,
    ADD COLUMN `id_agenda_kerja` CHAR(36) NOT NULL,
    ADD COLUMN `start_date` DATETIME(0) NULL,
    MODIFY `status` ENUM('diproses', 'ditunda', 'selesai') NOT NULL,
    ADD PRIMARY KEY (`id_agenda_kerja`);

-- CreateTable
CREATE TABLE `agenda` (
    `id_agenda` CHAR(36) NOT NULL,
    `nama_agenda` LONGTEXT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    PRIMARY KEY (`id_agenda`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `agenda_kerja_id_user_start_date_idx` ON `agenda_kerja`(`id_user`, `start_date`);

-- CreateIndex
CREATE INDEX `agenda_kerja_id_agenda_idx` ON `agenda_kerja`(`id_agenda`);

-- AddForeignKey
ALTER TABLE `agenda_kerja` ADD CONSTRAINT `agenda_kerja_id_agenda_fkey` FOREIGN KEY (`id_agenda`) REFERENCES `agenda`(`id_agenda`) ON DELETE RESTRICT ON UPDATE CASCADE;

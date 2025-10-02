/*
  Warnings:

  - You are about to alter the column `kebutuhan_agenda` on the `agenda_kerja` table. The data in that column could be lost. The data in that column will be cast from `Enum(EnumId(19))` to `VarChar(255)`.

*/
-- AlterTable
ALTER TABLE `agenda_kerja` MODIFY `kebutuhan_agenda` VARCHAR(255) NULL;

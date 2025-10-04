/*
  Warnings:

  - You are about to drop the column `istirahat_latitude` on the `istirahat` table. All the data in the column will be lost.
  - You are about to drop the column `istirahat_longitude` on the `istirahat` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `istirahat` DROP COLUMN `istirahat_latitude`,
    DROP COLUMN `istirahat_longitude`,
    ADD COLUMN `end_istirahat_latitude` DECIMAL(10, 6) NULL,
    ADD COLUMN `end_istirahat_longitude` DECIMAL(10, 6) NULL,
    ADD COLUMN `start_istirahat_latitude` DECIMAL(10, 6) NULL,
    ADD COLUMN `start_istirahat_longitude` DECIMAL(10, 6) NULL;

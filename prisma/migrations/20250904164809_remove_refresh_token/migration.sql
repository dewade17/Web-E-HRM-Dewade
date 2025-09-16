/*
  Warnings:

  - You are about to drop the `refresh_token` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `refresh_token` DROP FOREIGN KEY `refresh_token_id_user_fkey`;

-- DropTable
DROP TABLE `refresh_token`;

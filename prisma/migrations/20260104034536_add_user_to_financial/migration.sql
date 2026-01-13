/*
  Warnings:

  - Added the required column `id_user` to the `payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `id_user` to the `pocket_money` table without a default value. This is not possible if the table is not empty.
  - Added the required column `id_user` to the `reimburse` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `payment` ADD COLUMN `id_user` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `pocket_money` ADD COLUMN `id_user` CHAR(36) NOT NULL;

-- AlterTable
ALTER TABLE `reimburse` ADD COLUMN `id_user` CHAR(36) NOT NULL;

-- CreateIndex
CREATE INDEX `payment_id_user_tanggal_idx` ON `payment`(`id_user`, `tanggal`);

-- CreateIndex
CREATE INDEX `pocket_money_id_user_tanggal_idx` ON `pocket_money`(`id_user`, `tanggal`);

-- CreateIndex
CREATE INDEX `reimburse_id_user_tanggal_idx` ON `reimburse`(`id_user`, `tanggal`);

-- AddForeignKey
ALTER TABLE `reimburse` ADD CONSTRAINT `reimburse_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pocket_money` ADD CONSTRAINT `pocket_money_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

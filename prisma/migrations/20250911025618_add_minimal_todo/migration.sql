-- CreateTable
CREATE TABLE `todo` (
    `id_todo` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `id_absensi` CHAR(36) NOT NULL,
    `description` LONGTEXT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `todo_id_user_idx`(`id_user`),
    INDEX `todo_id_absensi_idx`(`id_absensi`),
    PRIMARY KEY (`id_todo`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `todo` ADD CONSTRAINT `todo_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `todo` ADD CONSTRAINT `todo_id_absensi_fkey` FOREIGN KEY (`id_absensi`) REFERENCES `Absensi`(`id_absensi`) ON DELETE CASCADE ON UPDATE CASCADE;

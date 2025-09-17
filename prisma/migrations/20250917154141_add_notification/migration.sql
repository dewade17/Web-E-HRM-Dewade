-- CreateTable
CREATE TABLE `notifications` (
    `id_notification` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `data_json` LONGTEXT NULL,
    `related_table` VARCHAR(64) NULL,
    `related_id` CHAR(36) NULL,
    `status` ENUM('unread', 'read', 'archived') NOT NULL DEFAULT 'unread',
    `seen_at` DATETIME(0) NULL,
    `read_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `notifications_id_user_status_created_at_idx`(`id_user`, `status`, `created_at`),
    INDEX `notifications_related_table_related_id_idx`(`related_table`, `related_id`),
    PRIMARY KEY (`id_notification`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

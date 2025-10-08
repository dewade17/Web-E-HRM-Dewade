-- AlterTable
ALTER TABLE `user` MODIFY `id_departement` CHAR(36) NULL,
    MODIFY `id_location` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `refresh_token` (
    `id_refresh_token` CHAR(36) NOT NULL,
    `id_user` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(0) NOT NULL,
    `revoked_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `ip_address` VARCHAR(64) NULL,

    UNIQUE INDEX `refresh_token_token_hash_key`(`token_hash`),
    INDEX `refresh_token_id_user_session_id_idx`(`id_user`, `session_id`),
    INDEX `refresh_token_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id_refresh_token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `refresh_token` ADD CONSTRAINT `refresh_token_id_user_fkey` FOREIGN KEY (`id_user`) REFERENCES `user`(`id_user`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `notification_templates` (
    `id` VARCHAR(191) NOT NULL,
    `eventTrigger` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `title_template` VARCHAR(191) NOT NULL,
    `body_template` TEXT NOT NULL,
    `placeholders` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `notification_templates_eventTrigger_key`(`eventTrigger`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

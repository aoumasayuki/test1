-- CreateTable
CREATE TABLE `AnomalyLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `timestamp` DATETIME(3) NOT NULL,
    `heartRate` DOUBLE NOT NULL,
    `reason` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

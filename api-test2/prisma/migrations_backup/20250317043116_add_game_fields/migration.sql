-- CreateTable
CREATE TABLE `CsvData` (
    `id` INTEGER NOT NULL,
    `Heart_Rate` INTEGER NOT NULL,
    `Timestamp` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`, `Timestamp`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StateTimestamps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stateName` VARCHAR(191) NOT NULL,
    `startTime` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

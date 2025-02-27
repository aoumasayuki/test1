-- CreateTable
CREATE TABLE `CsvData` (
    `id` INTEGER NOT NULL,
    `Heart_Rate` INTEGER NOT NULL,
    `Timestamp` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`, `Timestamp`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

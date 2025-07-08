-- CreateTable
CREATE TABLE `Participant` (
    `sessionId` INTEGER NOT NULL,
    `sensorId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Participant_sensorId_idx`(`sensorId`),
    PRIMARY KEY (`sessionId`, `sensorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

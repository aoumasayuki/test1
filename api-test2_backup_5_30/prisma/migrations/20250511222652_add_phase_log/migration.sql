/*
  Warnings:

  - You are about to drop the column `date` on the `PhaseLog` table. All the data in the column will be lost.
  - You are about to drop the column `phase` on the `PhaseLog` table. All the data in the column will be lost.
  - Added the required column `gameDate` to the `PhaseLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `gamePhase` to the `PhaseLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `PhaseLog` DROP COLUMN `date`,
    DROP COLUMN `phase`,
    ADD COLUMN `gameDate` VARCHAR(191) NOT NULL,
    ADD COLUMN `gamePhase` VARCHAR(191) NOT NULL;

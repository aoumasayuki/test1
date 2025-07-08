/*
  Warnings:

  - Added the required column `game` to the `PhaseLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `PhaseLog` ADD COLUMN `game` VARCHAR(191) NOT NULL;

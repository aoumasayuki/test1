/*
  Warnings:

  - Added the required column `Game_date` to the `CsvData` table without a default value. This is not possible if the table is not empty.
  - Added the required column `Game_detail` to the `CsvData` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `CsvData` ADD COLUMN `Game_date` VARCHAR(191) NOT NULL,
    ADD COLUMN `Game_detail` VARCHAR(191) NOT NULL;

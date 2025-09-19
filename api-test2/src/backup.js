import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// __dirname の代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dotenv 読み込み
dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function backup() {
  try {
    const backupData = await prisma.csvData.findMany({
      // 必要に応じて where 条件を追加
    });

    if (backupData.length === 0) {
      console.log("バックアップ対象データは見つかりませんでした。");
      return;
    }

    const backupDir = path.join(__dirname, 'backup');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }

    const filePath = path.join(backupDir, `backup-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));

    console.log(`バックアップ完了: ${filePath}`);
  } catch (error) {
    console.error("バックアップ中にエラー:", error.message, error.stack, error);
  } finally {
    await prisma.$disconnect();
  }
}

backup();

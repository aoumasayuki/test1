import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function updateDate() {
  try {
    const records = await prisma.csvData.findMany({
      where: {
        Timestamp: {
          gte: new Date('2025-05-16T00:00:00Z'),
          lt: new Date('2025-05-17T00:00:00Z'),
        },
      },
    });

    console.log(`対象件数: ${records.length}`);

    for (const record of records) {
      const oldDate = new Date(record.Timestamp);
      const newDate = new Date(oldDate);
      newDate.setUTCDate(19); // 日付を19に変更

      await prisma.csvData.update({
        where: {
          id_Timestamp: {
            id: record.id,
            Timestamp: record.Timestamp, // 元の値
          },
        },
        data: { Timestamp: newDate },
      });

      console.log(`ID ${record.id} の Timestamp を更新: ${oldDate.toISOString()} → ${newDate.toISOString()}`);
    }

    console.log('日付更新完了！');
  } catch (error) {
    console.error('エラー:', error.message, error.stack, error);
  } finally {
    await prisma.$disconnect();
  }
}

updateDate();

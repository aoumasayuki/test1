import { PrismaClient } from '@prisma/client';
import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs';

const prisma = new PrismaClient();

async function exportToCSV() {
  const data = await prisma.csvData.findMany();  // すべて取得

  const csvWriter = createObjectCsvWriter({
    path: 'output.csv',
    header: [
      { id: 'id', title: 'ID' },
      { id: 'userId', title: 'UserID' },
      { id: 'bpm', title: 'BPM' },
      { id: 'Timestamp', title: 'Timestamp' }
    ]
  });

  await csvWriter.writeRecords(data);  // CSVファイルとして出力
  console.log('✅ CSVファイルを書き出しました: output.csv');
}

exportToCSV()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());

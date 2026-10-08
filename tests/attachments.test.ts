import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { zipSync, strToU8 } from 'fflate';
import { join } from 'node:path';
import { extract } from '../src/extraction.js';
import { AttachmentReader, extractInWorker, safeFilename } from '../src/attachments.js';
import { MAX_ATTACHMENT } from '../src/types.js';
import { temporaryStore } from './fixtures.js';

test('text, PDF, DOCX and Excel attachments are readable', async () => {
  assert.equal((await extract({ data: Buffer.from('你好，附件'), filename: 'text.txt', contentType: 'text/plain' })).text, '你好，附件');
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Hello PDF attachment', { x: 50, y: 700, font });
  const pdfResult = await extract({ data: await pdf.save(), filename: 'a.pdf', contentType: 'application/pdf' });
  assert.match(pdfResult.text, /Hello PDF attachment/);
  assert.match((await extractInWorker({ data: await pdf.save(), filename: 'a.pdf', contentType: 'application/pdf' }, join(process.cwd(), 'dist', 'extract-worker.cjs'))).text, /Hello PDF attachment/);
  const docx = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文 Word 附件</w:t></w:r></w:p></w:body></w:document>'),
  });
  assert.match((await extract({ data: docx, filename: 'a.docx', contentType: 'application/octet-stream' })).text, /中文 Word 附件/);
  assert.match((await extractInWorker({ data: docx, filename: 'a.docx', contentType: 'application/octet-stream' }, join(process.cwd(), 'dist', 'extract-worker.cjs'))).text, /中文 Word 附件/);
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('成绩').addRows([['姓名', '成绩'], ['小明', 95]]);
  workbook.addWorksheet('说明').addRow(['第二张表']);
  const excel = await extract({ data: new Uint8Array(await workbook.xlsx.writeBuffer()), filename: 'a.xlsx', contentType: 'application/octet-stream' });
  assert.match(excel.text, /工作表：成绩/); assert.match(excel.text, /小明\t95/); assert.match(excel.text, /第二张表/);
  assert.match((await extractInWorker({ data: new Uint8Array(await workbook.xlsx.writeBuffer()), filename: 'a.xlsx', contentType: 'application/octet-stream' }, join(process.cwd(), 'dist', 'extract-worker.cjs'))).text, /小明\t95/);
  const worker = await extractInWorker({ data: Buffer.from('bundled worker'), filename: 'a.txt', contentType: 'text/plain' }, join(process.cwd(), 'dist', 'extract-worker.cjs'));
  assert.equal(worker.text, 'bundled worker');
});

test('attachment paths are contained, filenames are unique, oversized data is rejected', async () => {
  const store = await temporaryStore();
  const mail: any = { attachment: async () => ({ data: Buffer.from('内容'.repeat(100)), filename: '../../CON.txt', contentType: 'text/plain' }) };
  const reader = new AttachmentReader(mail, store.directory, join(process.cwd(), 'dist', 'extract-worker.cjs'));
  const first = await reader.read('test', '1', 0, 10);
  const second = await reader.read('test', '1', 10, 10);
  assert.ok(first.localPath.startsWith(join(store.directory, 'attachments')));
  assert.notEqual(first.localPath, second.localPath);
  assert.equal(safeFilename('../../CON.txt'), 'attachment-CON.txt');
  assert.equal(safeFilename('C:\\secret\\evil.txt'), 'evil.txt');
  assert.equal((first as any).text.nextOffset, 10);
  mail.attachment = async () => ({ data: Buffer.alloc(MAX_ATTACHMENT + 1), filename: 'huge.txt', contentType: 'text/plain' });
  await assert.rejects(reader.read('test', '1'), /25 MB/);
});

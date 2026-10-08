import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { MailService } from './mail.js';
import { MAX_ATTACHMENT, pageText } from './types.js';
import type { ExtractInput, ExtractResult } from './extraction.js';

export function safeFilename(name: string) {
  let filename = basename(name.replace(/\\/g, '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 150);
  if (!filename || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(filename)) filename = `attachment-${filename || 'file'}`;
  return filename;
}

export function extractInWorker(input: ExtractInput, workerPath: string): Promise<ExtractResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: input, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 } });
    worker.stdout?.resume();
    worker.stderr?.resume();
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('附件解析超过 30 秒，原文件已保留。')); }, 30000);
    worker.once('message', message => {
      clearTimeout(timer);
      void worker.terminate();
      if (message.ok) resolve(message.result); else reject(new Error(message.message));
    });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('附件解析失败或超过内存上限，原文件已保留。')); });
    worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error('附件解析已停止，原文件已保留。')); } });
  });
}

export class AttachmentReader {
  constructor(private mail: MailService, private directory: string, private workerPath: string) {}
  async read(reference: string, attachmentId: string, offset = 0, limit = 16000) {
    const attachment = await this.mail.attachment(reference, attachmentId);
    if (attachment.data.length > MAX_ATTACHMENT) throw new Error('附件超过 25 MB 上限。');
    const directory = join(this.directory, 'attachments', randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, safeFilename(attachment.filename));
    await writeFile(file, attachment.data, { mode: 0o600, flag: 'wx' });
    const metadata = { filename: attachment.filename, contentType: attachment.contentType, size: attachment.data.length, localPath: file };
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(attachment.contentType)) {
      if (attachment.data.length > 10 * 1024 * 1024) return { ...metadata, format: 'image', warnings: ['图片超过 10 MB，已保留原文件，请使用本地图片查看工具。'] };
      return { ...metadata, format: 'image', image: { type: 'image' as const, mimeType: attachment.contentType, data: attachment.data.toString('base64') }, warnings: [] };
    }
    try {
      const result = await extractInWorker({ ...attachment }, this.workerPath);
      return { ...metadata, ...result, text: pageText(result.text, offset, limit) };
    } catch (e) { return { ...metadata, format: 'unreadable', warnings: [(e as Error).message] }; }
  }
}

import { parentPort, workerData } from 'node:worker_threads';
import { extract } from './extraction.js';

extract(workerData).then(result => parentPort!.postMessage({ ok: true, result })).catch(() => {
  parentPort!.postMessage({ ok: false, message: '附件内容解析失败，可能是文件损坏、加密、页数过多或不受支持的格式。原文件已保留。' });
});

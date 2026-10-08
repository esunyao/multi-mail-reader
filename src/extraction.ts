import { extname } from 'node:path';
import iconv from 'iconv-lite';
import { convert } from 'html-to-text';

export interface ExtractInput { data: Uint8Array; filename: string; contentType: string; charset?: string }
export interface ExtractResult { text: string; format: string; warnings: string[]; extractionTruncated?: boolean }
const MAX_CHARACTERS = 2_000_000;

export async function extract(input: ExtractInput): Promise<ExtractResult> {
  const data = Buffer.from(input.data);
  const extension = extname(input.filename).toLowerCase();
  const warnings: string[] = [];
  let text = '';
  let format = extension.slice(1) || input.contentType;
  if (extension === '.pdf' || input.contentType === 'application/pdf') {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(data), { maxImageSize: 16_777_216 });
    try {
      if (pdf.numPages > 500) throw new Error('PDF 超过 500 页上限。');
      const result = await extractText(pdf, { mergePages: false });
      text = result.text.map((page, i) => `[第 ${i + 1} 页]\n${page}`).join('\n\n');
      if (!result.text.some(page => page.trim())) warnings.push('未提取到文字，可能是扫描件；本版不内置 OCR。');
    } finally { await pdf.loadingTask.destroy(); }
    format = 'pdf';
  } else if (extension === '.docx' || input.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: data });
    text = result.value;
    if (result.messages.length) warnings.push('部分 Word 内容无法转换为纯文本。');
    format = 'docx';
  } else if (extension === '.xlsx' || input.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data as any);
    const blocks: string[] = [];
    let length = 0;
    workbook.eachSheet(sheet => {
      if (length > MAX_CHARACTERS) return;
      blocks.push(`[工作表：${sheet.name}]`);
      sheet.eachRow((row, number) => {
        if (length > MAX_CHARACTERS) return;
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, cell => { cells.push(cell.text.replace(/[\r\n\t]+/g, ' ')); });
        const line = `${number}\t${cells.join('\t')}`;
        blocks.push(line);
        length += line.length;
      });
    });
    text = blocks.join('\n');
    if (length > MAX_CHARACTERS) warnings.push('工作簿文字超过 200 万字符，后续行未提取。');
    format = 'xlsx';
  } else if (input.contentType.startsWith('text/') || ['.txt', '.md', '.csv', '.tsv', '.json', '.xml', '.html', '.htm', '.log', '.ics'].includes(extension)) {
    const charset = input.charset && iconv.encodingExists(input.charset) ? input.charset : 'utf-8';
    text = iconv.decode(data, charset);
    if (extension === '.html' || extension === '.htm' || input.contentType === 'text/html') text = convert(text, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }] });
    format = 'text';
  } else {
    return { text: '', format: 'unsupported', warnings: ['此附件格式暂不支持内容提取。已保留原文件，可按需使用其他工具读取。'] };
  }
  const extractionTruncated = text.length > MAX_CHARACTERS || warnings.some(w => w.includes('200 万'));
  if (text.length > MAX_CHARACTERS) warnings.push('附件文字超过 200 万字符，只提取前 200 万字符。');
  return { text: text.slice(0, MAX_CHARACTERS), format, warnings, extractionTruncated };
}

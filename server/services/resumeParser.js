import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export const MAX_RESUME_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Common browser variants for docx
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx']);

export class ResumeParseError extends Error {
  constructor(message, code = 'PARSE_ERROR', status = 400) {
    super(message);
    this.name = 'ResumeParseError';
    this.code = code;
    this.status = status;
  }
}

export function validateResumeFile(file) {
  if (!file || !file.buffer) {
    throw new ResumeParseError('No resume file provided.', 'NO_FILE', 400);
  }

  if (file.size > MAX_RESUME_SIZE_BYTES) {
    throw new ResumeParseError('File size exceeds the 5 MB limit.', 'FILE_TOO_LARGE', 400);
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ResumeParseError(
      `Unsupported file type (${ext || 'unknown'}). Please upload a PDF or DOCX file.`,
      'INVALID_FILE_TYPE',
      400
    );
  }

  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new ResumeParseError(
      'Invalid document format. Only PDF and DOCX files are supported.',
      'INVALID_MIME_TYPE',
      400
    );
  }

  // The name and MIME type are chosen by the client, so check the actual bytes too:
  // PDFs start with "%PDF", DOCX files are ZIP archives starting with "PK".
  const signature = file.buffer.subarray(0, 4).toString('latin1');
  const looksRight = ext === '.pdf' ? signature.startsWith('%PDF') : signature.startsWith('PK');
  if (!looksRight) {
    throw new ResumeParseError(
      `This file isn't a valid ${ext === '.pdf' ? 'PDF' : 'DOCX'} document. Please export your resume again and retry.`,
      'CONTENT_MISMATCH',
      400
    );
  }

  return { ext, size: file.size, name: file.originalname };
}

export async function parseResumeBuffer(buffer, ext) {
  let rawText = '';

  if (ext === '.pdf') {
    let parser = null;
    try {
      parser = new PDFParse({ data: buffer });
      await parser.load();
      const result = await parser.getText();
      rawText = typeof result === 'string' ? result : result?.text || '';
    } catch (err) {
      if (/password|encrypted/i.test(err.message)) {
        throw new ResumeParseError(
          'The PDF is password protected. Please upload an unprotected copy.',
          'PASSWORD_PROTECTED',
          400
        );
      }
      throw new ResumeParseError(
        'Could not read the PDF file. It may be corrupted or malformed.',
        'MALFORMED_PDF',
        400
      );
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } else if (ext === '.docx') {
    try {
      const result = await mammoth.extractRawText({ buffer });
      rawText = result.value || '';
    } catch {
      throw new ResumeParseError(
        'Could not read the DOCX file. It may be corrupted or malformed.',
        'MALFORMED_DOCX',
        400
      );
    }
  } else {
    throw new ResumeParseError('Unsupported document format.', 'UNSUPPORTED_FORMAT', 400);
  }

  // Clean and normalize text
  const cleaned = rawText
    .replace(/\0/g, '') // remove null bytes
    .replace(/\r\n|\r/g, '\n') // normalize newlines
    .replace(/[ \t]+/g, ' ') // collapse horizontal spaces
    .replace(/\n{3,}/g, '\n\n') // collapse multiple blank lines
    .trim();

  // Scanned or image-only PDFs have almost no text characters
  const visibleChars = cleaned.replace(/\s+/g, '');
  if (visibleChars.length < 60) {
    throw new ResumeParseError(
      'We could not find readable text in this document. It appears to be scanned or image-only. Please upload a text-based document or build your profile manually.',
      'SCANNED_OR_EMPTY',
      422
    );
  }

  return cleaned;
}

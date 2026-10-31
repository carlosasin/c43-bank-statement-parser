import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { C43AccountExport, C43ParseResult } from './types.js';
import { C43Parser as CoreC43Parser, C43ParserOptions, parseC43 } from './parser.js';

export { C43ParserOptions, parseC43 } from './parser.js';
export * from './types.js';

export function parseC43FileSync(filePath: string, options: C43ParserOptions = {}): C43ParseResult {
  try {
    return parseC43(readFileSync(filePath, 'utf8'), options);
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'FILE_READ_ERROR',
        message: error instanceof Error ? error.message : 'Unable to read C43 file',
      },
    };
  }
}

export async function parseC43File(filePath: string, options: C43ParserOptions = {}): Promise<C43ParseResult> {
  try {
    return parseC43(await readFile(filePath, 'utf8'), options);
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'FILE_READ_ERROR',
        message: error instanceof Error ? error.message : 'Unable to read C43 file',
      },
    };
  }
}

/** Node.js compatibility wrapper with synchronous file access. */
export class C43Parser extends CoreC43Parser {
  public constructor(private readonly nodeOptions: C43ParserOptions = {}) {
    super(nodeOptions);
  }

  public parseFile(filePath: string): C43AccountExport | undefined {
    const result = parseC43FileSync(filePath, this.nodeOptions);
    return result.success ? result.data : undefined;
  }
}

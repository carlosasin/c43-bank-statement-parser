export interface C43AccountExport {
  clientName: string;
  clientCode: string;
  entity: string;
  account: string;
  initialBalance: number;
  finalBalance: number;
  currency: string;
  status: 'OK' | 'ERROR';
  message: string;
  movements: C43MovementExport[];
}

export interface C43MovementExport {
  identifier: string;
  operationDate: string;
  commonConcept: string;
  extraConcept: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
}

export type C43ParseErrorCode =
  | 'EMPTY_INPUT'
  | 'FILE_READ_ERROR'
  | 'INVALID_FIELD'
  | 'INVALID_INPUT'
  | 'INVALID_RECORD_LENGTH'
  | 'INCONSISTENT_TOTAL'
  | 'MISSING_RECORD'
  | 'UNEXPECTED_RECORD';

export interface C43ParseError {
  code: C43ParseErrorCode;
  message: string;
  lineNumber?: number;
  recordCode?: string;
  field?: string;
}

export type C43ParseResult =
  | { success: true; data: C43AccountExport }
  | { success: false; error: C43ParseError };

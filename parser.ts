import {
  C43AccountExport,
  C43MovementExport,
  C43ParseError,
  C43ParseErrorCode,
  C43ParseResult,
} from './types.js';

const RECORD_LENGTH = 80;

interface ParserState {
  clientName: string;
  clientCode: string;
  entity: string;
  account: string;
  initialBalance: number;
  finalBalance: number;
  currency: string;
  movements: C43MovementExport[];
  debitCount: number;
  creditCount: number;
  totalDebitCents: number;
  totalCreditCents: number;
  recordCount: number;
  runningBalanceCents: number;
}

export interface C43ParserOptions {
  /** Years below this two-digit value are interpreted as 20xx; the rest as 19xx. */
  twoDigitYearPivot?: number;
}

class C43ParsingException extends Error {
  public constructor(
    public readonly code: C43ParseErrorCode,
    message: string,
    public readonly lineNumber?: number,
    public readonly recordCode?: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'C43ParsingException';
  }
}

function emptyState(): ParserState {
  return {
    clientName: '',
    clientCode: '',
    entity: '',
    account: '',
    initialBalance: 0,
    finalBalance: 0,
    currency: '',
    movements: [],
    debitCount: 0,
    creditCount: 0,
    totalDebitCents: 0,
    totalCreditCents: 0,
    recordCount: 0,
    runningBalanceCents: 0,
  };
}

function toExport(state: ParserState, status: 'OK' | 'ERROR', message: string): C43AccountExport {
  return {
    clientName: state.clientName,
    clientCode: state.clientCode,
    entity: state.entity,
    account: state.account,
    initialBalance: state.initialBalance,
    finalBalance: state.finalBalance,
    currency: state.currency,
    status,
    message,
    movements: state.movements,
  };
}

function normalizeRows(data: string | readonly string[]): string[] {
  const rows = typeof data === 'string' ? data.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/) : [...data];

  while (rows.length > 0 && rows[rows.length - 1] === '') {
    rows.pop();
  }

  return rows.map((row, index) => {
    if (typeof row !== 'string') {
      throw new C43ParsingException('INVALID_INPUT', `Record ${index + 1} is not a string`, index + 1);
    }
    const normalized = row.replace(/\r$/, '');
    return index === 0 ? normalized.replace(/^\uFEFF/, '') : normalized;
  });
}

function fail(
  code: C43ParseErrorCode,
  message: string,
  lineNumber: number,
  recordCode?: string,
  field?: string,
): never {
  throw new C43ParsingException(code, message, lineNumber, recordCode, field);
}

function readRecord(rows: string[], position: number, expectedCode: string, label: string): string {
  const row = rows[position];
  if (row === undefined) {
    fail('MISSING_RECORD', `Missing ${label} record`, position + 1, expectedCode);
  }
  const actualCode = row.substring(0, 2);
  if (actualCode !== expectedCode) {
    fail(
      'UNEXPECTED_RECORD',
      `${label} code is incorrect`,
      position + 1,
      actualCode,
    );
  }
  if (row.length !== RECORD_LENGTH) {
    fail(
      'INVALID_RECORD_LENGTH',
      `Record ${expectedCode} must contain exactly ${RECORD_LENGTH} characters; received ${row.length}`,
      position + 1,
      expectedCode,
    );
  }
  return row;
}

function readDigits(
  row: string,
  start: number,
  length: number,
  field: string,
  lineNumber: number,
  recordCode: string,
): number {
  const value = row.substring(start, start + length);
  if (!new RegExp(`^\\d{${length}}$`).test(value)) {
    fail('INVALID_FIELD', `${field} must contain exactly ${length} digits`, lineNumber, recordCode, field);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail('INVALID_FIELD', `${field} exceeds the supported numeric range`, lineNumber, recordCode, field);
  }
  return parsed;
}

function signedAmount(cents: number, signCode: string, lineNumber: number, field: string, recordCode: string): number {
  if (signCode !== '1' && signCode !== '2') {
    fail('INVALID_FIELD', `${field} sign code is incorrect`, lineNumber, recordCode, field);
  }
  return signCode === '1' ? -cents : cents;
}

function toDate(value: string, pivot: number, lineNumber: number): string {
  if (!/^\d{6}$/.test(value)) {
    fail('INVALID_FIELD', 'Operation date must contain six digits (YYMMDD)', lineNumber, '22', 'operationDate');
  }

  const year = Number(value.substring(0, 2));
  const month = Number(value.substring(2, 4));
  const day = Number(value.substring(4, 6));
  const fullYear = year < pivot ? 2000 + year : 1900 + year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail('INVALID_FIELD', 'Operation date is not a valid calendar date', lineNumber, '22', 'operationDate');
  }
  return `${fullYear}${value.substring(2)}`;
}

function parseRows(rows: string[], options: C43ParserOptions): C43AccountExport {
  const state = emptyState();
  if (rows.length === 0 || rows.every((row) => row.trim().length === 0)) {
    throw new C43ParsingException('EMPTY_INPUT', 'No data available');
  }
  if (rows.some((row) => row.length === 0)) {
    const lineNumber = rows.findIndex((row) => row.length === 0) + 1;
    fail('INVALID_RECORD_LENGTH', 'Blank records are not allowed', lineNumber);
  }

  const pivot = options.twoDigitYearPivot ?? 50;
  if (!Number.isInteger(pivot) || pivot < 0 || pivot > 100) {
    throw new C43ParsingException('INVALID_INPUT', 'twoDigitYearPivot must be an integer from 0 to 100');
  }

  let position = 0;
  const header = readRecord(rows, position++, '11', 'Account header');
  state.entity = header.substring(2, 6);
  state.account = header.substring(10, 20).trim();
  const initialBalanceCents = readDigits(header, 33, 14, 'initialBalance', position, '11');
  state.initialBalance = signedAmount(
    initialBalanceCents,
    header.substring(32, 33),
    position,
    'initialBalance',
    '11',
  ) / 100;
  state.runningBalanceCents = signedAmount(
    initialBalanceCents,
    header.substring(32, 33),
    position,
    'initialBalance',
    '11',
  );
  const currencyCode = header.substring(47, 50);
  if (!/^\d{3}$/.test(currencyCode)) {
    fail('INVALID_FIELD', 'Currency code must contain three digits', position, '11', 'currency');
  }
  state.currency = currencyCode === '978' ? 'EUR' : currencyCode;
  const modalityCode = header.substring(50, 51);
  if (modalityCode !== '3' && modalityCode !== '1') {
    fail('INVALID_FIELD', 'Modality code is incorrect', position, '11', 'modality');
  }
  state.clientName = header.substring(51, 77).trim();
  state.clientCode = header.substring(77, 80).trim();
  state.recordCount += 1;

  while (rows[position]?.substring(0, 2) === '22') {
    const lineNumber = position + 1;
    const row = readRecord(rows, position++, '22', 'Movement');
    const movementCode = row.substring(27, 28);
    if (movementCode !== '1' && movementCode !== '2') {
      fail('INVALID_FIELD', 'Debit/credit code is incorrect', lineNumber, '22', 'movementType');
    }

    const amountCents = readDigits(row, 28, 14, 'amount', lineNumber, '22');
    const amount = amountCents / 100;
    const movement: C43MovementExport = {
      identifier: row.substring(2, 6).trim(),
      operationDate: toDate(row.substring(10, 16), pivot, lineNumber),
      commonConcept: row.substring(22, 24),
      extraConcept: '',
      amount: movementCode === '1' ? -amount : amount,
      balanceBefore: state.runningBalanceCents / 100,
      balanceAfter: 0,
    };

    if (movementCode === '1') {
      state.debitCount += 1;
      state.totalDebitCents += amountCents;
      state.runningBalanceCents -= amountCents;
    } else {
      state.creditCount += 1;
      state.totalCreditCents += amountCents;
      state.runningBalanceCents += amountCents;
    }
    if (
      !Number.isSafeInteger(state.runningBalanceCents) ||
      !Number.isSafeInteger(state.totalDebitCents) ||
      !Number.isSafeInteger(state.totalCreditCents)
    ) {
      fail('INVALID_FIELD', 'Running balance exceeds the supported numeric range', lineNumber, '22', 'amount');
    }
    movement.balanceAfter = state.runningBalanceCents / 100;

    const extraConcepts: string[] = [];
    let conceptIndex = 1;
    while (rows[position]?.substring(0, 2) === '23') {
      const conceptLine = position + 1;
      const concept = readRecord(rows, position++, '23', 'Complementary concept');
      const conceptCode = concept.substring(2, 4);
      if (conceptCode !== String(conceptIndex).padStart(2, '0')) {
        fail(
          'INVALID_FIELD',
          `Complementary concept code is incorrect: ${conceptCode}`,
          conceptLine,
          '23',
          'conceptCode',
        );
      }
      extraConcepts.push(concept.substring(4).trim());
      conceptIndex += 1;
      state.recordCount += 1;
    }

    movement.extraConcept = extraConcepts.join(' | ');
    state.movements.push(movement);
    state.recordCount += 1;
  }

  const footerLine = position + 1;
  const footer = readRecord(rows, position++, '33', 'Account footer');
  const debitCount = readDigits(footer, 20, 5, 'debitCount', footerLine, '33');
  const debitTotalCents = readDigits(footer, 25, 14, 'debitTotal', footerLine, '33');
  const creditCount = readDigits(footer, 39, 5, 'creditCount', footerLine, '33');
  const creditTotalCents = readDigits(footer, 44, 14, 'creditTotal', footerLine, '33');
  if (debitCount !== state.debitCount) {
    fail('INCONSISTENT_TOTAL', 'Debit count does not match the movements', footerLine, '33', 'debitCount');
  }
  if (debitTotalCents !== state.totalDebitCents) {
    fail('INCONSISTENT_TOTAL', 'Debit total does not match the movements', footerLine, '33', 'debitTotal');
  }
  if (creditCount !== state.creditCount) {
    fail('INCONSISTENT_TOTAL', 'Credit count does not match the movements', footerLine, '33', 'creditCount');
  }
  if (creditTotalCents !== state.totalCreditCents) {
    fail('INCONSISTENT_TOTAL', 'Credit total does not match the movements', footerLine, '33', 'creditTotal');
  }

  const finalBalanceCents = signedAmount(
    readDigits(footer, 59, 14, 'finalBalance', footerLine, '33'),
    footer.substring(58, 59),
    footerLine,
    'finalBalance',
    '33',
  );
  if (finalBalanceCents !== state.runningBalanceCents) {
    fail('INCONSISTENT_TOTAL', 'Final balance does not match the initial balance and movements', footerLine, '33', 'finalBalance');
  }
  state.finalBalance = finalBalanceCents / 100;

  const footerCurrencyCode = footer.substring(73, 76);
  if (!/^\d{3}$/.test(footerCurrencyCode) || footerCurrencyCode !== currencyCode) {
    fail('INVALID_FIELD', 'Currency code does not match the account header', footerLine, '33', 'currency');
  }
  state.recordCount += 1;

  const fileFooterLine = position + 1;
  const fileFooter = readRecord(rows, position++, '88', 'File footer');
  if (fileFooter.substring(2, 20) !== '999999999999999999') {
    fail('INVALID_FIELD', 'File footer marker is incorrect', fileFooterLine, '88', 'marker');
  }
  const totalRecords = readDigits(fileFooter, 20, 6, 'recordCount', fileFooterLine, '88');
  if (totalRecords !== state.recordCount) {
    fail('INCONSISTENT_TOTAL', 'Total record count does not match the file records', fileFooterLine, '88', 'recordCount');
  }
  if (position !== rows.length) {
    fail('UNEXPECTED_RECORD', 'Unexpected records found after the file footer', position + 1);
  }

  return toExport(state, 'OK', '');
}

function createError(error: unknown): C43ParseError {
  if (error instanceof C43ParsingException) {
    return {
      code: error.code,
      message: error.message,
      ...(error.lineNumber === undefined ? {} : { lineNumber: error.lineNumber }),
      ...(error.recordCode === undefined ? {} : { recordCode: error.recordCode }),
      ...(error.field === undefined ? {} : { field: error.field }),
    };
  }
  return {
    code: 'INVALID_INPUT',
    message: error instanceof Error ? error.message : 'Unexpected parsing error',
  };
}

export function parseC43(data: string | readonly string[], options: C43ParserOptions = {}): C43ParseResult {
  try {
    return { success: true, data: parseRows(normalizeRows(data), options) };
  } catch (error) {
    return { success: false, error: createError(error) };
  }
}

/** Compatibility wrapper. Prefer parseC43 or parseC43File for new integrations. */
export class C43Parser {
  public constructor(private readonly options: C43ParserOptions = {}) {}

  public parseData(data: string | string[]): C43AccountExport {
    const result = parseC43(data, this.options);
    if (result.success) {
      return result.data;
    }
    return toExport(emptyState(), 'ERROR', result.error.message);
  }
}

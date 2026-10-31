import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import nodeModule from '../dist/cjs/node.js';
import * as browserModule from '../dist/esm/browser.js';

const { C43Parser, parseC43, parseC43File } = nodeModule;

function insertValue(row, value, start, length, fill) {
  const safeValue = value.slice(0, length);
  const paddedValue = fill === '0' ? safeValue.padStart(length, '0') : safeValue.padEnd(length, ' ');
  return row.slice(0, start) + paddedValue + row.slice(start + length);
}

function createHeaderRow() {
  let row = ' '.repeat(80);
  row = insertValue(row, '11', 0, 2, '0');
  row = insertValue(row, '1234', 2, 4, '0');
  row = insertValue(row, '0001', 6, 4, '0');
  row = insertValue(row, '0000001234', 10, 10, '0');
  row = insertValue(row, '240101', 20, 6, '0');
  row = insertValue(row, '240101', 26, 6, '0');
  row = insertValue(row, '2', 32, 1, '0');
  row = insertValue(row, '100000', 33, 14, '0');
  row = insertValue(row, '978', 47, 3, '0');
  row = insertValue(row, '3', 50, 1, '0');
  row = insertValue(row, 'Alice Johnson', 51, 26, ' ');
  row = insertValue(row, '001', 77, 3, '0');
  return row;
}

function createMovementRow() {
  let row = ' '.repeat(80);
  row = insertValue(row, '22', 0, 2, '0');
  row = insertValue(row, '0001', 2, 4, '0');
  row = insertValue(row, '240101', 10, 6, '0');
  row = insertValue(row, '240101', 16, 6, '0');
  row = insertValue(row, '01', 22, 2, '0');
  row = insertValue(row, '2', 27, 1, '0');
  row = insertValue(row, '50000', 28, 14, '0');
  return row;
}

function createComplementaryRow() {
  let row = ' '.repeat(80);
  row = insertValue(row, '23', 0, 2, '0');
  row = insertValue(row, '01', 2, 2, '0');
  row = insertValue(row, 'Payment received', 4, 20, ' ');
  return row;
}

function createAccountFooterRow() {
  let row = ' '.repeat(80);
  row = insertValue(row, '33', 0, 2, '0');
  row = insertValue(row, '00000', 20, 5, '0');
  row = insertValue(row, '00000', 25, 14, '0');
  row = insertValue(row, '00001', 39, 5, '0');
  row = insertValue(row, '50000', 44, 14, '0');
  row = insertValue(row, '2', 58, 1, '0');
  row = insertValue(row, '150000', 59, 14, '0');
  row = insertValue(row, '978', 73, 3, '0');
  return row;
}

function createFileFooterRow() {
  let row = ' '.repeat(80);
  row = insertValue(row, '88', 0, 2, '0');
  row = insertValue(row, '999999999999999999', 2, 18, '0');
  row = insertValue(row, '000004', 20, 6, '0');
  return row;
}

function validRows() {
  return [
    createHeaderRow(),
    createMovementRow(),
    createComplementaryRow(),
    createAccountFooterRow(),
    createFileFooterRow(),
  ];
}

test('rejects invalid account headers', () => {
  const result = new C43Parser().parseData(['invalid']);
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /Account header code is incorrect/);
});

test('parses a valid payload and returns structured movements', () => {
  const result = new C43Parser().parseData(validRows());
  assert.equal(result.status, 'OK');
  assert.equal(result.clientName, 'Alice Johnson');
  assert.equal(result.clientCode, '001');
  assert.equal(result.initialBalance, 1000);
  assert.equal(result.finalBalance, 1500);
  assert.equal(result.movements.length, 1);
  assert.equal(result.movements[0].amount, 500);
  assert.match(result.movements[0].extraConcept, /Payment received/);
});

test('returns typed data and error details from the functional API', () => {
  const result = parseC43(validRows());
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.movements[0].operationDate, '20240101');
    assert.equal(result.data.status, 'OK');
  }

  const invalid = parseC43(['invalid']);
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.equal(invalid.error.code, 'UNEXPECTED_RECORD');
    assert.equal(invalid.error.lineNumber, 1);
  }
});

test('exposes the parser from the browser ESM entry without Node file APIs', () => {
  const result = browserModule.parseC43(validRows());
  assert.equal(result.success, true);
  assert.equal('parseC43File' in browserModule, false);
  assert.equal('C43Parser' in browserModule, true);
});

test('accepts a UTF-8 BOM, CRLF line endings, and a final newline', () => {
  const result = parseC43(`\uFEFF${validRows().join('\r\n')}\r\n`);
  assert.equal(result.success, true);
});

test('rejects short records and invalid numeric values with line details', () => {
  const shortRecord = parseC43(['11']);
  assert.equal(shortRecord.success, false);
  if (!shortRecord.success) {
    assert.equal(shortRecord.error.code, 'INVALID_RECORD_LENGTH');
    assert.equal(shortRecord.error.lineNumber, 1);
  }

  const invalidMovement = insertValue(createMovementRow(), 'not-a-number', 28, 14, '0');
  const invalidAmount = parseC43([
    createHeaderRow(),
    invalidMovement,
    createAccountFooterRow(),
    createFileFooterRow(),
  ]);
  assert.equal(invalidAmount.success, false);
  if (!invalidAmount.success) {
    assert.equal(invalidAmount.error.code, 'INVALID_FIELD');
    assert.equal(invalidAmount.error.field, 'amount');
    assert.equal(invalidAmount.error.lineNumber, 2);
  }
});

test('rejects invalid dates, inconsistent balances, missing records, and trailing data', () => {
  const invalidDate = insertValue(createMovementRow(), '240231', 10, 6, '0');
  const badDateResult = parseC43([
    createHeaderRow(),
    invalidDate,
    createComplementaryRow(),
    createAccountFooterRow(),
    createFileFooterRow(),
  ]);
  assert.equal(badDateResult.success, false);
  if (!badDateResult.success) {
    assert.equal(badDateResult.error.field, 'operationDate');
  }

  const inconsistentFooter = insertValue(createAccountFooterRow(), '149999', 59, 14, '0');
  const inconsistentResult = parseC43([
    createHeaderRow(),
    createMovementRow(),
    createComplementaryRow(),
    inconsistentFooter,
    createFileFooterRow(),
  ]);
  assert.equal(inconsistentResult.success, false);
  if (!inconsistentResult.success) {
    assert.equal(inconsistentResult.error.code, 'INCONSISTENT_TOTAL');
    assert.equal(inconsistentResult.error.field, 'finalBalance');
  }

  const missingFooter = parseC43([createHeaderRow(), createMovementRow()]);
  assert.equal(missingFooter.success, false);
  if (!missingFooter.success) {
    assert.equal(missingFooter.error.code, 'MISSING_RECORD');
  }

  const trailingData = parseC43([...validRows(), createFileFooterRow()]);
  assert.equal(trailingData.success, false);
  if (!trailingData.success) {
    assert.equal(trailingData.error.code, 'UNEXPECTED_RECORD');
  }
});

test('applies the configurable two-digit-year boundary', () => {
  const rows = [
    createHeaderRow(),
    insertValue(createMovementRow(), '500101', 10, 6, '0'),
    createComplementaryRow(),
    createAccountFooterRow(),
    createFileFooterRow(),
  ];
  const result = parseC43(rows);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.movements[0].operationDate, '19500101');
  }
});

test('tracks debit and credit balances in integer minor units', () => {
  const debit = insertValue(insertValue(createMovementRow(), '1', 27, 1, '0'), '20000', 28, 14, '0');
  const credit = insertValue(createMovementRow(), '50000', 28, 14, '0');
  let footer = createAccountFooterRow();
  footer = insertValue(footer, '00001', 20, 5, '0');
  footer = insertValue(footer, '20000', 25, 14, '0');
  footer = insertValue(footer, '00001', 39, 5, '0');
  footer = insertValue(footer, '50000', 44, 14, '0');
  footer = insertValue(footer, '130000', 59, 14, '0');
  const fileFooter = insertValue(createFileFooterRow(), '000005', 20, 6, '0');

  const result = parseC43([
    createHeaderRow(),
    debit,
    credit,
    createComplementaryRow(),
    footer,
    fileFooter,
  ]);
  assert.equal(result.success, true);
  if (result.success) {
    assert.deepEqual(result.data.movements.map(({ amount }) => amount), [-200, 500]);
    assert.deepEqual(
      result.data.movements.map(({ balanceBefore, balanceAfter }) => [balanceBefore, balanceAfter]),
      [
        [1000, 800],
        [800, 1300],
      ],
    );
  }
});

test('reads a valid file asynchronously', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'c43-parser-'));
  try {
    const filePath = join(directory, 'account.q43');
    await writeFile(filePath, validRows().join('\n'), 'utf8');
    const result = await parseC43File(filePath);
    assert.equal(result.success, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports file reading failures through the functional API', async () => {
  const result = await parseC43File('/path/that/does/not/exist.c43');
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.code, 'FILE_READ_ERROR');
    assert.notEqual(result.error.message, '');
  }
});

test('resets the compatibility parser between calls', () => {
  const parser = new C43Parser();
  assert.equal(parser.parseData(validRows()).status, 'OK');
  assert.equal(parser.parseData(['invalid']).status, 'ERROR');
  assert.equal(parser.parseData(validRows()).movements.length, 1);
});

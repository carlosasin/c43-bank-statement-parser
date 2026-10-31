# C43 Parser Library

Cross-platform library for validating and parsing fixed-width C43 account export files. The core parser works in Node.js and browser applications (Angular, React, and other bundler-based apps) without Node.js built-in dependencies.

## Requirements and installation

- Node.js 22 or newer
- npm, pnpm, or another npm-compatible package manager

```sh
npm install c43-bank-statement-parser
```

The package publishes CommonJS and ESM for Node.js and a Node-free ESM entry for browsers. Import the parser from the package root:

```ts
import { parseC43 } from 'c43-bank-statement-parser';
```

Bundlers select the browser entry automatically. It contains only the pure parser and does not import Node.js built-ins. Node applications resolve the Node entry automatically; Node file APIs are also explicitly available from `c43-bank-statement-parser/node`.

## Parse data

Use `parseC43` for in-memory text or a list of records. In a browser, read a selected `File` with the standard Web API and pass its text to the parser. Its result is a discriminated union, so TypeScript narrows success and error cases safely:

```ts
const result = parseC43(await file.text());

if (result.success) {
  console.log(result.data.clientName);
  console.log(result.data.movements);
} else {
  console.error(result.error.code, result.error.message, result.error.lineNumber);
}
```

## Parse a file

Node.js applications can import the asynchronous file API from the Node-specific entry:

```ts
import { parseC43File } from 'c43-bank-statement-parser/node';

const result = await parseC43File('/path/to/file.q43');

if (!result.success) {
  console.error(result.error);
} else {
  console.log(result.data.account);
}
```

`parseC43FileSync` and the compatibility `C43Parser` class are also available from `c43-bank-statement-parser/node`. All functional parsing APIs return `C43ParseResult`; read and parse failures are reported through its `error` branch. Errors include a stable code and, when applicable, the input line, C43 record code, and field.

## Date handling

The C43 movement date is returned as `YYYYMMDD`, preserving the library's original output format. By default, two-digit years `00`-`49` map to 2000-2049 and `50`-`99` to 1950-1999. Configure the boundary with `twoDigitYearPivot`:

```ts
const result = parseC43(c43Text, { twoDigitYearPivot: 40 });
```

## Compatibility API

The compatibility `C43Parser` class is available from the Node-specific entry:

```ts
import { C43Parser } from 'c43-bank-statement-parser/node';

const parser = new C43Parser();
const result = parser.parseData(c43Text);

if (result.status === 'OK') {
  console.log(result.movements);
} else {
  console.error(result.message);
}
```

For new code, prefer the function APIs: `parseData` expresses parse errors through `status`, while the legacy `parseFile` returns `undefined` if the file cannot be read. The functional APIs have a consistent, typed result instead.

## Validation

The parser checks fixed-width record lengths and sequence, numeric fields, dates, movement totals, balances, currencies, and the final record count. Monetary calculations are validated in integer minor units to avoid floating-point arithmetic errors.

## License

This library is distributed under the MIT License. See [LICENSE](./LICENSE) for the full text.

## Development

```sh
npm test
npm run check
npm run build
npm pack --dry-run
```

Tests use Node.js's built-in test runner, so no separate test framework is required. `npm run check` type-checks the CommonJS, Node ESM, and browser builds without emitting files. `npm test` builds all outputs and tests both the parser and an installed copy of the packed artifact. CI runs on Node 22 and 24. The `prepack` lifecycle also builds the package before it is packed or published.

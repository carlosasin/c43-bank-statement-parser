import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('installs the packed package and resolves Node and browser exports', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'c43-package-test-'));

  try {
    const tarballDirectory = join(temporaryDirectory, 'tarball');
    const installDirectory = join(temporaryDirectory, 'consumer');
    await mkdir(tarballDirectory);
    await mkdir(installDirectory);
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', tarballDirectory],
      { cwd: process.cwd(), stdio: 'pipe' },
    );

    const [tarballName] = await readdir(tarballDirectory);
    assert.ok(tarballName?.endsWith('.tgz'), 'npm pack should create a tarball');
    execFileSync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(tarballDirectory, tarballName)],
      { cwd: installDirectory, stdio: 'pipe' },
    );

    const smokeTest = `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      import * as nodePackage from 'c43-bank-statement-parser';
      import * as nodeSubpath from 'c43-bank-statement-parser/node';
      const require = createRequire(import.meta.url);
      const commonJsPackage = require('c43-bank-statement-parser');
      const commonJsSubpath = require('c43-bank-statement-parser/node');
      assert.equal(typeof nodePackage.parseC43, 'function');
      assert.equal(typeof nodePackage.parseC43File, 'function');
      assert.equal(typeof nodeSubpath.parseC43File, 'function');
      assert.equal(typeof commonJsPackage.parseC43, 'function');
      assert.equal(typeof commonJsSubpath.parseC43File, 'function');
    `;
    execFileSync(process.execPath, ['--input-type=module', '--eval', smokeTest], {
      cwd: installDirectory,
      stdio: 'pipe',
    });

    const browserSmokeTest = `
      import assert from 'node:assert/strict';
      import * as browserPackage from 'c43-bank-statement-parser';
      assert.equal(typeof browserPackage.parseC43, 'function');
      assert.equal('parseC43File' in browserPackage, false);
      assert.equal('C43Parser' in browserPackage, true);
    `;
    execFileSync(process.execPath, ['--conditions=browser', '--input-type=module', '--eval', browserSmokeTest], {
      cwd: installDirectory,
      stdio: 'pipe',
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

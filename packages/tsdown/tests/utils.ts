import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { expectFilesSnapshot } from '@sxzz/test-utils'
import { glob } from 'tinyglobby'
import { build, type Options } from '../src/index'
import type { RollupLog } from 'rolldown'
import type { RunnerTask, TestContext } from 'vitest'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const tmpDir = path.resolve(dirname, 'temp')
const snapshotsDir = path.resolve(dirname, '__snapshots__')
const fixturesDir = path.resolve(dirname, 'fixtures')

function getTestFilename(task: RunnerTask) {
  return (
    (task.suite ? `${filenamify(task.suite.name)}/` : '') +
    filenamify(task.name)
  )
}

export function getTestDir(testName: RunnerTask | string): string {
  return path.resolve(
    tmpDir,
    typeof testName === 'string' ? testName : getTestFilename(testName),
  )
}

export async function writeFixtures(
  { task }: TestContext,
  files?: Record<string, string>,
  fixtureName?: string,
): Promise<{ testName: string; testDir: string }> {
  const testName = getTestFilename(task)
  const testDir = getTestDir(testName)
  await mkdir(testDir, { recursive: true })

  if (files && fixtureName) {
    throw new Error('Cannot provide both `files` and `fixtureName`')
  }

  if (fixtureName) {
    const fixtureDir = path.resolve(fixturesDir, fixtureName)
    const filePaths = await glob('**/*', {
      cwd: fixtureDir,
      followSymbolicLinks: false,
    })
    files = Object.fromEntries(
      await Promise.all(
        filePaths.map(async (filePath) => {
          const absoluteFilePath = path.resolve(fixtureDir, filePath)
          const content = await readFile(absoluteFilePath, 'utf8')
          return [filePath, content]
        }),
      ),
    )
  }

  if (!files) {
    throw new Error('Either `files` or `fixtureName` must be provided')
  }

  for (const [filename, content] of Object.entries(files)) {
    const filepath = path.resolve(testDir, filename)
    await mkdir(path.dirname(filepath), { recursive: true })
    await writeFile(filepath, content, 'utf8')
  }

  return { testName, testDir }
}

export interface TestBuildOptions {
  context: TestContext

  /**
   * The files to write to the test directory.
   *
   * One of `files` or `fixtureName` must be provided.
   */
  files?: Record<string, string>

  /**
   * The directory name under `tests/fixtures` to use as a fixture.
   *
   * One of `files` or `fixtureName` must be provided.
   */
  fixture?: string

  /**
   * The options for the build.
   */
  options?: Options | ((cwd: string) => Options)

  /**
   * The working directory of the test. It's a relative path to the test directory.
   *
   * @default '.'
   */
  cwd?: string

  /**
   * A function that will be called before the build.
   */
  beforeBuild?: () => Promise<void>

  expectDir?: string
  expectPattern?: string
}

export async function testBuild({
  context,
  files,
  fixture,
  options,
  cwd,
  expectDir = '.',
  expectPattern,
  beforeBuild,
}: TestBuildOptions): Promise<{
  testName: string
  testDir: string
  outputFiles: string[]
  outputDir: string
  snapshot: string
  fileMap: Record<string, string>
  warnings: RollupLog[]
}> {
  const { expect } = context
  const { testName, testDir } = await writeFixtures(context, files, fixture)

  const workingDir = path.join(testDir, cwd || '.')
  const restoreCwd = chdir(workingDir)
  const warnings: RollupLog[] = []
  const resolvedOptions: Options = {
    entry: 'index.ts',
    config: false,
    outDir: 'dist',
    dts: false,
    silent: true,
    inputOptions: {
      onLog(level, log, defaultHandler) {
        if (level === 'warn') {
          warnings.push(log)
          return
        }
        defaultHandler(level, log)
      },
    },
    ...(typeof options === 'function' ? options(workingDir) : options),
  }
  await beforeBuild?.()
  await build(resolvedOptions)
  restoreCwd()

  const outputDir = path.resolve(workingDir, resolvedOptions.outDir!)
  const {
    files: outputFiles,
    snapshot,
    fileMap,
  } = await expectFilesSnapshot(
    path.resolve(outputDir, expectDir),
    path.resolve(snapshotsDir, `${testName}.snap.md`),
    { pattern: expectPattern, expect },
  )

  return {
    testName,
    testDir,
    outputFiles,
    outputDir,
    snapshot,
    fileMap,
    warnings,
  }
}

function filenamify(input: string) {
  return input.replace(/^\W+/, '').replaceAll(/\W+/g, '-')
}

export function chdir(dir: string) {
  const oldCwd = process.cwd()
  process.chdir(dir)
  return (): void => process.chdir(oldCwd)
}

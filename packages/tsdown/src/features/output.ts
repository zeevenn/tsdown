import { RE_CSS, RE_DTS, RE_JS } from 'rolldown-plugin-dts/filename'
import { getPackageType, type PackageType } from '../utils/package'
import type { Format, NormalizedFormat, ResolvedOptions } from '../options'
import type {
  AddonFunction,
  InputOptions,
  PreRenderedChunk,
  RenderedChunk,
} from 'rolldown'

export interface OutExtensionContext {
  options: InputOptions
  format: NormalizedFormat
  /** "type" field in project's package.json */
  pkgType?: PackageType
}
export interface OutExtensionObject {
  js?: string
  dts?: string
}
export type OutExtensionFactory = (
  context: OutExtensionContext,
) => OutExtensionObject | undefined

function resolveJsOutputExtension(
  packageType: PackageType,
  format: NormalizedFormat,
  fixedExtension?: boolean,
): 'cjs' | 'js' | 'mjs' {
  switch (format) {
    case 'es':
      return !fixedExtension && packageType === 'module' ? 'js' : 'mjs'
    case 'cjs':
      return fixedExtension || packageType === 'module' ? 'cjs' : 'js'
    default:
      return 'js'
  }
}

export function resolveChunkFilename(
  { outExtensions, fixedExtension, pkg, hash }: ResolvedOptions,
  inputOptions: InputOptions,
  format: NormalizedFormat,
): [entry: ChunkFileName, chunk: ChunkFileName] {
  const packageType = getPackageType(pkg)

  let jsExtension: string | undefined
  let dtsExtension: string | undefined

  if (outExtensions) {
    const { js, dts } =
      outExtensions({
        options: inputOptions,
        format,
        pkgType: packageType,
      }) || {}
    jsExtension = js
    dtsExtension = dts
  }

  jsExtension ||= `.${resolveJsOutputExtension(packageType, format, fixedExtension)}`

  const suffix = format === 'iife' || format === 'umd' ? `.${format}` : ''
  return [
    createChunkFilename(`[name]${suffix}`, jsExtension, dtsExtension),
    createChunkFilename(
      `[name]${suffix}${hash ? '-[hash]' : ''}`,
      jsExtension,
      dtsExtension,
    ),
  ]
}

type ChunkFileName = string | ((chunk: PreRenderedChunk) => string)
function createChunkFilename(
  basename: string,
  jsExtension: string,
  dtsExtension?: string,
): ChunkFileName {
  if (!dtsExtension) return `${basename}${jsExtension}`
  return (chunk: PreRenderedChunk) => {
    return `${basename}${chunk.name.endsWith('.d') ? dtsExtension : jsExtension}`
  }
}

export interface ChunkAddonObject {
  js?: string
  css?: string
  dts?: string
}
export type ChunkAddonFunction = (ctx: {
  format: Format
}) => ChunkAddonObject | undefined
export type ChunkAddon = ChunkAddonObject | ChunkAddonFunction

export function resolveChunkAddon(
  chunkAddon: ChunkAddon | undefined,
  format: NormalizedFormat,
): AddonFunction | undefined {
  if (!chunkAddon) return

  return (chunk: RenderedChunk) => {
    if (typeof chunkAddon === 'function') {
      chunkAddon = chunkAddon({ format })
    }

    switch (true) {
      case RE_JS.test(chunk.fileName):
        return chunkAddon?.js || ''
      case RE_CSS.test(chunk.fileName):
        return chunkAddon?.css || ''
      case RE_DTS.test(chunk.fileName):
        return chunkAddon?.dts || ''
      default:
        return ''
    }
  }
}

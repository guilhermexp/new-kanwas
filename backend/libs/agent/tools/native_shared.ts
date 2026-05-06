import { posix as pathPosix } from 'node:path'

export const WORKSPACE_ROOT = '/workspace'
export const THROTTLE_MS = 100

export const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export const OPENAI_FILE_INPUT_MAX_BYTES = 50 * 1024 * 1024

const OPENAI_TEXT_CODE_EXTENSIONS = new Set([
  '.asm',
  '.astro',
  '.awk',
  '.bat',
  '.bash',
  '.c',
  '.cc',
  '.clj',
  '.cmake',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.cxx',
  '.dart',
  '.def',
  '.dic',
  '.diff',
  '.ejs',
  '.eml',
  '.erl',
  '.erb',
  '.ex',
  '.exs',
  '.go',
  '.gradle',
  '.graphql',
  '.groovy',
  '.gql',
  '.h',
  '.hbs',
  '.hcl',
  '.hh',
  '.hs',
  '.htm',
  '.html',
  '.ics',
  '.ifb',
  '.in',
  '.ini',
  '.jade',
  '.java',
  '.jinja',
  '.jl',
  '.js',
  '.json',
  '.json5',
  '.jsx',
  '.ksh',
  '.kt',
  '.less',
  '.liquid',
  '.list',
  '.log',
  '.lua',
  '.m',
  '.markdown',
  '.md',
  '.mht',
  '.mhtml',
  '.mime',
  '.mjs',
  '.mm',
  '.mustache',
  '.ndjson',
  '.nws',
  '.patch',
  '.php',
  '.pl',
  '.properties',
  '.proto',
  '.pug',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.rst',
  '.s',
  '.sass',
  '.scala',
  '.scss',
  '.sh',
  '.sql',
  '.srt',
  '.swift',
  '.text',
  '.tf',
  '.toml',
  '.ts',
  '.tsx',
  '.twig',
  '.txt',
  '.tex',
  '.vcf',
  '.vtt',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
])

const OPENAI_FILE_INPUT_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',

  '.xla': 'application/vnd.ms-excel',
  '.xlb': 'application/vnd.ms-excel',
  '.xlc': 'application/vnd.ms-excel',
  '.xlm': 'application/vnd.ms-excel',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlt': 'application/vnd.ms-excel',
  '.xlw': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.tsv': 'text/tsv',
  '.iif': 'text/x-iif',

  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.dot': 'application/msword',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',

  '.pot': 'application/vnd.ms-powerpoint',
  '.ppa': 'application/vnd.ms-powerpoint',
  '.pps': 'application/vnd.ms-powerpoint',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pwz': 'application/vnd.ms-powerpoint',
  '.wiz': 'application/vnd.ms-powerpoint',
}

const TEXT_EXTENSIONS = ['.md', '.yaml', '.yml']

export type ImageResult = { isImage: true; data: string; mimeType: string; path: string }
export type FileResult = { isFile: true; data: string; mimeType: string; path: string; filename: string }
export type TextEditorResult = string | ImageResult

export type ProgressCallback = (update: { streamingStatus?: string; linesRead?: number; totalLines?: number }) => void

export function getPathExtension(path: string): string {
  const filename = pathPosix.basename(path)
  const lastDot = filename.lastIndexOf('.')
  return lastDot <= 0 || lastDot === filename.length - 1 ? '' : filename.toLowerCase().slice(lastDot)
}

export function isAllowedFileType(path: string): { allowed: boolean; isImage: boolean } {
  const ext = getPathExtension(path)
  if (TEXT_EXTENSIONS.includes(ext)) {
    return { allowed: true, isImage: false }
  }
  if (IMAGE_EXTENSIONS[ext]) {
    return { allowed: true, isImage: true }
  }
  return { allowed: false, isImage: false }
}

export function isImageResult(result: unknown): result is ImageResult {
  return (
    typeof result === 'object' && result !== null && 'isImage' in result && (result as ImageResult).isImage === true
  )
}

export function isFileResult(result: unknown): result is FileResult {
  return typeof result === 'object' && result !== null && 'isFile' in result && (result as FileResult).isFile === true
}

export function getOpenAIFileInputMimeType(path: string): string | null {
  const ext = getPathExtension(path)
  if (OPENAI_FILE_INPUT_MIME_TYPES[ext]) {
    return OPENAI_FILE_INPUT_MIME_TYPES[ext]
  }

  return null
}

export function isOpenAITextCodeFile(path: string): boolean {
  const ext = getPathExtension(path)
  return OPENAI_TEXT_CODE_EXTENSIONS.has(ext)
}

export function resolveWorkspacePath(path: string): string | null {
  const normalized = path.startsWith('/')
    ? pathPosix.normalize(path)
    : pathPosix.normalize(pathPosix.join(WORKSPACE_ROOT, path))

  return normalized === WORKSPACE_ROOT || normalized.startsWith(`${WORKSPACE_ROOT}/`) ? normalized : null
}

export function resolveWorkspaceFilePath(path: string): string | null {
  const resolved = resolveWorkspacePath(path)
  return resolved && resolved !== WORKSPACE_ROOT ? resolved : null
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`
}

export function formatTextEditorResult(result: TextEditorResult): string {
  if (isImageResult(result)) {
    return `Viewing image: ${result.path} (${result.mimeType}, ${Math.round((result.data.length * 0.75) / 1024)}KB)`
  }

  return result
}

export function formatLineNumberedText(content: string): string {
  return content
    .split('\n')
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n')
}

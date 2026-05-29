#!/usr/bin/env node
/**
 * Claude Agent SDK Bridge
 *
 * Subprocess that imports `@anthropic-ai/claude-agent-sdk` and exposes its
 * `query()` function over NDJSON stdin/stdout. The parent TypeScript process
 * (ClaudeSDKEngine) spawns this script, sends requests on stdin, and reads
 * streaming events from stdout.
 *
 * Protocol (stdin → bridge):
 *   { "type": "request", "id": "<uuid>", "systemPrompt": "...", "prompt": "...", "cwd": "..." }
 *   { "type": "close" }
 *
 * Protocol (bridge → stdout):
 *   { "type": "ready" }
 *   { "type": "started", "id": "<uuid>" }
 *   { "type": "stream_event", "id": "<uuid>", "event": <SDKPartialAssistantMessage.event> }
 *   { "type": "assistant", "id": "<uuid>", "message": <BetaMessage> }
 *   { "type": "tool_use", "id": "<uuid>", "toolName": "...", "toolInput": {...}, "toolUseId": "..." }
 *   { "type": "result", "id": "<uuid>", "text": "...", "numTurns": N, "durationMs": N }
 *   { "type": "error", "id": "<uuid>", "message": "..." }
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import readline from 'node:readline'

const require = createRequire(import.meta.url)

import { execSync } from 'node:child_process'
import { resolveSdkErrorMessage, sanitizeBridgeEnv } from './claude_bridge_auth.mjs'

function findClaude() {
  try {
    return execSync('which claude', { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

function moduleSearchPaths() {
  const explicit = (process.env.KANWAS_CLAUDE_AGENT_SDK_PATHS || '')
    .split(':')
    .filter(Boolean)
  return [
    new URL('.', import.meta.url).pathname,
    process.cwd(),
    ...explicit,
  ]
}

async function loadAgentSDK() {
  const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk', {
    paths: moduleSearchPaths(),
  })
  const sdk = await import(pathToFileURL(sdkPath).href)
  return { sdk, sdkPath }
}

// ---------------------------------------------------------------------------
// Command queue (stdin → async generator for query())
// ---------------------------------------------------------------------------

const pendingCommands = []
const commandWaiters = []
let closed = false
let currentRequestID = null
let currentText = ''

function enqueueCommand(command) {
  if (closed) return
  const waiter = commandWaiters.shift()
  if (waiter) {
    waiter(command)
  } else {
    pendingCommands.push(command)
  }
}

function nextCommand() {
  if (pendingCommands.length > 0) {
    return Promise.resolve(pendingCommands.shift())
  }
  if (closed) {
    return Promise.resolve({ type: 'close' })
  }
  return new Promise((resolve) => commandWaiters.push(resolve))
}

// ---------------------------------------------------------------------------
// Build the user message from a request command
// ---------------------------------------------------------------------------

function userMessageFromCommand(command) {
  const content = []

  if (typeof command.systemPrompt === 'string' && command.systemPrompt.trim()) {
    content.push({
      type: 'text',
      text: command.systemPrompt,
    })
  }

  content.push({
    type: 'text',
    text: command.prompt || '',
  })

  return {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
  }
}

// ---------------------------------------------------------------------------
// Async generator that feeds messages to query()
// ---------------------------------------------------------------------------

async function* commandStream() {
  while (!closed) {
    const command = await nextCommand()
    if (!command || command.type === 'close') {
      return
    }
    if (command.type !== 'request') {
      continue
    }

    currentRequestID = command.id
    currentText = ''
    emit({ type: 'started', id: currentRequestID })
    yield userMessageFromCommand(command)
  }
}

// ---------------------------------------------------------------------------
// Extract text from an assistant message
// ---------------------------------------------------------------------------

function assistantText(message) {
  const content = message?.message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

// ---------------------------------------------------------------------------
// Handle SDK messages
// ---------------------------------------------------------------------------

function handleSDKMessage(message) {
  if (!currentRequestID) return

  // Streaming event (partial assistant content)
  if (message.type === 'stream_event') {
    const event = message.event
    emit({ type: 'stream_event', id: currentRequestID, event })

    // Accumulate text from text_delta events
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      currentText += event.delta.text || ''
    }
    return
  }

  // Full assistant message (contains tool_use blocks, thinking, text)
  if (message.type === 'assistant') {
    const text = assistantText(message)
    if (text) {
      currentText = text
    }

    // Forward the full assistant message for tool_use extraction
    const content = message?.message?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'tool_use') {
          emit({
            type: 'tool_use',
            id: currentRequestID,
            toolName: block.name,
            toolInput: block.input,
            toolUseId: block.id,
          })
        }
      }
    }

    emit({
      type: 'assistant',
      id: currentRequestID,
      message: message.message,
    })
    return
  }

  // Result (query completed for this turn)
  if (message.type === 'result') {
    const id = currentRequestID
    const resultText = message.result || currentText
    currentRequestID = null
    currentText = ''

    if (message.is_error) {
      emit({
        type: 'error',
        id,
        message: resolveSdkErrorMessage(message),
      })
    } else {
      emit({
        type: 'result',
        id,
        text: resultText || '',
        numTurns: message.num_turns || 0,
        durationMs: message.duration_ms || 0,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Stdin reader
// ---------------------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const command = JSON.parse(trimmed)
    if (command.type === 'close') {
      closed = true
      enqueueCommand({ type: 'close' })
      return
    }
    enqueueCommand(command)
  } catch (error) {
    emit({ type: 'error', message: `Invalid bridge command: ${error.message}` })
  }
})

rl.on('close', () => {
  closed = true
  enqueueCommand({ type: 'close' })
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  const { sdk, sdkPath } = await loadAgentSDK()
  const { query } = sdk
  if (typeof query !== 'function') {
    throw new Error('@anthropic-ai/claude-agent-sdk did not export query()')
  }

  emit({ type: 'ready', sdkPath })

  // Strip API-key auth vars so the SDK uses the Claude Code subscription login.
  const bridgeEnv = sanitizeBridgeEnv(process.env)

  const options = {
    model: process.env.KANWAS_CLAUDE_MODEL || 'claude-sonnet-4-6',
    cwd: process.env.KANWAS_CLAUDE_CWD || process.cwd(),
    systemPrompt: process.env.KANWAS_CLAUDE_SYSTEM_PROMPT || '',
    pathToClaudeCodeExecutable: process.env.KANWAS_CLAUDE_EXECUTABLE || findClaude(),
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    sandbox: {
      enabled: false,
      allowUnsandboxedCommands: true,
    },
    includePartialMessages: true,
    includeHookEvents: false,
    persistSession: false,
    settingSources: [],
    env: bridgeEnv,
  }

  const stream = query({
    prompt: commandStream(),
    options,
  })

  for await (const message of stream) {
    handleSDKMessage(message)
  }
} catch (error) {
  emit({
    type: 'error',
    id: currentRequestID,
    message: error?.stack || error?.message || String(error),
  })
  process.exitCode = 1
}

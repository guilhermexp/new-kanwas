import { test } from '@japa/runner'
import { DEFAULT_EXECUTION_ENGINE, isExecutionEngine, resolveExecutionEngine } from 'shared/execution-config'

test.group('Execution engine resolution', (group) => {
  let previous: string | undefined

  group.each.setup(() => {
    previous = process.env.EXECUTION_ENGINE
    return () => {
      if (previous === undefined) {
        delete process.env.EXECUTION_ENGINE
      } else {
        process.env.EXECUTION_ENGINE = previous
      }
    }
  })

  test('isExecutionEngine accepts the three supported engines', ({ assert }) => {
    assert.isTrue(isExecutionEngine('vercel-ai'))
    assert.isTrue(isExecutionEngine('claude-sdk'))
    assert.isTrue(isExecutionEngine('codex'))
  })

  test('isExecutionEngine rejects unknown values', ({ assert }) => {
    assert.isFalse(isExecutionEngine('gpt-5.5'))
    assert.isFalse(isExecutionEngine('anthropic'))
    assert.isFalse(isExecutionEngine(''))
  })

  test('resolveExecutionEngine returns the configured engine', ({ assert }) => {
    process.env.EXECUTION_ENGINE = 'claude-sdk'
    assert.equal(resolveExecutionEngine(), 'claude-sdk')

    process.env.EXECUTION_ENGINE = 'codex'
    assert.equal(resolveExecutionEngine(), 'codex')
  })

  test('resolveExecutionEngine trims surrounding whitespace', ({ assert }) => {
    process.env.EXECUTION_ENGINE = '  codex  '
    assert.equal(resolveExecutionEngine(), 'codex')
  })

  test('resolveExecutionEngine falls back to the default when unset', ({ assert }) => {
    delete process.env.EXECUTION_ENGINE
    assert.equal(resolveExecutionEngine(), DEFAULT_EXECUTION_ENGINE)
  })

  test('resolveExecutionEngine falls back to the default on invalid values', ({ assert }) => {
    process.env.EXECUTION_ENGINE = 'gpt-5.5'
    assert.equal(resolveExecutionEngine(), DEFAULT_EXECUTION_ENGINE)
  })
})

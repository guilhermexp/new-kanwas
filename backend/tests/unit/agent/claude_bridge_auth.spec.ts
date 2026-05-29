import { test } from '@japa/runner'
import {
  STRIPPED_AUTH_ENV_VARS,
  resolveSdkErrorMessage,
  sanitizeBridgeEnv,
} from '../../../libs/agent/bridge/claude_bridge_auth.mjs'

test.group('claude bridge auth — sanitizeBridgeEnv', () => {
  test('strips API-key auth vars so the SDK uses the subscription login', ({ assert }) => {
    const env = sanitizeBridgeEnv({
      ANTHROPIC_API_KEY: 'sk-ant-placeholder',
      ANTHROPIC_AUTH_TOKEN: 'tok',
      PATH: '/usr/bin',
    })

    for (const key of STRIPPED_AUTH_ENV_VARS) {
      assert.notProperty(env, key)
    }
  })

  test('tags the client app and preserves unrelated vars', ({ assert }) => {
    const env = sanitizeBridgeEnv({ PATH: '/usr/bin', HOME: '/home/u' })

    assert.equal(env.CLAUDE_AGENT_SDK_CLIENT_APP, 'kanwas/1.0')
    assert.equal(env.PATH, '/usr/bin')
    assert.equal(env.HOME, '/home/u')
  })

  test('sets IS_SANDBOX so claude allows bypass mode when running as root in a container', ({ assert }) => {
    assert.equal(sanitizeBridgeEnv({}).IS_SANDBOX, '1')
  })

  test('does not mutate the source env', ({ assert }) => {
    const source = { ANTHROPIC_API_KEY: 'sk-ant-placeholder', PATH: '/usr/bin' }
    sanitizeBridgeEnv(source)

    assert.property(source, 'ANTHROPIC_API_KEY')
    assert.notProperty(source, 'CLAUDE_AGENT_SDK_CLIENT_APP')
  })
})

test.group('claude bridge auth — resolveSdkErrorMessage', () => {
  test('prefers the human-readable result on a failed turn reported as success', ({ assert }) => {
    // The SDK reports an invalid API key with subtype "success" + the reason in `result`.
    const message = {
      is_error: true,
      subtype: 'success',
      result: 'Invalid API key · Fix external API key',
    }

    assert.equal(resolveSdkErrorMessage(message), 'Invalid API key · Fix external API key')
  })

  test('prefers explicit errors[] over result', ({ assert }) => {
    const message = { errors: ['boom one', 'boom two'], result: 'ignored', subtype: 'success' }
    assert.equal(resolveSdkErrorMessage(message), 'boom one\nboom two')
  })

  test('falls back to subtype, then a generic message', ({ assert }) => {
    assert.equal(resolveSdkErrorMessage({ subtype: 'error_max_turns' }), 'error_max_turns')
    assert.equal(resolveSdkErrorMessage({}), 'Claude Agent SDK query failed.')
  })
})

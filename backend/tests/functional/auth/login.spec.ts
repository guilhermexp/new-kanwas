import { test } from '@japa/runner'
import User from '#models/user'

test.group('Auth login', () => {
  test('should login with valid credentials and return token', async ({ client, assert }) => {
    await User.create({
      email: 'test@example.com',
      password: 'password123',
    })

    const response = await client.post('/auth/login').json({
      email: 'test@example.com',
      password: 'password123',
    })

    response.assertStatus(200)
    response.assertBodyContains({
      type: 'bearer',
    })
    assert.exists(response.body().value)
    assert.isString(response.body().value)
  })

  test('should fail with invalid email', async ({ client }) => {
    await User.create({
      email: 'test@example.com',
      password: 'password123',
    })

    const response = await client.post('/auth/login').json({
      email: 'wrong@example.com',
      password: 'password123',
    })

    response.assertStatus(400)
  })

  test('should fail with invalid password', async ({ client }) => {
    await User.create({
      email: 'test@example.com',
      password: 'password123',
    })

    const response = await client.post('/auth/login').json({
      email: 'test@example.com',
      password: 'wrongpassword',
    })

    response.assertStatus(400)
  })

  test('should fail with missing credentials', async ({ client }) => {
    const response = await client.post('/auth/login').json({})

    response.assertStatus(422)
  })
})

test.group('Default user auth', () => {
  test('rejects /auth/default unless explicitly enabled', async ({ client }) => {
    const previous = process.env.DEFAULT_USER_LOGIN_ENABLED
    delete process.env.DEFAULT_USER_LOGIN_ENABLED

    try {
      const response = await client.post('/auth/default')
      response.assertStatus(403)
      response.assertBodyContains({ error: 'Default user login is disabled' })
    } finally {
      if (previous === undefined) {
        delete process.env.DEFAULT_USER_LOGIN_ENABLED
      } else {
        process.env.DEFAULT_USER_LOGIN_ENABLED = previous
      }
    }
  })

  test('does not overwrite explicit bearer tokens with the development default user', async ({ client, assert }) => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousDefaultEnabled = process.env.DEFAULT_USER_LOGIN_ENABLED
    process.env.NODE_ENV = 'development'
    process.env.DEFAULT_USER_LOGIN_ENABLED = 'true'

    try {
      const explicitUser = await User.create({
        email: 'explicit-dev-user@example.com',
        password: 'password123',
        name: 'Explicit Dev User',
      })
      const token = await User.accessTokens.create(explicitUser)

      const response = await client.get('/auth/me').bearerToken(token.value!.release())
      response.assertStatus(200)
      assert.equal(response.body().id, explicitUser.id)
      assert.equal(response.body().email, explicitUser.email)
    } finally {
      process.env.NODE_ENV = previousNodeEnv
      if (previousDefaultEnabled === undefined) {
        delete process.env.DEFAULT_USER_LOGIN_ENABLED
      } else {
        process.env.DEFAULT_USER_LOGIN_ENABLED = previousDefaultEnabled
      }
    }
  })

  test('allows /auth/default when explicitly enabled', async ({ client, assert }) => {
    const previous = process.env.DEFAULT_USER_LOGIN_ENABLED
    process.env.DEFAULT_USER_LOGIN_ENABLED = 'true'

    try {
      const response = await client.post('/auth/default')
      response.assertStatus(200)
      response.assertBodyContains({ type: 'bearer' })
      assert.isString(response.body().value)
    } finally {
      if (previous === undefined) {
        delete process.env.DEFAULT_USER_LOGIN_ENABLED
      } else {
        process.env.DEFAULT_USER_LOGIN_ENABLED = previous
      }
    }
  })
})

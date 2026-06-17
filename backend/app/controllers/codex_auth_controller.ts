import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import CodexOauthService from '#services/codex_oauth_service'

@inject()
export default class CodexAuthController {
  constructor(private codexOauthService: CodexOauthService) {}

  async status({ auth, response }: HttpContext) {
    return response.ok(await this.codexOauthService.getStatus(auth.getUserOrFail().id))
  }

  async start({ auth, response }: HttpContext) {
    return response.ok(await this.codexOauthService.startDeviceLogin(auth.getUserOrFail().id))
  }

  async poll({ auth, params, response }: HttpContext) {
    try {
      return response.ok(await this.codexOauthService.pollDeviceLogin(auth.getUserOrFail().id, params.sessionId))
    } catch (error) {
      return response.badRequest({ error: error instanceof Error ? error.message : 'Codex login failed' })
    }
  }

  async disconnect({ auth, response }: HttpContext) {
    return response.ok(await this.codexOauthService.disconnect(auth.getUserOrFail().id))
  }
}

import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Workspace from '#models/workspace'
import Organization from '#models/organization'
import OrganizationMembership from '#models/organization_membership'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  redirectTo = '/login'

  private static devToken: string | null = null
  private static devSetupPromise: Promise<void> | null = null

  private static async ensureDevWorkspace(user: User): Promise<void> {
    const existingWorkspace = await user.related('workspaces').query().first()
    if (existingWorkspace) return

    await db.transaction(async (trx) => {
      const existingPivot = await trx.from('workspace_users').where('user_id', user.id).first()
      if (existingPivot) return

      let membership = await OrganizationMembership.query({ client: trx })
        .where('user_id', user.id)
        .where('role', 'admin')
        .orderBy('created_at', 'asc')
        .first()

      if (!membership) {
        const organization = await Organization.create({ name: 'Dev Workspace' }, { client: trx })
        membership = await OrganizationMembership.create(
          {
            organizationId: organization.id,
            userId: user.id,
            role: 'admin',
          },
          { client: trx }
        )
      }

      const workspace = await Workspace.create(
        {
          name: 'Dev Workspace',
          organizationId: membership.organizationId,
          onboardingStatus: 'not_started',
        },
        { client: trx }
      )

      await trx.table('workspace_users').insert({
        workspace_id: workspace.id,
        user_id: user.id,
        created_at: new Date(),
        updated_at: new Date(),
      })
    })
  }

  private static async ensureDevUser(): Promise<void> {
    if (AuthMiddleware.devToken) return
    if (AuthMiddleware.devSetupPromise) return AuthMiddleware.devSetupPromise

    AuthMiddleware.devSetupPromise = (async () => {
      const email = 'dev@kanwas.local'
      let user = await User.findBy('email', email)
      if (!user) {
        user = await User.create({ email, password: 'devdevdev', name: 'Dev User' })
      }

      await AuthMiddleware.ensureDevWorkspace(user)

      const token = await User.accessTokens.create(user, ['*'])
      AuthMiddleware.devToken = token.value!.release()
    })()

    return AuthMiddleware.devSetupPromise
  }

  private async applyDevDefaultToken(ctx: HttpContext): Promise<boolean> {
    if (process.env.NODE_ENV !== 'development') {
      return false
    }

    await AuthMiddleware.ensureDevUser()
    if (!AuthMiddleware.devToken) {
      return false
    }

    ctx.request.headers().authorization = `Bearer ${AuthMiddleware.devToken}`
    return true
  }

  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
      allowSandboxToken?: boolean
    } = {}
  ) {
    await this.applyDevDefaultToken(ctx)

    try {
      await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })
    } catch (error) {
      // Retry with the default token in case auth state was not initialized yet.
      if (!(await this.applyDevDefaultToken(ctx))) {
        throw error
      }

      await ctx.auth.authenticateUsing(options.guards, { loginRoute: this.redirectTo })
    }

    const token = ctx.auth.user?.currentAccessToken
    if (token && !token.allows('*') && !options.allowSandboxToken) {
      return ctx.response.forbidden({
        error: 'Scoped token cannot access this endpoint',
      })
    }

    return next()
  }
}

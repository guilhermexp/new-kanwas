import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import './custom_types.js'

const hasDedicatedFolderNameWhenRequested = vine.createRule((value: unknown, _, field: FieldContext) => {
  if (!value || typeof value !== 'object') {
    return
  }

  const task = value as { shouldCreateDedicatedFolder?: unknown; dedicatedFolderName?: unknown }
  if (task.shouldCreateDedicatedFolder !== true) {
    return
  }

  if (typeof task.dedicatedFolderName === 'string' && task.dedicatedFolderName.trim().length > 0) {
    return
  }

  field.report(
    'The {{ field }} field must include dedicatedFolderName when shouldCreateDedicatedFolder is true',
    'dedicatedFolderNameRequired',
    field
  )
})

const WorkspaceSuggestedTaskSchemaNode = vine
  .object({
    id: vine.string(),
    emoji: vine.string(),
    headline: vine.string(),
    description: vine.string(),
    prompt: vine.string().maxLength(2000),
    source: vine.string().optional(),
    shouldCreateDedicatedFolder: vine.boolean().optional(),
    dedicatedFolderName: vine.string().optional(),
  })
  .use(hasDedicatedFolderNameWhenRequested())

export const WorkspaceSuggestedTaskSchema = vine.compile(WorkspaceSuggestedTaskSchemaNode)

export const WorkspaceSuggestedTaskStateSchema = vine.compile(
  vine.object({
    isLoading: vine.boolean(),
    tasks: vine.array(WorkspaceSuggestedTaskSchemaNode),
    generatedAt: vine.luxonDateTime().nullable(),
    error: vine.string().nullable(),
  })
)

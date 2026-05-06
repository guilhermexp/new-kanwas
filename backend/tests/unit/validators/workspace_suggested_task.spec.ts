import { test } from '@japa/runner'
import { WorkspaceSuggestedTaskStateSchema } from '#validators/workspace_suggested_task'

function createTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activation-plan',
    emoji: '🧪',
    headline: 'Pressure-test activation',
    description: 'Find the smallest activation proof worth building next.',
    prompt: 'Review the workspace and define the sharpest activation test.',
    ...overrides,
  }
}

function createState(task: Record<string, unknown>) {
  return {
    isLoading: false,
    tasks: [task],
    generatedAt: null,
    error: null,
  }
}

test.group('workspace suggested task validator', () => {
  test('accepts tasks with a complete dedicated folder hint', async ({ assert }) => {
    const state = await WorkspaceSuggestedTaskStateSchema.validate(
      createState(
        createTask({
          shouldCreateDedicatedFolder: true,
          dedicatedFolderName: 'activation-plan',
        })
      )
    )

    assert.equal(state.tasks[0]?.shouldCreateDedicatedFolder, true)
    assert.equal(state.tasks[0]?.dedicatedFolderName, 'activation-plan')
  })

  test('rejects dedicated folder hints without a usable folder name', async ({ assert }) => {
    await assert.rejects(() =>
      WorkspaceSuggestedTaskStateSchema.validate(
        createState(
          createTask({
            shouldCreateDedicatedFolder: true,
          })
        )
      )
    )

    await assert.rejects(() =>
      WorkspaceSuggestedTaskStateSchema.validate(
        createState(
          createTask({
            shouldCreateDedicatedFolder: true,
            dedicatedFolderName: '   ',
          })
        )
      )
    )
  })

  test('keeps tasks without a dedicated folder hint optional', async ({ assert }) => {
    const state = await WorkspaceSuggestedTaskStateSchema.validate(createState(createTask()))

    assert.isUndefined(state.tasks[0]?.shouldCreateDedicatedFolder)
    assert.isUndefined(state.tasks[0]?.dedicatedFolderName)
  })
})

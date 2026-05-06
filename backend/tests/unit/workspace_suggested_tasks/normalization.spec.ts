import { test } from '@japa/runner'
import {
  MAX_PROMPT_LENGTH,
  MAX_SUGGESTED_TASKS,
  normalizeSuggestedTaskDrafts,
  normalizeSuggestedTaskResponseTasks,
  suggestedTaskResponseSchema,
} from '#agent/workspace_suggested_tasks/normalization'

test.group('workspace suggested task normalization', () => {
  test('normalizes draft tasks, derives deterministic ids, and deduplicates repeats', ({ assert }) => {
    const drafts = [
      {
        emoji: '🧭',
        headline: '  Review kickoff docs  ',
        description: ' Review the seeded docs and note the open questions. ',
        prompt: ' Read the docs and outline the next steps. ',
        shouldCreateDedicatedFolder: true,
        dedicatedFolderName: 'kickoff-review',
      },
      {
        emoji: '🧭',
        headline: 'Review   kickoff docs',
        description: 'Review the seeded docs and note the open questions.',
        prompt: 'Read the docs and outline the next steps.',
        shouldCreateDedicatedFolder: true,
        dedicatedFolderName: 'kickoff-review',
      },
    ] as const

    const normalized = normalizeSuggestedTaskDrafts(drafts as any)
    const normalizedAgain = normalizeSuggestedTaskDrafts(drafts as any)

    assert.lengthOf(normalized, 1)
    assert.equal(normalized[0].headline, 'Review kickoff docs')
    assert.equal(normalized[0].description, 'Review the seeded docs and note the open questions.')
    assert.equal(normalized[0].prompt, 'Read the docs and outline the next steps.')
    assert.equal(normalized[0].shouldCreateDedicatedFolder, true)
    assert.equal(normalized[0].dedicatedFolderName, 'kickoff-review')
    assert.equal(normalized[0].id, normalizedAgain[0].id)
    assert.match(normalized[0].id, /^review-kickoff-docs-/)
  })

  test('caps normalized draft output at four tasks and trims prompts to the final length limit', ({ assert }) => {
    const drafts = Array.from({ length: MAX_SUGGESTED_TASKS + 1 }, (_, index) => ({
      emoji: '📝',
      headline: `Task ${index + 1}`,
      description: `Description ${index + 1}`,
      prompt: 'A'.repeat(MAX_PROMPT_LENGTH + 120),
    }))

    const normalized = normalizeSuggestedTaskDrafts(drafts)

    assert.lengthOf(normalized, MAX_SUGGESTED_TASKS)
    assert.lengthOf(normalized[0].prompt, MAX_PROMPT_LENGTH)
  })

  test('keeps raw-id-based normalization for legacy generated task responses', ({ assert }) => {
    const normalized = normalizeSuggestedTaskResponseTasks([
      {
        id: 'Explore kickoff docs',
        emoji: '🧭',
        headline: 'Explore kickoff docs',
        description: 'Review the seeded docs and capture the key questions.',
        prompt: 'Read the key docs and summarize the best next steps.',
      },
    ])

    assert.lengthOf(normalized, 1)
    assert.match(normalized[0].id, /^explore-kickoff-docs-/)
  })

  test('requires dedicated folder name when the generated task asks for a dedicated folder', ({ assert }) => {
    const validResult = suggestedTaskResponseSchema.safeParse({
      tasks: [
        {
          id: 'activation-plan',
          emoji: '🧪',
          headline: 'Pressure-test activation',
          description: 'Find the smallest activation proof worth building next.',
          prompt: 'Review the workspace and define the sharpest activation test.',
          shouldCreateDedicatedFolder: true,
          dedicatedFolderName: 'activation-plan',
        },
      ],
    })
    const missingNameResult = suggestedTaskResponseSchema.safeParse({
      tasks: [
        {
          id: 'activation-plan',
          emoji: '🧪',
          headline: 'Pressure-test activation',
          description: 'Find the smallest activation proof worth building next.',
          prompt: 'Review the workspace and define the sharpest activation test.',
          shouldCreateDedicatedFolder: true,
        },
      ],
    })

    assert.isTrue(validResult.success)
    assert.isFalse(missingNameResult.success)
  })
})

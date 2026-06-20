import { nanoid } from 'nanoid'
import { type ModelMessage, type ToolSet } from 'ai'
import type { ToolContext } from '../tools/context.js'
import { type FlowSystemPromptBlock, type ResolvedSubagentFlow, getSubagentFlow } from '../flow.js'
import { createToolCallReaskRepair } from '../utils/tool_call_repair.js'
import {
  createSpanId,
  createSubagentTraceContext,
  withToolCallTraceContext,
  type TraceContext,
} from '../tracing/trace_context.js'
import { getComposioToolsWithTimeline } from '../providers/composio.js'
import {
  cleanupReasoning,
  cleanupReportOutput,
  extractTerminalOutput,
  handleReasoningDelta,
  handleReasoningEnd,
  handleToolCall,
  handleToolInputDelta,
  handleToolInputStart,
  type ReasoningState,
  type ReportOutputState,
} from './streaming.js'
import { runToolLoop } from '../tool_loop_runner.js'
import type { AgentProviderCallOptions } from '../providers/types.js'
import { buildOpenAIThreadContext } from '../providers/runtime_options.js'

export interface SubagentExecutionInput {
  agentType: string
  objective: string
  context: ToolContext
  workspaceTree?: string
  subagentId?: string
  toolCallId?: string
}

export interface SubagentExecutionResult {
  response: string
  iterations: number
}

export interface SubagentExecutionDependencies {
  createModel: (modelId: string) => unknown
  toSystemMessages: (systemPrompts: FlowSystemPromptBlock[]) => ModelMessage[]
  formatMessages?: (messages: ModelMessage[]) => ModelMessage[]
  applyRuntimeProviderOptions: (
    baseOptions: AgentProviderCallOptions,
    context: ToolContext,
    modelId: string,
    agentType: string
  ) => AgentProviderCallOptions
}

export async function runSubagentExecution(
  input: SubagentExecutionInput,
  dependencies: SubagentExecutionDependencies
): Promise<SubagentExecutionResult> {
  const { agentType, objective, context, workspaceTree, toolCallId } = input
  const subagentFlow = getSubagentFlow(context.flow, agentType)

  if (!subagentFlow) {
    throw new Error(`Unknown subagent type: ${agentType}`)
  }

  const resolvedSubagentId = input.subagentId ?? nanoid()
  const executionId = nanoid()

  const parentTraceContext = withToolCallTraceContext(context.traceContext, toolCallId)
  const subagentSpanId = createSpanId()
  const subagentTraceContext = createSubagentTraceContext({
    parent: parentTraceContext,
    subagentId: resolvedSubagentId,
    subagentSpanId,
    toolCallId,
  })

  const subagentContext: ToolContext = {
    ...context,
    agent: { source: 'subagent', executionId },
    traceContext: subagentTraceContext,
  }
  const loopTraceContext: TraceContext = {
    ...subagentTraceContext,
    activeParentSpanId: subagentSpanId,
  }
  const baseSubagentContext: ToolContext = {
    ...subagentContext,
    traceContext: loopTraceContext,
  }

  try {
    let composioTools: ToolSet = {}
    if (subagentFlow.enableComposio) {
      const { userId, workspaceId } = context.state.currentContext
      composioTools = await getComposioToolsWithTimeline(userId, workspaceId, baseSubagentContext)
    }

    const tools = subagentFlow.buildTools(baseSubagentContext, { composioTools })
    const rawModel = dependencies.createModel(subagentFlow.modelId)
    const resolvedProviderOptions = dependencies.applyRuntimeProviderOptions(
      subagentFlow.providerOptions,
      subagentContext,
      subagentFlow.modelId,
      subagentFlow.name
    )
    const threadContext = buildOpenAIThreadContext({
      providerName: subagentContext.providerName,
      workspaceId: subagentContext.state.currentContext.workspaceId,
      aiSessionId: subagentContext.state.currentContext.aiSessionId,
      modelId: subagentFlow.modelId,
      agentSource: 'subagent',
      flowName: subagentContext.flow.name,
      agentType: subagentFlow.name,
    })

    const repairToolCall = createToolCallReaskRepair({
      model: rawModel,
      getModel: () => rawModel,
      tools: tools as ToolSet,
      providerOptions: resolvedProviderOptions,
    })

    const reportState: ReportOutputState = { itemId: null, argsText: '', activeToolCallId: null }
    const reasoningState: ReasoningState = { itemId: null, accumulatedText: '' }
    const maxOutputTokens = subagentContext.providerName === 'openai' ? undefined : subagentFlow.maxOutputTokens

    const runResult = await runToolLoop({
      model: rawModel,
      tools: tools as ToolSet,
      messages: [{ role: 'user', content: subagentFlow.buildUserPrompt({ workspaceTree }) } as ModelMessage],
      instructions: dependencies.toSystemMessages(formatSubagentSystemMessages(subagentFlow, objective)),
      headers: threadContext?.headers,
      maxOutputTokens,
      stopWhen: subagentFlow.stopWhen,
      context: baseSubagentContext,
      providerOptions: resolvedProviderOptions,
      repairToolCall,
      prepareStep: async ({ messages }) => {
        return {
          model: rawModel as any,
          messages: dependencies.formatMessages ? dependencies.formatMessages(messages) : messages,
          experimental_context: baseSubagentContext,
        }
      },
      onChunk: (chunk) => {
        if (chunk.type === 'reasoning-delta') {
          handleReasoningDelta(chunk, reasoningState, subagentContext)
          return
        }

        if (chunk.type === 'reasoning-end') {
          handleReasoningEnd(reasoningState, subagentContext)
          return
        }

        if (chunk.type === 'tool-input-start') {
          handleToolInputStart(chunk, reportState, subagentContext, subagentFlow.terminalToolName, resolvedSubagentId)
          return
        }

        if (chunk.type === 'tool-input-delta') {
          handleToolInputDelta(chunk, reportState, subagentContext, resolvedSubagentId)
          return
        }

        if (chunk.type === 'tool-call') {
          handleToolCall(chunk, reportState, subagentContext, subagentFlow.terminalToolName)
        }
      },
      onError: () => {
        cleanupReportOutput(reportState, subagentContext)
        cleanupReasoning(reasoningState, subagentContext)
      },
    })

    if (reasoningState.itemId) {
      const existingItem = subagentContext.state.findTimelineItem(reasoningState.itemId)
      if (existingItem && 'streaming' in existingItem && existingItem.streaming) {
        subagentContext.state.updateTimelineItem(
          reasoningState.itemId,
          { thought: reasoningState.accumulatedText, streaming: false },
          'thinking'
        )
      }
    }

    const result: SubagentExecutionResult = {
      response:
        extractTerminalOutput(runResult.steps, subagentFlow.terminalToolName) || runResult.text || 'No output produced',
      iterations: runResult.steps.length,
    }

    return result
  } catch (error) {
    throw error
  }
}

function formatSubagentSystemMessages(subagentFlow: ResolvedSubagentFlow, objective: string): FlowSystemPromptBlock[] {
  const objectivePrompt: FlowSystemPromptBlock = {
    role: 'system',
    content: `## Current Objective\n\n${objective}`,
  }

  if (subagentFlow.systemPrompts.length === 0) {
    return [objectivePrompt]
  }

  const [firstPrompt, ...remainingPrompts] = subagentFlow.systemPrompts
  return [firstPrompt, objectivePrompt, ...remainingPrompts]
}

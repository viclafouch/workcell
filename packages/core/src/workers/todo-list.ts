import { z } from 'zod'
import type { Todo } from '@tanstack/ai-harness/plugins'

const TODOS_PLUGIN = 'tanstack/todos'

const todoListSchema = z.object({
  items: z.array(
    z.object({
      text: z.string(),
      status: z.enum(['pending', 'in_progress', 'done'])
    }) satisfies z.ZodType<Todo>
  )
})

export function todosOf(
  plugins: Readonly<Record<string, unknown>>
): readonly Todo[] | undefined {
  return todoListSchema.safeParse(plugins[TODOS_PLUGIN]).data?.items
}

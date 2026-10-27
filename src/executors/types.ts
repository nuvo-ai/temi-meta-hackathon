/**
 * Runs a tool for a caller. The brain decides *what* to do; an executor does
 * it. In this repo that's the in-memory MockBank; in production it's Temi's
 * banking backend behind HttpExecutor.
 */
export interface ToolExecutor {
    execute(name: string, args: Record<string, unknown>, ctx: { callerId: string }): Promise<unknown>;
}

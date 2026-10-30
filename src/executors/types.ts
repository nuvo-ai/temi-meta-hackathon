import type { CountryCode } from '../countries.js';

export interface ToolContext {
    callerId: string;
    /** Caller's country; decides currency, networks and how money moves. Defaults to NG. */
    country?: CountryCode;
    /** Caller's number in international format, when known; reminders call it back. */
    callerNumber?: string;
}

/**
 * Runs a tool for a caller. The brain decides *what* to do; an executor does
 * it. In this repo that's the in-memory MockBank; in production it's Temi's
 * banking backend behind HttpExecutor.
 */
export interface ToolExecutor {
    execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

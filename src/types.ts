export interface ChatMessage { id: string; stable: boolean; role: 'user' | 'assistant'; html: string; markdown?: string; }
export interface Conversation { title: string; url: string; exportedAt: string; messages: ChatMessage[]; warnings: string[]; source?: 'api'; sourceMessageIds?: string[][]; }
export interface PageInfo { title: string; url: string; visibleIds: string[]; generating: boolean; }
export interface ExportJob { ok: boolean; state: 'idle' | 'running' | 'done' | 'error'; data?: Conversation; error?: string; }
